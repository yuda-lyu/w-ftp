import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import assert from 'assert'
import { mock } from 'node:test'
import w from 'wsemi'
import SFTPClient from 'ssh2-sftp-client'
import WFtp from '../src/WFtp.mjs'
import fakeSftpServer from './lib/fakeSftpServer.mjs'
import { assertFile, signal, settleWithin, catchUnhandled } from './lib/dlTestKit.mjs'
import { leftovers, prepareCase, rejected, msgOf, recorder, genBytes } from './lib/ulTestKit.mjs'


//真實WFtp(SFTP)經假SFTP伺服器之上傳: 先寫遠端暫存名、核對大小、改名覆蓋、失敗不留殘檔不毀舊檔、timeLimit生效
//規格(使用端需求Gitea #214 §4第6項): 上傳一律先寫遠端同資料夾之暫存名, 完成且大小相符才改名為目標; 任何失敗刪暫存、舊目標不變;
//逾時中止傳輸; syncToRemote依序逐檔、第一個失敗即停並轉交opt; opt.onTrace事件
describe('api-sftp-upload-temp', function() {

    let fdBase = './test/_tmp/sftp-upload-temp'

    let srvs = []
    let ftps = []

    before(function() {
        w.fsDeleteFolder(fdBase)
    })

    afterEach(async function() {
        mock.restoreAll()
        for (let f of ftps) {
            await settleWithin(f.quit(), 3000) //防懸置: 連線卡住時由srv.close斷開客戶端
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
    let connect = async (c, { hooks = {}, posixRename = true, timeLimit = 60000 } = {}) => {
        let srv = await fakeSftpServer({ fdRoot: c.fdSrv, hooks, posixRename })
        srvs.push(srv)
        let ftp = WFtp({ transportation: 'SFTP', hostname: '127.0.0.1', port: srv.port, username: 'u1', password: 'p1', timeLimit })
        ftps.push(ftp)
        await ftp.conn()
        return { srv, ftp }
    }

    //assertOldKept, 目標仍為舊內容且無暫存名
    let assertOldKept = (c, label) => {
        assertFile(c.fpSrv, c.old, `${label}: 舊目標須不變`)
        assert.strict.deepEqual(leftovers(c.fdSrv), [], `${label}: 遠端不得留暫存名`)
    }

    //assertUploaded, 目標為新內容且無暫存名
    let assertUploaded = (c, label) => {
        assertFile(c.fpSrv, c.fresh, `${label}: 目標須為新內容`)
        assert.strict.deepEqual(leftovers(c.fdSrv), [], `${label}: 遠端不得留暫存名`)
    }

    //可續用同一實例: 上傳成功
    let reuse = async (ftp, c) => {
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin'), 'ok', '同一實例其後可上傳')
        assertUploaded(c, '續用')
    }

    it('成功覆蓋既有目標: 傳輸中只寫暫存名且舊目標不變, 完成後以posix-rename覆蓋', async function() {
        let c = prepareCase(fdBase, 'ok', { size: 400000 })
        let during = null
        let seen = signal()
        let { srv, ftp } = await connect(c, {
            hooks: {
                WRITE: ({ respond }) => {
                    if (during === null) {
                        during = { target: fs.readFileSync(c.fpSrv), temps: leftovers(c.fdSrv) }
                        seen.fire()
                    }
                    respond()
                },
            },
        })
        let rec = recorder()
        let ps = []
        let r = await ftp.upload(c.fpLocal, './t.bin', (p) => ps.push(p), { onTrace: rec.onTrace })
        assert.strict.deepEqual(r, 'ok')
        await seen.wait()
        assert.ok(during.target.equals(c.old), '傳輸中舊目標不變')
        assert.strict.deepEqual(during.temps.length, 1, '傳輸中恰有一個暫存名')
        assert.ok(new RegExp(`^t\\.bin\\.${process.pid}\\.[0-9A-Za-z]{8}\\.part$`).test(during.temps[0]), `暫存名格式(實際${during.temps[0]})`)
        assertUploaded(c, '成功')
        let opens = srv.ops.filter((o) => o.op === 'open-write').map((o) => path.posix.basename(o.path))
        assert.strict.deepEqual(opens, [during.temps[0]], '只開啟暫存名寫入')
        assert.strict.deepEqual(srv.ops.filter((o) => o.op === 'posix-rename' && o.ok).length, 1)
        assert.strict.deepEqual(rec.evs.map((e) => e.type), ['transfer', 'verify', 'move'])
        assert.strict.deepEqual(rec.evs[0], { type: 'transfer', ok: true, late: false })
        assert.strict.deepEqual(rec.evs[1], { type: 'verify', ok: true, size: 400000, sizeLocal: 400000 })
        assert.strict.deepEqual(rec.evs[2], { type: 'move', mode: 'posix' })
        assert.strict.deepEqual(ps[ps.length - 1], { progress: 100, name: 'up.bin', fpRemote: './t.bin', fpLocal: c.fpLocal })
    })

    it('並行寫入: 未回應之寫入累積至64個(不逐一等待回應), 不超過64個', async function() {
        let c = prepareCase(fdBase, 'parallel', { size: 100 * 32768 + 11 })
        let held = []
        let max = 0
        let full = signal()
        let release = false
        let { ftp } = await connect(c, {
            hooks: {
                WRITE: ({ respond }) => {
                    if (release) {
                        respond()
                        return
                    }
                    held.push(respond)
                    max = Math.max(max, held.length)
                    if (held.length === 64) {
                        full.fire()
                    }
                },
            },
        })
        let p = ftp.upload(c.fpLocal, './t.bin')
        await full.wait()
        //再等一次往返(STAT)讓多送之寫入抵達
        assert.strict.deepEqual(await ftp.isFile('./t.bin'), true)
        assert.strict.deepEqual(max, 64)
        release = true
        for (let f of held) {
            f()
        }
        assert.strict.deepEqual(await p, 'ok')
        assertUploaded(c, '並行')
    })

    it('成功: 目標不存在、多層資料夾(自動mkdir)、空檔', async function() {
        let c = prepareCase(fdBase, 'new', { size: 0, old: false })
        let { ftp } = await connect(c)
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './a/b/e.bin'), 'ok')
        assertFile(`${c.fdSrv}/a/b/e.bin`, Buffer.alloc(0), '空檔')
        fs.writeFileSync(c.fpLocal, genBytes(70001, 7))
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './a/b/f.bin'), 'ok')
        assertFile(`${c.fdSrv}/a/b/f.bin`, genBytes(70001, 7), '多塊')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
    })

    it('兩次同時上傳同一目標: 各用不同暫存名, 完成後無暫存名', async function() {
        let c = prepareCase(fdBase, 'concurrent', { size: 90000 })
        let names = new Set()
        let { ftp } = await connect(c, {
            hooks: {
                OPEN: ({ path: p, write, respond }) => {
                    if (write) {
                        names.add(p)
                    }
                    respond()
                },
            },
        })
        let rs = await Promise.all([ftp.upload(c.fpLocal, './t.bin'), ftp.upload(c.fpLocal, './t.bin')])
        assert.strict.deepEqual(rs, ['ok', 'ok'])
        assert.strict.deepEqual(names.size, 2)
        assertUploaded(c, '併發')
    })

    it('同一實例兩個上傳同時逾時: 兩者皆清掉暫存(各自重新連線時改用已換上之新連線), 實例可續用', async function() {
        let c = prepareCase(fdBase, 'concurrent-stall', { size: 300000 })
        fs.writeFileSync(`${c.fdSrv}/u.bin`, c.old)
        let stall = true
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: { WRITE: ({ respond }) => (stall ? null : respond()) },
        })
        let [e1, e2] = await Promise.all([
            rejected(ftp.upload(c.fpLocal, './t.bin'), '併發1'),
            rejected(ftp.upload(c.fpLocal, './u.bin'), '併發2'),
        ])
        assert.strict.deepEqual([e1, e2], ['ftpUploadCore timeout[1500]', 'ftpUploadCore timeout[1500]'])
        assertFile(c.fpSrv, c.old, '舊目標1不變')
        assertFile(`${c.fdSrv}/u.bin`, c.old, '舊目標2不變')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
        stall = false
        await reuse(ftp, c)
    })

    it('傳輸中途斷線: reject, 重新連線刪除暫存, 舊目標不變, 實例可續用', async function() {
        let c = prepareCase(fdBase, 'drop', { size: 600000 })
        let n = 0
        let drop = true
        let { ftp } = await connect(c, {
            hooks: {
                WRITE: ({ client, respond }) => {
                    n++
                    if (drop && n === 3) {
                        drop = false
                        client.end()
                        return
                    }
                    respond()
                },
            },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '斷線')
        assert.ok(!msgOf(e).includes('can not remove'), `暫存須已清(${msgOf(e)})`)
        assertOldKept(c, '斷線')
        assert.ok(rec.evs.some((v) => v.type === 'temp' && v.act === 'remove' && v.ok === true && v.kind === 'part'))
        assert.ok(rec.evs.some((v) => v.type === 'reconnect' && v.ok === true))
        await reuse(ftp, c)
    })

    it('伺服器寫入失敗(WRITE回FAILURE): reject原錯誤, 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'writefail', { size: 300000 })
        let n = 0
        let { ftp } = await connect(c, {
            hooks: {
                WRITE: ({ respond, fail }) => {
                    n++
                    if (n === 2) {
                        fail()
                        return
                    }
                    respond()
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '寫入失敗')
        assert.ok(e instanceof Error && e.code === 4, '沿用傳輸之原錯誤')
        assertOldKept(c, '寫入失敗')
    })

    it('傳輸停滯於WRITE: 超過timeLimit即reject, 中止後遠端無暫存、舊目標不變, 不再送出寫入, 實例可續用', async function() {
        let c = prepareCase(fdBase, 'stall-write', { size: 600000 })
        let held = []
        let nWrite = 0
        let stall = true
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: {
                WRITE: ({ respond }) => {
                    nWrite++
                    if (stall && nWrite > 1) {
                        held.push(respond)
                        return
                    }
                    respond()
                },
            },
        })
        let un = catchUnhandled()
        let rec = recorder()
        let ps = []
        let t0 = Date.now()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', (p) => ps.push(p), { onTrace: rec.onTrace }), '停滯WRITE')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[1500]')
        assert.ok(Date.now() - t0 >= 1500, '不得早於timeLimit')
        assertOldKept(c, '停滯WRITE')
        assert.ok(rec.evs.some((v) => v.type === 'timeout' && v.stage === 'transfer' && v.timeLimit === 1500))
        await rec.wait((v) => v.type === 'transfer' && v.late === true)
        stall = false
        let nAfter = ps.length
        for (let f of held) {
            f() //伺服器事後回應: 連線已銷毀, 不得再寫入
        }
        await reuse(ftp, c)
        assert.strict.deepEqual(ps.length, nAfter, '逾時後不再通知進度')
        assert.strict.deepEqual(un.list, [])
        un.stop()
    })

    it('傳輸停滯於OPEN: 逾時reject, 其後伺服器之開啟不留暫存', async function() {
        let c = prepareCase(fdBase, 'stall-open')
        let held = []
        let stall = true
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: {
                OPEN: ({ write, respond }) => {
                    if (stall && write) {
                        held.push(respond)
                        return
                    }
                    respond()
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '停滯OPEN')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[1500]')
        for (let f of held) {
            f()
        }
        assertOldKept(c, '停滯OPEN')
        stall = false
        await reuse(ftp, c)
    })

    it('mkdir前之stat停滯: 逾時reject, 無任何寫入, 實例可續用', async function() {
        let c = prepareCase(fdBase, 'stall-prep')
        let stall = true
        let { srv, ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: {
                STAT: ({ path: p, respond }) => {
                    if (stall && p.indexOf('deep') >= 0) {
                        return
                    }
                    respond()
                },
            },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './deep/x.bin', null, { onTrace: rec.onTrace }), '停滯prepare')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[1500]')
        assert.ok(rec.evs.some((v) => v.type === 'timeout' && v.stage === 'prepare'))
        assert.strict.deepEqual(srv.ops.filter((o) => o.op === 'open-write'), [])
        stall = false
        await reuse(ftp, c)
    })

    it('傳輸完成大小不符: reject固定訊息, 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'mismatch', { size: 5000 })
        let { srv, ftp } = await connect(c, {
            hooks: {
                statSize: (size, p) => (p.endsWith('.part') ? size - 3 : size),
            },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '大小不符')
        assert.strict.deepEqual(e, 'ftpUpload: uploaded size[4997] does not match local size[5000], fpRemote is not changed')
        assertOldKept(c, '大小不符')
        assert.ok(rec.evs.some((v) => v.type === 'verify' && v.ok === false && v.size === 4997 && v.sizeLocal === 5000))
        assert.strict.deepEqual(srv.ops.filter((o) => o.op.indexOf('rename') >= 0), [], '未改名')
    })

    it('取不到暫存大小(STAT失敗): reject固定訊息, 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'nosize')
        let { ftp } = await connect(c, {
            hooks: {
                STAT: ({ path: p, respond, fail }) => (p.endsWith('.part') ? fail() : respond()),
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '取不到大小')
        assert.ok(/^ftpUpload: can not get the size of the uploaded temporary file \([A-Z_0-9]+\), fpRemote is not changed$/.test(e), msgOf(e))
        assertOldKept(c, '取不到大小')
    })

    it('傳輸期間本機檔大小改變: reject, 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'localchg', { size: 200000 })
        let changed = false
        let { ftp } = await connect(c, {
            hooks: {
                WRITE: ({ respond }) => {
                    if (!changed) {
                        changed = true
                        fs.appendFileSync(c.fpLocal, 'x')
                    }
                    respond()
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '本機改變')
        assert.strict.deepEqual(e, 'ftpUpload: fpLocal was changed during upload, fpRemote is not changed')
        assertOldKept(c, '本機改變')
    })

    it('伺服器無posix-rename擴充: 覆蓋既有目標改走舊檔暫名交換, 成功且無暫存名', async function() {
        let c = prepareCase(fdBase, 'noposix')
        let { srv, ftp } = await connect(c, { posixRename: false })
        let rec = recorder()
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), 'ok')
        assertUploaded(c, '交換')
        let mv = srv.ops.filter((o) => o.op === 'rename' || o.op === 'posix-rename')
        assert.strict.deepEqual(mv.map((o) => [o.op, o.ok]), [['rename', false], ['rename', true], ['rename', true]])
        assert.ok(mv[1].from === './t.bin' && mv[1].to.endsWith('.old'), '舊檔先改暫名')
        assert.ok(mv[2].to === './t.bin' && mv[2].from.endsWith('.part'), '暫存改為目標')
        assert.ok(rec.evs.some((v) => v.type === 'move' && v.mode === 'swap'))
        assert.ok(rec.evs.some((v) => v.type === 'temp' && v.kind === 'old' && v.ok === true))
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './n.bin', null, { onTrace: rec.onTrace }), 'ok')
        assert.ok(rec.evs.some((v) => v.type === 'move' && v.mode === 'rename'), '目標不存在者直接rename')
    })

    it('伺服器不允許改名: reject固定訊息(不回顯伺服器訊息), 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'norename')
        let { ftp } = await connect(c, { hooks: { RENAME: ({ deny }) => deny() } })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '不允許改名')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (3), fpRemote is not changed')
        assertOldKept(c, '不允許改名')
    })

    it('交換中第二次改名失敗: 舊檔改回目標, 暫存已刪', async function() {
        let c = prepareCase(fdBase, 'swapfail')
        let { ftp } = await connect(c, {
            posixRename: false,
            hooks: {
                RENAME: ({ from, to, respond, deny }) => (from.endsWith('.part') && to === './t.bin' ? deny() : respond()),
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '交換失敗')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (3), fpRemote is not changed')
        assertOldKept(c, '交換失敗')
    })

    it('交換中(舊檔已改暫名)伺服器斷線: 重新連線把舊檔改回目標, 暫存已刪', async function() {
        let c = prepareCase(fdBase, 'swapdrop')
        let hit = true
        let { ftp } = await connect(c, {
            posixRename: false,
            hooks: {
                RENAME: ({ client, from, to, respond }) => {
                    if (hit && from.endsWith('.part') && to === './t.bin' && !fs.existsSync(c.fpSrv)) {
                        hit = false
                        client.end()
                        return
                    }
                    respond()
                },
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '交換斷線')
        assert.ok(/^ftpUpload: can not rename the temporary file to fpRemote \([A-Z_0-9]+\), fpRemote may or may not be updated$/.test(e), msgOf(e))
        assertOldKept(c, '交換斷線')
        await reuse(ftp, c)
    })

    it('逾時後重新連線被拒: 訊息標示暫存未清; 伺服器恢復後下一次上傳先重新連線即可成功', async function() {
        let c = prepareCase(fdBase, 'reauth')
        fs.mkdirSync(`${c.fdSrv}/d`)
        let stall = true
        let denyAuth = false
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: {
                WRITE: ({ respond }) => {
                    if (stall) {
                        denyAuth = true
                        return
                    }
                    respond()
                },
                AUTH: () => !denyAuth,
            },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '重連被拒')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[1500], can not remove the remote temporary file')
        assertFile(c.fpSrv, c.old, '舊目標不變')
        stall = false
        denyAuth = false
        assert.strict.deepEqual(await ftp.upload(c.fpLocal, './d/n.bin'), 'ok', '含資料夾之路徑亦先重新連線')
        assertFile(`${c.fdSrv}/d/n.bin`, c.fresh, '新檔')
    })

    it('傳輸中本機檔被改短: 不停滯, reject本機檔改變, 暫存已刪, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'truncate', { size: 4 * 1024 * 1024 })
        let cut = false
        let { ftp } = await connect(c, {
            timeLimit: 30000,
            hooks: {
                WRITE: ({ respond }) => {
                    if (!cut) {
                        cut = true
                        fs.truncateSync(c.fpLocal, 10)
                    }
                    respond()
                },
            },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '改短', 10000)
        assert.strict.deepEqual(e, 'ftpUpload: fpLocal was changed during upload, fpRemote is not changed')
        assert.ok(!rec.evs.some((v) => v.type === 'timeout'))
        assertOldKept(c, '改短')
    })

    it('目標為資料夾: reject改名失敗, 資料夾不被搬走, 無暫存名', async function() {
        let c = prepareCase(fdBase, 'dirtarget', { old: false })
        fs.mkdirSync(`${c.fdSrv}/t.bin`)
        fs.writeFileSync(`${c.fdSrv}/t.bin/keep.txt`, 'k')
        let { ftp } = await connect(c, { posixRename: false })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '目標為資料夾')
        assert.ok(e.startsWith('ftpUpload: can not rename the temporary file to fpRemote ('), e)
        assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/t.bin/keep.txt`, 'utf8'), 'k')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
    })

    it('伺服器不允許刪除舊檔暫名: reject明示目標已更新(不靜默成功)', async function() {
        let c = prepareCase(fdBase, 'nodel-old')
        let { ftp } = await connect(c, {
            posixRename: false,
            hooks: { REMOVE: ({ path: p, respond, deny }) => (p.endsWith('.old') ? deny() : respond()) },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '刪舊暫名失敗')
        assert.strict.deepEqual(e, 'ftpUpload: fpRemote is updated, but can not remove the old file kept under a temporary name in the same folder')
        assertFile(c.fpSrv, c.fresh, '目標已更新')
        let left = leftovers(c.fdSrv)
        assert.strict.deepEqual(left.length, 1)
        assertFile(`${c.fdSrv}/${left[0]}`, c.old, '舊檔暫名保留舊內容')
        assert.ok(rec.evs.some((v) => v.type === 'temp' && v.kind === 'old' && v.ok === false))
    })

    it('失敗且伺服器不允許刪除暫存: 訊息加後綴, onTrace回報, 舊目標不變', async function() {
        let c = prepareCase(fdBase, 'nodel-part')
        let { ftp } = await connect(c, {
            hooks: {
                statSize: (size, p) => (p.endsWith('.part') ? size + 1 : size),
                REMOVE: ({ deny }) => deny(),
            },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '刪暫存失敗')
        assert.ok(e.endsWith('fpRemote is not changed, can not remove the remote temporary file'), e)
        assertFile(c.fpSrv, c.old, '舊目標不變')
        assert.ok(rec.evs.some((v) => v.type === 'temp' && v.kind === 'part' && v.ok === false))
        assert.ok(!rec.evs.some((v) => v.type === 'reconnect'), '伺服器回應之拒絕不重新連線')
    })

    it('改名停滯: 逾時reject「可能已更新」, 暫存已刪, 舊目標存在, 實例可續用', async function() {
        let c = prepareCase(fdBase, 'stall-rename')
        let stall = true
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            hooks: { RENAME: ({ respond }) => (stall ? null : respond()) },
        })
        let rec = recorder()
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace }), '停滯改名')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[1500] while renaming, fpRemote may or may not be updated')
        assert.ok(rec.evs.some((v) => v.type === 'timeout' && v.stage === 'rename'))
        assertOldKept(c, '停滯改名')
        stall = false
        await reuse(ftp, c)
    })

    it('交換中停滯於暫存改名: 逾時後舊檔改回目標, 暫存已刪', async function() {
        let c = prepareCase(fdBase, 'stall-swap')
        let { ftp } = await connect(c, {
            timeLimit: 1500,
            posixRename: false,
            hooks: { RENAME: ({ from, to, respond }) => (from.endsWith('.part') && to === './t.bin' && !fs.existsSync(c.fpSrv) ? null : respond()) },
        })
        let e = await rejected(ftp.upload(c.fpLocal, './t.bin'), '交換停滯')
        assert.strict.deepEqual(e, 'ftpUploadCore timeout[1500] while renaming, fpRemote may or may not be updated')
        assertOldKept(c, '交換停滯')
    })

    it('傳輸中於無待回應寫入時連線關閉: 立即reject(不等timeLimit)', async function() {
        let c = prepareCase(fdBase, 'close-idle', { size: 100000 })
        let conn = null
        //sc, 取得本套件之ssh2-sftp-client實例, 以其底層連線之'close'事件確認客戶端已完成關閉
        let sc = null
        let connectReal = SFTPClient.prototype.connect
        mock.method(SFTPClient.prototype, 'connect', function(...args) {
            sc = this
            return connectReal.apply(this, args)
        })
        let { ftp } = await connect(c, {
            timeLimit: 30000,
            hooks: {
                WRITE: ({ client, respond }) => {
                    conn = client
                    respond()
                },
            },
        })
        //reader, 以可控之串流取代本機讀取: 第1塊寫入已回應(進度回呼)後關閉連線, 連線關閉後才供應第2塊
        let reader = new Readable({ read() {} })
        let createReadStream = fs.createReadStream
        mock.method(fs, 'createReadStream', function(p, ...args) {
            if (p === c.fpLocal) {
                reader.push(c.fresh.subarray(0, 32768))
                return reader
            }
            return createReadStream.call(this, p, ...args)
        })
        let acked = signal()
        let p = ftp.upload(c.fpLocal, './t.bin', () => acked.fire())
        await acked.wait()
        let closed = signal()
        sc.client.once('close', () => setImmediate(() => closed.fire())) //ssh2於'close'事件之後才收尾各通道
        conn.end()
        await closed.wait()
        reader.push(c.fresh.subarray(32768, 65536))
        let r = await settleWithin(p, 10000)
        mock.restoreAll()
        reader.destroy()
        assert.ok(r.settled, '連線關閉後須立即結束')
        assert.ok(!r.ok)
        assert.ok(msgOf(r.err).indexOf('timeout') < 0, msgOf(r.err))
        assertFile(c.fpSrv, c.old, '舊目標不變')
    })

    it('交換中(舊檔改暫名待回應)quit: reject, 其後不重新連線', async function() {
        let c = prepareCase(fdBase, 'quit-swap')
        let held = signal()
        let nAuth = 0
        let { ftp } = await connect(c, {
            posixRename: false,
            hooks: {
                AUTH: () => {
                    nAuth++
                    return true
                },
                RENAME: ({ from, respond }) => {
                    if (from === './t.bin') {
                        held.fire() //舊檔改暫名: 不回應
                        return
                    }
                    respond()
                },
            },
        })
        let p = ftp.upload(c.fpLocal, './t.bin')
        await held.wait()
        let nBefore = nAuth
        await ftp.quit()
        let e = await rejected(p, 'quit-swap', 10000)
        assert.ok(msgOf(e).includes('fpRemote may or may not be updated'), msgOf(e))
        assert.strict.deepEqual(nAuth, nBefore, 'quit後不得再登入')
        assertFile(c.fpSrv, c.old, '舊目標不變')
    })

    it('傳輸中quit: reject, 不重新連線, 訊息標示暫存未清', async function() {
        let c = prepareCase(fdBase, 'quit', { size: 600000 })
        let held = signal()
        let { srv, ftp } = await connect(c, {
            hooks: {
                WRITE: () => held.fire(), //不回應
            },
        })
        let rec = recorder()
        let p = ftp.upload(c.fpLocal, './t.bin', null, { onTrace: rec.onTrace })
        await held.wait()
        await ftp.quit()
        let e = await rejected(p, 'quit')
        assert.ok(msgOf(e).endsWith('can not remove the remote temporary file'), msgOf(e))
        assert.ok(!rec.evs.some((v) => v.type === 'reconnect'), '使用者quit後不重新連線')
        assertFile(c.fpSrv, c.old, '舊目標不變')
        assert.strict.deepEqual(srv.ops.filter((o) => o.op === 'remove'), [])
    })

    it('fpRemote以/結尾: reject且不送任何遠端指令; 本機檔不存在或為資料夾: 訊息不變', async function() {
        let c = prepareCase(fdBase, 'badpath')
        let { srv, ftp } = await connect(c)
        assert.strict.deepEqual(await rejected(ftp.upload(c.fpLocal, './dir/'), '尾斜線'), 'ftpUpload: fpRemote is not a file path, fpRemote is not changed')
        assert.strict.deepEqual(await rejected(ftp.upload(`${c.fpLocal}.none`, './t.bin'), '本機不存在'), `fpLocal[${c.fpLocal}.none] is not a file`)
        assert.strict.deepEqual(await rejected(ftp.upload(path.dirname(c.fpLocal), './t.bin'), '本機資料夾'), `fpLocal[${path.dirname(c.fpLocal)}] is not a file`)
        assert.strict.deepEqual(srv.ops, [])
        assertOldKept(c, 'badpath')
    })

    it('onTrace回調(未給、非函數、拋錯、回傳rejection、讀取拋錯)與cbProcess拋錯: 結果相同且無未處理rejection', async function() {
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
            new Proxy({}, {
                get: () => {
                    throw new Error('g')
                },
            }),
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
            hooks: { statSize: (size, p) => (/b\.bin\..*\.part$/.test(p) ? size - 1 : size) },
        })
        let rec = recorder()
        let e = await rejected(ftp.syncToRemote(fdUp, '.', null, { onTrace: rec.onTrace }), 'sync失敗')
        assert.strict.deepEqual(e, 'ftpUpload: uploaded size[1001] does not match local size[1002], fpRemote is not changed')
        assertFile(`${c.fdSrv}/a.bin`, genBytes(1001, 1), '已上傳者保留')
        assertFile(`${c.fdSrv}/b.bin`, genBytes(11, 9), '失敗者維持舊檔')
        assert.strict.deepEqual(fs.existsSync(`${c.fdSrv}/c.bin`), false, '其後不上傳')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
        assert.strict.deepEqual(rec.evs.filter((v) => v.type === 'verify').map((v) => v.ok), [true, false], 'onTrace轉交各檔')
    })

    it('syncToRemote: 轉交levelLimit與forceOverwriteWhenSync, 回傳{num, files}; opt為null不拋錯', async function() {
        let c = prepareCase(fdBase, 'sync-opt', { old: false })
        let fdUp = `${path.dirname(c.fpLocal)}/up`
        fs.mkdirSync(`${fdUp}/sub`, { recursive: true })
        fs.writeFileSync(`${fdUp}/a.bin`, genBytes(1001, 1))
        fs.writeFileSync(`${fdUp}/sub/d.bin`, genBytes(55, 4))
        let { ftp } = await connect(c)
        let r = await ftp.syncToRemote(fdUp, '.', null, { levelLimit: 1 })
        assert.strict.deepEqual(r, { num: 1, files: [{ name: './a.bin', reason: 'no Remote file' }] })
        assert.strict.deepEqual(fs.existsSync(`${c.fdSrv}/sub`), false, 'levelLimit=1不上傳子資料夾')
        let r2 = await ftp.syncToRemote(fdUp, '.', null, { levelLimit: 1 })
        assert.strict.deepEqual(r2.num, 0)
        let r3 = await ftp.syncToRemote(fdUp, '.', null, { levelLimit: 1, forceOverwriteWhenSync: true })
        assert.strict.deepEqual(r3.num, 1)
        let r4 = await ftp.syncToRemote(fdUp, '.', null, null)
        assert.strict.deepEqual(r4.num, 1)
        assertFile(`${c.fdSrv}/sub/d.bin`, genBytes(55, 4), '子資料夾')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
    })

})
