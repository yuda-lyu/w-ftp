import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { mock } from 'node:test'
import w from 'wsemi'
import WFtp from '../src/WFtp.mjs'
import fakeFtpServer from './lib/fakeFtpServer.mjs'
import { assertFile, signal, settleWithin, catchUnhandled } from './lib/dlTestKit.mjs'
import { leftovers, prepareCase, rejected, msgOf, recorder, genBytes } from './lib/ulTestKit.mjs'


//真實WFtp(FTP)經假FTP伺服器之上傳: 先寫遠端暫存名、核對大小、改名覆蓋、失敗不留殘檔不毀舊檔、timeLimit生效、串流讀本機檔
//規格(使用端需求Gitea #214 §4第6項): 上傳一律先寫遠端同資料夾之暫存名, 完成且大小相符才改名為目標; RNTO不覆蓋之伺服器不得靜默留暫存而回成功;
//任何失敗刪暫存、舊目標不變; 逾時銷毀數據socket不留背景續寫; syncToRemote依序逐檔、第一個失敗即停並轉交opt; opt.onTrace事件
describe('api-ftp-upload-temp', function() {

    let fdBase = './test/_tmp/ftp-upload-temp'

    let srvs = []
    let ftps = []

    before(function() {
        w.fsDeleteFolder(fdBase)
    })

    afterEach(async function() {
        mock.restoreAll()
        for (let f of ftps) {
            await settleWithin(f.quit(), 3000) //防懸置: 連線卡住時由srv.close銷毀socket
        }
        ftps = []
        for (let s of srvs) {
            await s.close()
        }
        srvs = []
    })

    after(function() {
        w.fsDeleteFolder(fdBase)
    })

    //connect, 起假伺服器並連線
    let connect = async (c, { hooks = {}, renameOverwrite = true, timeLimit = 60000 } = {}) => {
        let srv = await fakeFtpServer({ fdRoot: c.fdSrv, hooks, renameOverwrite })
        srvs.push(srv)
        let ftp = WFtp({ transportation: 'FTP', hostname: '127.0.0.1', port: srv.port, username: 'u1', password: 'p1', timeLimit })
        ftps.push(ftp)
        await ftp.conn()
        return { srv, ftp }
    }

    let assertOldKept = (c, label) => {
        assertFile(c.fpSrv, c.old, `${label}: 舊目標須不變`)
        assert.strict.deepEqual(leftovers(c.fdSrv), [], `${label}: 遠端不得留暫存名`)
    }

    let assertUploaded = (c, label) => {
        assertFile(c.fpSrv, c.fresh, `${label}: 目標須為新內容`)
        assert.strict.deepEqual(leftovers(c.fdSrv), [], `${label}: 遠端不得留暫存名`)
    }

    let reuse = async (ftp, c) => {
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin'), 'ok', '同一實例其後可上傳')
        assertUploaded(c, '續用')
    }

    //stallCmd, CMD攔截: when()為true之指令不回應
    let stallCmd = (when) => ({ cmd, arg }) => when(cmd, arg) === true

    it('成功覆蓋既有目標: 傳輸中只寫暫存名且舊目標不變, 完成後改名覆蓋; 不改變工作目錄', async function() {
        let c = prepareCase(fdBase, 'ok', { size: 400000 })
        let during = null
        let { srv, ftp } = await connect(c, {
            hooks: {
                STOR: async ({ store }) => {
                    await store()
                },
                CMD: ({ cmd }) => {
                    if (cmd === 'RNFR') {
                        during = { target: fs.readFileSync(c.fpSrv), temps: leftovers(c.fdSrv) }
                    }
                    return false
                },
            },
        })
        let rec = recorder()
        let ps = []
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin', (p) => ps.push(p), { onTrace: rec.onTrace }), 'ok')
        assert.ok(during.target.equals(c.old), '改名前舊目標不變')
        assert.strict.deepEqual(during.temps.length, 1)
        assert.ok(new RegExp(`^t\\.bin\\.${process.pid}\\.[0-9A-Za-z]{8}\\.part$`).test(during.temps[0]), `暫存名格式(實際${during.temps[0]})`)
        assertUploaded(c, '成功')
        let stors = srv.cmds.filter((v) => v.startsWith('stor '))
        assert.strict.deepEqual(srv.cmds.filter((v) => /^stor /i.test(v)), [`stor ./${during.temps[0]}`], `只STOR暫存名(${stors})`)
        assert.strict.deepEqual(srv.cmds.filter((v) => /^cwd /i.test(v)), [], '不改變工作目錄')
        assert.strict.deepEqual(rec.evs.map((e) => e.type), ['transfer', 'verify', 'move'])
        assert.strict.deepEqual(rec.evs[1], { type: 'verify', ok: true, size: 400000, sizeLocal: 400000 })
        assert.strict.deepEqual(rec.evs[2], { type: 'move', mode: 'rename' })
        assert.strict.deepEqual(ps[ps.length - 1], { progress: 100, name: 'up.bin', fpRemote: './t.bin', fpLocal: c.fpLocal })
    })

    it('成功: 目標不存在、多層資料夾(自動mkdir)、無./起首之子資料夾路徑、空檔', async function() {
        let c = prepareCase(fdBase, 'new', { size: 0, old: false })
        let { ftp } = await connect(c)
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './a/b/e.bin'), 'ok')
        assertFile(`${c.fdSrv}/a/b/e.bin`, Buffer.alloc(0), '空檔')
        fs.writeFileSync(c.fpLocal, genBytes(70001, 7))
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, 'x/y/f.bin'), 'ok')
        assertFile(`${c.fdSrv}/x/y/f.bin`, genBytes(70001, 7), '無./起首')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
    })

    it('以串流讀本機檔: 不readFileSync整檔; 伺服器不讀數據時只讀出部分, 逾時中止、無殘檔、舊目標不變、實例可續用', async function() {
        let c = prepareCase(fdBase, 'stream', { size: 48 * 1024 * 1024 })
        let stall = true
        let dsHeld = null
        let { ftp } = await connect(c, {
            timeLimit: 2000,
            hooks: {
                STOR: async ({ fp, reply, waitDs, store }) => {
                    if (!stall) {
                        return store()
                    }
                    fs.writeFileSync(fp, '')
                    reply('150 ok')
                    dsHeld = await waitDs()
                    dsHeld.pause() //不讀取數據
                },
            },
        })
        let fpAbs = path.resolve(c.fpLocal)
        let reads = []
        let readFileSync = fs.readFileSync
        mock.method(fs, 'readFileSync', function(p, ...args) {
            if (typeof p === 'string' && path.resolve(p) === fpAbs) {
                reads.push(p)
            }
            return readFileSync.call(this, p, ...args)
        })
        let un = catchUnhandled()
        let rec = recorder()
        let ps = []
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', (p) => ps.push(p.progress), { onTrace: rec.onTrace }), '不讀數據')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[2000]')
        assert.strict.deepEqual(reads, [], '不得整檔讀入記憶體')
        assert.ok(ps.length > 0 && ps[ps.length - 1] < 90, `串流讀取受背壓限制(最後進度${ps[ps.length - 1]})`)
        assert.ok(rec.evs.some((v) => v.type === 'timeout' && v.stage === 'transfer'))
        assert.ok(rec.evs.some((v) => v.type === 'reconnect' && v.ok === true))
        await rec.wait((v) => v.type === 'transfer' && v.late === true)
        let closed = signal()
        if (dsHeld.destroyed) {
            closed.fire()
        }
        else {
            dsHeld.once('close', () => closed.fire())
            dsHeld.resume()
        }
        await closed.wait()
        assertOldKept(c, '不讀數據')
        let n = ps.length
        stall = false
        await reuse(ftp, c)
        assert.strict.deepEqual(ps.length, n, '逾時後不再通知進度')
        assert.strict.deepEqual(un.list, [])
        un.stop()
    })

    it('伺服器收完數據不回最終回應: 逾時reject, 暫存已刪, 舊目標不變, 實例可續用', async function() {
        let c = prepareCase(fdBase, 'noreply', { size: 100000 })
        let stall = true
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: {
                STOR: async ({ fp, reply, waitDs, closeDsrv, store }) => {
                    if (!stall) {
                        return store()
                    }
                    fs.writeFileSync(fp, '')
                    reply('150 ok')
                    let ds = await waitDs()
                    ds.on('data', (d) => fs.appendFileSync(fp, d))
                    ds.once('close', () => closeDsrv())
                    ds.resume()
                },
            },
        })
        assert.strict.deepEqual(await rejected(ftp.upload(c.fpLocal, './t.bin'), '無最終回應'), 'ftpUploadCore timeout[1500]')
        assertOldKept(c, '無最終回應')
        stall = false
        await reuse(ftp, c)
    })

    it('伺服器對STOR不回150(控制連線停滯): 逾時reject, 重新連線, 實例可續用', async function() {
        let c = prepareCase(fdBase, 'no150')
        let stall = true
        let { srv, ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: { CMD: stallCmd((cmd) => stall && cmd === 'STOR') },
        })
        let rec = recorder()
        assert.strict.deepEqual(await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '不回150'), 'ftpUploadCore timeout[1500]')
        assert.ok(rec.evs.some((v) => v.type === 'reconnect' && v.ok === true))
        assertOldKept(c, '不回150')
        stall = false
        await reuse(ftp, c)
        assert.strict.deepEqual(srv.nControl(), 1, '舊控制連線已銷毀')
    })

    for (let [name, cmdName, stage] of [['mkdir前之MLST停滯', 'MLST', 'prepare'], ['核對之SIZE停滯', 'SIZE', 'verify']]) {
        it(`${name}: 逾時reject, 無殘檔, 舊目標不變, 實例可續用`, async function() {
            let c = prepareCase(fdBase, `stall-${cmdName}`)
            fs.mkdirSync(`${c.fdSrv}/d`)
            let stall = true
            let { ftp } = await connect(c, {
                timeLimit: 1500,
                hooks: { CMD: stallCmd((cmd) => stall && cmd === cmdName) },
            })
            let rec = recorder()
            let fpRemote = cmdName === 'MLST' ? './d/t.bin' : './t.bin'
            assert.strict.deepEqual(await rejected(ftp.upload(c.fpLocal, fpRemote, null, { onTrace: rec.onTrace }), name), 'ftpUploadCore timeout[1500]')
            assert.ok(rec.evs.some((v) => v.type === 'timeout' && v.stage === stage), JSON.stringify(rec.evs))
            assertOldKept(c, name)
            stall = false
            await reuse(ftp, c)
        })
    }

    it('傳輸中伺服器回426: reject原錯誤, 暫存已刪, 舊目標不變, 沿用同一控制連線', async function() {
        let c = prepareCase(fdBase, 'r426', { size: 300000 })
        let { srv, ftp } = await connect(c, {
            hooks: {
                STOR: async ({ fp, reply, waitDs, closeDsrv }) => {
                    fs.writeFileSync(fp, '')
                    reply('150 ok')
                    let ds = await waitDs()
                    ds.once('data', (d) => {
                        fs.appendFileSync(fp, d)
                        ds.destroy()
                        closeDsrv()
                        reply('426 connection closed; transfer aborted')
                    })
                    ds.resume()
                },
            },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '426')
        assert.ok(e instanceof Error && e.code === 426, `沿用傳輸之原錯誤(${msgOf(e)})`)
        assertOldKept(c, '426')
        assert.ok(!rec.evs.some((v) => v.type === 'reconnect'), '有最終回應者不需重新連線')
        assert.strict.deepEqual(srv.nControl(), 1)
    })

    it('數據連線只收一半即回226(靜默截斷): 大小不符reject, 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'half', { size: 200000 })
        let { ftp } = await connect(c, {
            hooks: {
                STOR: async ({ fp, reply, waitDs, closeDsrv }) => {
                    reply('150 ok')
                    let ds = await waitDs()
                    let chunks = []
                    ds.on('data', (d) => chunks.push(d))
                    ds.once('close', () => {
                        fs.writeFileSync(fp, Buffer.concat(chunks).subarray(0, 100000))
                        reply('226 transfer complete')
                        closeDsrv()
                    })
                    ds.resume()
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '截斷')
        assert.strict.deepEqual(e, 'ftpUpload: uploaded size[100000] does not match local size[200000], fpRemote is not changed')
        assertOldKept(c, '截斷')
    })

    it('收完數據回552(儲存空間不足): 以最終回應判定失敗, 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'r552', { size: 5000 })
        let { ftp } = await connect(c, {
            hooks: {
                STOR: async ({ fp, reply, waitDs, closeDsrv }) => {
                    reply('150 ok')
                    let ds = await waitDs()
                    let chunks = []
                    ds.on('data', (d) => chunks.push(d))
                    ds.once('close', () => {
                        fs.writeFileSync(fp, Buffer.concat(chunks)) //大小相符但伺服器宣告失敗
                        reply('552 exceeded storage allocation')
                        closeDsrv()
                    })
                    ds.resume()
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '552')
        assert.ok(e.code === 552, msgOf(e))
        assertOldKept(c, '552')
    })

    it('STOR被拒(553): reject原錯誤, 舊目標不變, 實例可續用', async function() {
        let c = prepareCase(fdBase, 'r553')
        let deny = true
        let { ftp } = await connect(c, {
            hooks: {
                CMD: ({ cmd, reply }) => {
                    if (deny && cmd === 'STOR') {
                        reply('553 permission denied')
                        return true
                    }
                    return false
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '553')
        assert.ok(e.code === 553, msgOf(e))
        assertOldKept(c, '553')
        deny = false
        await reuse(ftp, c)
    })

    it('MKD被拒: reject, 無任何STOR', async function() {
        let c = prepareCase(fdBase, 'mkdfail')
        let { srv, ftp } = await connect(c, {
            hooks: { CMD: ({ cmd, reply }) => cmd === 'MKD' && (reply('550 denied'), true) },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './nodir/t.bin'), 'MKD')
        assert.ok(e.code === 550, msgOf(e))
        assert.strict.deepEqual(srv.cmds.filter((v) => /^stor /i.test(v)), [])
    })

    for (let [name, cmdName] of [['傳輸中', 'STOR'], ['核對時', 'SIZE']]) {
        it(`${name}控制連線被伺服器關閉: 立即reject(不等timeLimit), 重新連線刪暫存, 舊目標不變, 不崩潰`, async function() {
            let c = prepareCase(fdBase, `ctlclose-${cmdName}`, { size: 200000 })
            let hit = true
            let { ftp } = await connect(c, {
                hooks: {
                    STOR: async ({ fp, reply, waitDs, destroy, store }) => {
                        if (!(hit && cmdName === 'STOR')) {
                            return store()
                        }
                        hit = false
                        fs.writeFileSync(fp, '')
                        reply('150 ok')
                        let ds = await waitDs()
                        ds.once('data', (d) => {
                            fs.appendFileSync(fp, d)
                            destroy()
                        })
                        ds.resume()
                    },
                    CMD: ({ cmd, destroy }) => {
                        if (hit && cmdName === 'SIZE' && cmd === 'SIZE') {
                            hit = false
                            destroy()
                            return true
                        }
                        return false
                    },
                },
            })
            let un = catchUnhandled()
            let rec = recorder()
            let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), name, 10000)
            assert.ok(msgOf(e).indexOf('timeout') < 0 && msgOf(e).indexOf('can not remove') < 0, msgOf(e))
            assert.ok(!rec.evs.some((v) => v.type === 'timeout'))
            assertOldKept(c, name)
            await reuse(ftp, c)
            assert.strict.deepEqual(un.list, [])
            un.stop()
        })
    }

    it('建立資料夾時控制連線被伺服器關閉: 立即reject, 重新連線使同一實例可續用, 無任何STOR', async function() {
        let c = prepareCase(fdBase, 'ctlclose-mlst')
        fs.mkdirSync(`${c.fdSrv}/d`)
        let hit = true
        let { srv, ftp } = await connect(c, {
            hooks: {
                CMD: ({ cmd, destroy }) => {
                    if (hit && cmd === 'MLST') {
                        hit = false
                        destroy()
                        return true
                    }
                    return false
                },
            },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './d/t.bin', null, { onTrace: rec.onTrace }), '建資料夾斷線', 10000)
        assert.ok(msgOf(e).indexOf('timeout') < 0, msgOf(e))
        assert.ok(rec.evs.some((v) => v.type === 'reconnect' && v.ok === true))
        assert.strict.deepEqual(srv.cmds.filter((v) => /^stor /i.test(v)), [])
        await reuse(ftp, c)
    })

    it('核對之大小不符與取不到大小: 分別以固定訊息reject, 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'sizes', { size: 5000 })
        let mode = 'mismatch'
        let { srv, ftp } = await connect(c, {
            hooks: {
                CMD: ({ cmd, arg, reply }) => {
                    if (cmd === 'SIZE' && arg.endsWith('.part')) {
                        reply(mode === 'mismatch' ? '213 4999' : '550 SIZE not allowed')
                        return true
                    }
                    return false
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '大小不符')
        assert.strict.deepEqual(e, 'ftpUpload: uploaded size[4999] does not match local size[5000], fpRemote is not changed')
        assertOldKept(c, '大小不符')
        mode = 'nosize'
        let e2 = await rejected(ftp.upload(c.fpLocal, './t.bin'), '取不到大小')
        assert.strict.deepEqual(e2, 'ftpUpload: can not get the size of the uploaded temporary file (550), fpRemote is not changed')
        assertOldKept(c, '取不到大小')
        assert.strict.deepEqual(srv.cmds.filter((v) => /^rn/i.test(v)), [], '未改名')
    })

    it('RNTO不覆蓋既有檔之伺服器: 改走舊檔暫名交換, 成功且無暫存名', async function() {
        let c = prepareCase(fdBase, 'noover')
        let { srv, ftp } = await connect(c, { renameOverwrite: false })
        let rec = recorder()
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), 'ok')
        assertUploaded(c, '交換')
        let rn = srv.cmds.filter((v) => /^(rnfr|rnto) /i.test(v)).map((v) => v.replace(/\.\d+\.[0-9A-Za-z]{8}\./, '.X.'))
        assert.strict.deepEqual(rn, [
            'rnfr ./t.bin.X.part', 'rnto ./t.bin',
            'rnfr ./t.bin', 'rnto ./t.bin.X.old',
            'rnfr ./t.bin.X.part', 'rnto ./t.bin',
        ])
        assert.ok(rec.evs.some((v) => v.type === 'move' && v.mode === 'swap'))
        assert.ok(rec.evs.some((v) => v.type === 'temp' && v.kind === 'old' && v.ok === true))
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './n.bin', null, { onTrace: rec.onTrace }), 'ok')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
    })

    it('不支援MLST且RNTO不覆蓋: 以SIZE判斷目標為檔案, 仍可交換覆蓋', async function() {
        let c = prepareCase(fdBase, 'nomlst')
        let { ftp } = await connect(c, {
            renameOverwrite: false,
            hooks: { CMD: ({ cmd, reply }) => cmd === 'MLST' && (reply('500 unknown command'), true) },
        })
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin'), 'ok')
        assertUploaded(c, '無MLST')
    })

    it('伺服器不允許改名: reject固定訊息(不回顯伺服器訊息), 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'norename')
        let { ftp } = await connect(c, {
            hooks: { CMD: ({ cmd, arg, reply }) => cmd === 'RNFR' && (reply(`550 ${arg}: secret server detail`), true) },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '不允許改名')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (550), fpRemote is not changed')
        assertOldKept(c, '不允許改名')
    })

    it('目標為資料夾: reject改名失敗, 資料夾不被搬走, 無暫存名', async function() {
        let c = prepareCase(fdBase, 'dirtarget', { old: false })
        fs.mkdirSync(`${c.fdSrv}/t.bin`)
        fs.writeFileSync(`${c.fdSrv}/t.bin/keep.txt`, 'k')
        let { srv, ftp } = await connect(c, { renameOverwrite: false })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '目標為資料夾')
        assert.ok(e.startsWith('ftpUpload: can not rename the temporary file to fpRemote ('), e)
        assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/t.bin/keep.txt`, 'utf8'), 'k')
        assert.strict.deepEqual(srv.cmds.filter((v) => v === 'rnfr ./t.bin'), [], '資料夾不搬走')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
    })

    //swapHooks, 交換中第二次改名(暫存改為目標, 此時目標不存在)依on回應
    let denySwap = (c, { restoreToo = false } = {}) => {
        let from = ''
        return {
            CMD: ({ cmd, arg, reply }) => {
                if (cmd === 'RNFR') {
                    from = arg
                }
                if (cmd === 'RNTO' && arg === './t.bin' && !fs.existsSync(c.fpSrv) && (restoreToo || from.endsWith('.part'))) {
                    reply('550 denied')
                    return true
                }
                return false
            },
        }
    }

    it('交換中第二次改名失敗: 舊檔改回目標, 暫存已刪', async function() {
        let c = prepareCase(fdBase, 'swapfail')
        let { ftp } = await connect(c, { renameOverwrite: false, hooks: denySwap(c) })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '交換失敗')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (550), fpRemote is not changed')
        assertOldKept(c, '交換失敗')
    })

    it('交換中改回舊檔亦失敗: 舊檔暫名保留(不刪), 訊息明示, 暫存已刪', async function() {
        let c = prepareCase(fdBase, 'restorefail')
        let { ftp } = await connect(c, { renameOverwrite: false, hooks: denySwap(c, { restoreToo: true }) })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '還原失敗')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (550), the old file of fpRemote is kept under a temporary name in the same folder')
        let left = leftovers(c.fdSrv)
        assert.strict.deepEqual(left.map((v) => path.extname(v)), ['.old'])
        assertFile(`${c.fdSrv}/${left[0]}`, c.old, '舊檔暫名保留舊內容')
    })

    it('伺服器不允許刪除舊檔暫名: reject明示目標已更新(不靜默成功)', async function() {
        let c = prepareCase(fdBase, 'nodel-old')
        let { ftp } = await connect(c, {
            renameOverwrite: false,
            hooks: { CMD: ({ cmd, arg, reply }) => cmd === 'DELE' && arg.endsWith('.old') && (reply('550 denied'), true) },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '刪舊暫名失敗')
        assert.strict.deepEqual(e, 'ftpUpload: fpRemote is updated, but can not remove the old file kept under a temporary name in the same folder')
        assertFile(c.fpSrv, c.fresh, '目標已更新')
        assert.strict.deepEqual(leftovers(c.fdSrv).map((v) => path.extname(v)), ['.old'])
    })

    it('傳輸失敗且伺服器不允許刪除暫存: 固定訊息帶code與後綴, onTrace回報, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'nodel-part', { size: 5000 })
        let { ftp } = await connect(c, {
            hooks: {
                STOR: async ({ fp, reply, waitDs, closeDsrv }) => {
                    reply('150 ok')
                    let ds = await waitDs()
                    ds.once('close', () => {
                        fs.writeFileSync(fp, 'partial')
                        reply('451 local error')
                        closeDsrv()
                    })
                    ds.resume()
                },
                CMD: ({ cmd, reply }) => cmd === 'DELE' && (reply('550 denied'), true),
            },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '刪暫存失敗')
        assert.strict.deepEqual(e, 'ftpUpload: transfer failed (451), fpRemote is not changed, can not remove the remote temporary file')
        assertFile(c.fpSrv, c.old, '舊目標不變')
        assert.ok(rec.evs.some((v) => v.type === 'temp' && v.kind === 'part' && v.ok === false))
        assert.ok(!rec.evs.some((v) => v.type === 'reconnect'))
    })

    it('改名停滯(RNTO): 逾時reject「可能已更新」, 暫存已刪, 實例可續用', async function() {
        let c = prepareCase(fdBase, 'stall-rnto')
        let stall = true
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: { CMD: stallCmd((cmd) => stall && cmd === 'RNTO') },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '停滯改名')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[1500] while renaming, fpRemote may or may not be updated')
        assertOldKept(c, '停滯改名')
        stall = false
        await reuse(ftp, c)
    })

    it('交換中停滯於暫存改名: 逾時後舊檔改回目標, 暫存已刪', async function() {
        let c = prepareCase(fdBase, 'stall-swap')
        let from = ''
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            renameOverwrite: false,
            hooks: {
                CMD: ({ cmd, arg }) => {
                    if (cmd === 'RNFR') {
                        from = arg
                    }
                    return cmd === 'RNTO' && arg === './t.bin' && from.endsWith('.part') && !fs.existsSync(c.fpSrv)
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '交換停滯')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[1500] while renaming, fpRemote may or may not be updated')
        assertOldKept(c, '交換停滯')
    })

    it('傳輸中同一實例併發查詢(回550): 不當作本次傳輸之結果, 上傳成功', async function() {
        let c = prepareCase(fdBase, 'concurrent-cmd', { size: 5000 })
        let received = signal()
        let release = signal()
        let { ftp } = await connect(c, {
            hooks: {
                STOR: async ({ fp, reply, waitDs, closeDsrv }) => {
                    reply('150 ok')
                    let ds = await waitDs()
                    let chunks = []
                    ds.on('data', (d) => chunks.push(d))
                    ds.once('close', async () => {
                        fs.writeFileSync(fp, Buffer.concat(chunks))
                        received.fire()
                        await release.wait()
                        reply('226 transfer complete')
                        closeDsrv()
                    })
                    ds.resume()
                },
            },
        })
        let p = ftp.upload(c.fpLocal, './t.bin')
        await received.wait()
        assert.strict.deepEqual(await ftp.isFile('./nope.bin'), false)
        release.fire()
        assert.strict.deepEqual(await p, 'ok')
        assertUploaded(c, '併發查詢')
    })

    it('重新連線時伺服器已停機: 不使行程崩潰, 訊息標示暫存未清', async function() {
        let c = prepareCase(fdBase, 'srvdown')
        let closing = null
        let srvRef = null
        let { srv, ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: {
                STOR: async ({ fp, reply }) => {
                    fs.writeFileSync(fp, '')
                    reply('150 ok')
                    closing = srvRef.close()
                },
            },
        })
        srvRef = srv
        let un = catchUnhandled()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '停機')
        assert.ok(msgOf(e).endsWith('can not remove the remote temporary file'), msgOf(e))
        await closing
        //讓重新連線之連線錯誤(ECONNREFUSED)發生
        let r = await settleWithin(ftp.isFile('./t.bin'), 5000)
        assert.ok(r.settled)
        assert.strict.deepEqual(un.list, [])
        un.stop()
        assertFile(c.fpSrv, c.old, '舊目標不變')
        srvs = []
    })

    it('連續兩次quit且伺服器不回QUIT: 兩者皆依timeLimit逾時, 不使行程崩潰', async function() {
        let c = prepareCase(fdBase, 'quit2')
        let { ftp } = await connect(c, { timeLimit: 500, hooks: { CMD: stallCmd((cmd) => cmd === 'QUIT') } })
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin'), 'ok')
        let [e1, e2] = await Promise.all([rejected(ftp.quit(), 'quit1'), rejected(ftp.quit(), 'quit2')])
        assert.strict.deepEqual([e1, e2], ['ftpQuit timeout[500]', 'ftpQuit timeout[500]'])
    })

    it('清理時連線連續被關閉: 訊息標示暫存未清, 實例仍重新連線可續用', async function() {
        let c = prepareCase(fdBase, 'clean-drop')
        let n = 0
        let { ftp } = await connect(c, {
            hooks: {
                CMD: ({ cmd, destroy }) => {
                    if (n < 3 && (cmd === 'SIZE' || cmd === 'DELE')) {
                        n++
                        destroy()
                        return true
                    }
                    return false
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '清理斷線', 10000)
        assert.ok(msgOf(e).endsWith('can not remove the remote temporary file'), msgOf(e))
        let r = await settleWithin(ftp.isFile('./t.bin'), 5000)
        assert.ok(r.ok && r.value === true, '其後指令可用')
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin'), 'ok')
        assertFile(c.fpSrv, c.fresh, '其後可上傳')
    })

    it('先後以相對與絕對路徑cwd: 重新連線只需重放絕對路徑', async function() {
        let c = prepareCase(fdBase, 'cwd-abs', { old: false })
        fs.mkdirSync(`${c.fdSrv}/sub`)
        let stall = true
        let { srv, ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: { CMD: stallCmd((cmd) => stall && cmd === 'STOR') },
        })
        await ftp.cwd('sub')
        await ftp.cwd('/sub')
        await rejected(ftp.upload(c.fpLocal, './t.bin'), 'cwd-abs')
        stall = false
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin'), 'ok')
        assert.strict.deepEqual(srv.cmds.filter((v) => /^cwd /i.test(v)), ['cwd sub', 'cwd /sub', 'cwd /sub'])
        assertFile(`${c.fdSrv}/sub/t.bin`, c.fresh, 'sub')
    })

    it('使用者曾cwd: 上傳以相對路徑寫入該資料夾; 逾時重新連線後工作目錄仍為該資料夾(清理與續傳皆對)', async function() {
        let c = prepareCase(fdBase, 'cwd', { old: false })
        fs.mkdirSync(`${c.fdSrv}/sub`)
        fs.writeFileSync(`${c.fdSrv}/sub/t.bin`, c.old)
        let stall = true
        let { srv, ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: {
                STOR: async ({ fp, reply, waitDs, closeDsrv, store }) => {
                    if (!stall) {
                        return store()
                    }
                    fs.writeFileSync(fp, '') //已建立暫存後停滯
                    reply('150 ok')
                    let ds = await waitDs()
                    ds.once('close', () => closeDsrv())
                },
            },
        })
        await ftp.cwd('sub')
        assert.strict.deepEqual(await rejected(ftp.upload(c.fpLocal, './t.bin'), 'cwd逾時'), 'ftpUploadCore timeout[1500]')
        assertFile(`${c.fdSrv}/sub/t.bin`, c.old, '舊目標不變')
        assert.strict.deepEqual(leftovers(c.fdSrv), [], '子資料夾之暫存已刪')
        stall = false
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin'), 'ok')
        assertFile(`${c.fdSrv}/sub/t.bin`, c.fresh, '重連後仍寫入sub')
        assert.strict.deepEqual(fs.existsSync(`${c.fdSrv}/t.bin`), false)
        assert.strict.deepEqual(srv.cmds.filter((v) => /^cwd /i.test(v)), ['cwd sub', 'cwd sub'], '重新連線時重放cwd')
    })

    it('傳輸中quit: 立即reject, 不重新連線, 訊息標示暫存未清, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'quit', { size: 200000 })
        let held = signal()
        let { srv, ftp } = await connect(c, {
            hooks: {
                STOR: async ({ fp, reply, waitDs }) => {
                    fs.writeFileSync(fp, '')
                    reply('150 ok')
                    await waitDs()
                    held.fire() //不讀取、不回應
                },
                CMD: ({ cmd, reply }) => cmd === 'QUIT' && (reply('221 bye'), true),
            },
        })
        let rec = recorder()
        let p = ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace })
        await held.wait()
        await ftp.quit()
        let e = await rejected(p, 'quit', 10000)
        assert.ok(msgOf(e).endsWith('can not remove the remote temporary file'), msgOf(e))
        assert.ok(!rec.evs.some((v) => v.type === 'reconnect' || v.type === 'timeout'))
        assertFile(c.fpSrv, c.old, '舊目標不變')
        assert.strict.deepEqual(srv.cmds.filter((v) => /^dele /i.test(v)), [])
    })

    it('fpRemote以/結尾: reject且不送任何遠端指令; 本機檔不存在: 訊息不變', async function() {
        let c = prepareCase(fdBase, 'badpath')
        let { srv, ftp } = await connect(c)
        assert.strict.deepEqual(await rejected(ftp.upload(c.fpLocal, './dir/'), '尾斜線'), 'ftpUpload: fpRemote is not a file path, fpRemote is not changed')
        assert.strict.deepEqual(await rejected(ftp.upload(`${c.fpLocal}.none`, './d/t.bin'), '本機不存在'), `fpLocal[${c.fpLocal}.none] is not a file`)
        assert.strict.deepEqual(srv.cmds, [])
    })

    it('onTrace回調(未給、非函數、拋錯、回傳rejection)與cbProcess拋錯: 結果相同且無未處理rejection', async function() {
        let c = prepareCase(fdBase, 'trace')
        let { ftp } = await connect(c)
        let un = catchUnhandled()
        let opts = [
            undefined,
            null,
            { onTrace: 'x' },
            {
                onTrace: () => {
                    throw new Error('t')
                },
            },
            { onTrace: async () => Promise.reject(new Error('r')) },
        ]
        for (let o of opts) {
            let r = await settleWithin(ftp.upload(c.fpLocal, './t.bin', () => {
                throw new Error('cb')
            }, o), 10000)
            assert.ok(r.ok && r.value === 'ok', '結果須為ok')
        }
        assertUploaded(c, 'trace')
        assert.strict.deepEqual(un.list, [])
        un.stop()
    })

    it('syncToRemote: 依序上傳, 某檔失敗即reject, 已上傳者保留、失敗之檔維持舊檔、其後不上傳; 轉交onTrace', async function() {
        let c = prepareCase(fdBase, 'sync', { old: false })
        let fdUp = `${path.dirname(c.fpLocal)}/up`
        fs.mkdirSync(fdUp, { recursive: true })
        fs.writeFileSync(`${fdUp}/a.bin`, genBytes(1001, 1))
        fs.writeFileSync(`${fdUp}/b.bin`, genBytes(1002, 2))
        fs.writeFileSync(`${fdUp}/c.bin`, genBytes(1003, 3))
        fs.writeFileSync(`${c.fdSrv}/b.bin`, genBytes(11, 9))
        let { ftp } = await connect(c, {
            hooks: { CMD: ({ cmd, arg, reply }) => cmd === 'SIZE' && /b\.bin\..*\.part$/.test(arg) && (reply('213 1'), true) },
        })
        let rec = recorder()
        let e = await rejected(ftp.syncToRemote(fdUp, '.', null, { onTrace: rec.onTrace }), 'sync失敗')
        assert.strict.deepEqual(e, 'ftpUpload: uploaded size[1] does not match local size[1002], fpRemote is not changed')
        assertFile(`${c.fdSrv}/a.bin`, genBytes(1001, 1), '已上傳者保留')
        assertFile(`${c.fdSrv}/b.bin`, genBytes(11, 9), '失敗者維持舊檔')
        assert.strict.deepEqual(fs.existsSync(`${c.fdSrv}/c.bin`), false, '其後不上傳')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
        assert.strict.deepEqual(rec.evs.filter((v) => v.type === 'verify').map((v) => v.ok), [true, false], 'onTrace轉交各檔')
    })

})
