import fs from 'fs'
import net from 'net'
import assert from 'assert'
import { mock } from 'node:test'
import { recorder, signal, gate } from './lib/dlTestKit.mjs'
import { prepareDirs, put, tree, harness, muteServer, refusedPort, rejected, resolved } from './lib/connTestKit.mjs'
import w from 'wsemi'


//FTP之連線生命週期: 連不上、控制連線被關閉(隱式重連)、各操作之逾時、絕對路徑; 以假FTP伺服器重現
describe('api-ftp-conn', function() {

    let fdBase = './test/_tmp/api-ftp-conn'
    let notInit = `FTP has not been initialized. please use 'conn' to construct FTP`
    let TL = 1500
    let h = null

    beforeEach(function() {
        h = harness()
    })

    afterEach(async function() {
        await h.cleanup()
    })

    after(function() {
        w.fsDeleteFolder(fdBase)
    })

    //connected, 啟動假伺服器並建立已conn之實例
    let connected = async (name, { server = {}, client = {} } = {}) => {
        let c = prepareDirs(fdBase, name)
        let srv = await h.ftpServer({ fdRoot: c.fdSrv, ...server })
        let ftp = h.client('FTP', srv.port, { timeLimit: TL, fdDownloadTemp: c.fdTemp, ...client })
        await resolved(ftp.conn(), 'conn')
        return { c, srv, ftp }
    }

    //stallCmd, 停滯指定指令(n次), 其餘照常
    let stall = (pred) => {
        let st = { on: true, hit: signal() }
        st.hook = (ctx) => {
            if (st.on && pred(ctx.cmd, ctx.arg)) {
                st.hit.fire()
                return true
            }
            return false
        }
        return st
    }

    describe('conn之連線錯誤', function() {

        it('連不上(拒絕連線): conn以固定訊息reject, 不使行程中止; 其後操作視為未連線', async function() {
            let port = await refusedPort()
            let ftp = h.client('FTP', port, { timeLimit: 15000 })
            let rec = recorder()
            let e = await rejected(ftp.conn({ onTrace: rec.onTrace }), '拒絕連線')
            assert.strict.deepEqual(e, 'ftpConn: can not connect to the server (ECONNREFUSED)')
            assert.strict.deepEqual(rec.evs, [{ type: 'connect', ok: false, code: 'ECONNREFUSED' }])
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), notInit)
            assert.strict.deepEqual(await rejected(ftp.upload('./test/lib/connTestKit.mjs', './x'), 'upload'), notInit)
            assert.strict.deepEqual(await resolved(ftp.quit(), 'conn失敗後quit照常完成'), 'ok')
            assert.strict.deepEqual(await rejected(ftp.quit(), 'quit2'), notInit)
        })

        it('伺服器接受連線但不送歡迎訊息: conn依timeLimit逾時reject並關閉連線', async function() {
            let ms = await muteServer()
            h.track(ms.close)
            let ftp = h.client('FTP', ms.port, { timeLimit: 600 })
            let rec = recorder()
            let e = await rejected(ftp.conn({ onTrace: rec.onTrace }), '無歡迎訊息')
            assert.strict.deepEqual(e, 'ftpConn timeout[600]')
            assert.strict.deepEqual(rec.evs, [
                { type: 'timeout', timeLimit: 600, stage: 'connect' },
                { type: 'connect', ok: false, code: 'TIMEOUT' },
            ])
            await resolved(ms.waitClosed(), '伺服器端連線須關閉')
        })

        it('歡迎訊息為拒絕服務(421): conn以固定訊息reject, 只帶回應碼', async function() {
            let { c } = { c: prepareDirs(fdBase, 'greet421') }
            let srv = await h.ftpServer({ fdRoot: c.fdSrv, greeting: '421 too many connections from 10.0.0.1' })
            let ftp = h.client('FTP', srv.port, { timeLimit: TL })
            assert.strict.deepEqual(await rejected(ftp.conn(), '421'), 'ftpConn: can not connect to the server (421)')
        })

        it('歡迎訊息前伺服器即關閉連線: conn以固定訊息reject', async function() {
            let srvC = net.createServer((s) => {
                s.on('error', () => {})
                s.end()
            })
            await new Promise((resolve) => srvC.listen(0, '127.0.0.1', resolve))
            h.track(() => new Promise((resolve) => srvC.close(resolve)))
            let ftp = h.client('FTP', srvC.address().port, { timeLimit: TL })
            assert.strict.deepEqual(await rejected(ftp.conn(), '關閉'), 'ftpConn: can not connect to the server (CLOSED)')
        })

        it('conn進行中即quit: quit直接完成, conn以固定訊息reject', async function() {
            let ms = await muteServer()
            h.track(ms.close)
            let ftp = h.client('FTP', ms.port, { timeLimit: 15000 })
            let p = ftp.conn()
            let q = ftp.ls('.')
            let pe = rejected(p, 'conn')
            let qe = rejected(q, 'ls')
            assert.strict.deepEqual(await resolved(ftp.quit(), 'quit'), 'ok')
            assert.strict.deepEqual(await pe, 'ftpConn: can not connect to the server (CLOSED)')
            assert.strict.deepEqual(await qe, notInit)
            await resolved(ms.waitClosed(), '連線須關閉')
        })

        it('conn進行中呼叫之操作於連不上時reject視為未連線', async function() {
            let port = await refusedPort()
            let ftp = h.client('FTP', port, { timeLimit: 15000 })
            let p = rejected(ftp.conn(), 'conn', 15000)
            let q = rejected(ftp.isFile('./a'), 'isFile', 15000)
            assert.strict.deepEqual(await p, 'ftpConn: can not connect to the server (ECONNREFUSED)')
            assert.strict.deepEqual(await q, notInit)
        })

        it('conn之後不await即呼叫操作: 等待連線建立後照常執行', async function() {
            let c = prepareDirs(fdBase, 'noawait')
            put(c.fdSrv, 'a.txt', 'abc')
            let srv = await h.ftpServer({ fdRoot: c.fdSrv })
            let ftp = h.client('FTP', srv.port, { timeLimit: TL })
            let p1 = ftp.conn()
            let p2 = ftp.isFile('./a.txt')
            assert.strict.deepEqual(await resolved(p1, 'conn'), 'ok')
            assert.strict.deepEqual(await resolved(p2, 'isFile'), true)
        })

    })

    describe('控制連線被伺服器關閉後之下一個操作', function() {

        it('曾cwd: 重新連線時先重放cwd, 上傳、下載、列舉、查詢、建資料夾與pwd仍以該資料夾為準, 根目錄不被寫入', async function() {
            let { c, srv, ftp } = await connected('replay')
            put(c.fdSrv, 'sub/in.txt', 'in-sub')
            await ftp.cwd('sub')

            await resolved(srv.dropControls(), 'drop1')
            fs.writeFileSync(`${c.fdLocal}/up.bin`, 'UP-CONTENT')
            let rec = recorder()
            assert.strict.deepEqual(await resolved(ftp.upload(`${c.fdLocal}/up.bin`, './up.bin', null, { onTrace: rec.onTrace }), 'upload'), 'ok')
            assert.strict.deepEqual(tree(c.fdSrv), ['sub/', 'sub/in.txt', 'sub/up.bin'], '上傳須寫入工作資料夾')
            assert.strict.deepEqual(rec.evs[0], { type: 'reconnect', ok: true })
            assert.strict.deepEqual(srv.cmds.filter((v) => /^cwd /i.test(v)), ['cwd sub', 'cwd sub'])

            await resolved(srv.dropControls(), 'drop2')
            let rec2 = recorder()
            assert.strict.deepEqual(await resolved(ftp.download('./in.txt', `${c.fdLocal}/in.txt`, null, { onTrace: rec2.onTrace }), 'download'), 'ok')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdLocal}/in.txt`, 'utf8'), 'in-sub')
            assert.strict.deepEqual(rec2.evs[0], { type: 'reconnect', ok: true })

            await resolved(srv.dropControls(), 'drop3')
            let rs = await resolved(ftp.ls('.'), 'ls')
            assert.strict.deepEqual(rs.map((v) => v.name).sort(), ['in.txt', 'up.bin'])

            await resolved(srv.dropControls(), 'drop4')
            assert.strict.deepEqual(await resolved(ftp.isFile('./in.txt'), 'isFile'), true)

            await resolved(srv.dropControls(), 'drop5')
            await resolved(ftp.mkdir('./m1/m2/f.txt'), 'mkdir')
            assert.ok(fs.existsSync(`${c.fdSrv}/sub/m1/m2`) && !fs.existsSync(`${c.fdSrv}/m1`), '資料夾須建於工作資料夾')

            await resolved(srv.dropControls(), 'drop6')
            let r = await resolved(ftp.pwd(), 'pwd')
            assert.ok(r.text.includes('"/sub"'), r.text)

            await resolved(srv.dropControls(), 'drop7')
            put(c.fdLocal, 'tree/s.txt', 'synced')
            fs.mkdirSync(`${c.fdSrv}/sub/dst`) //syncToRemote之遠端資料夾須已存在(原版行為)
            await resolved(ftp.syncToRemote(`${c.fdLocal}/tree`, './dst', null), 'syncToRemote')
            assert.ok(fs.existsSync(`${c.fdSrv}/sub/dst/s.txt`) && !fs.existsSync(`${c.fdSrv}/dst`), '同步須寫入工作資料夾')
        })

        it('相對路徑多段cwd: 依序重放', async function() {
            let { c, srv, ftp } = await connected('replay-chain')
            fs.mkdirSync(`${c.fdSrv}/a/b`, { recursive: true })
            await ftp.cwd('a')
            await ftp.cwd('b')
            await resolved(srv.dropControls(), 'drop')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload')
            assert.strict.deepEqual(tree(c.fdSrv), ['a/', 'a/b/', 'a/b/f.txt'])
            assert.strict.deepEqual(srv.cmds.filter((v) => /^cwd /i.test(v)), ['cwd a', 'cwd b', 'cwd a', 'cwd b'])
        })

        it('重放cwd失敗(資料夾已不存在): reject固定訊息, 不寫到他處; 其後須重新conn', async function() {
            let { c, srv, ftp } = await connected('replay-fail')
            fs.mkdirSync(`${c.fdSrv}/sub`)
            await ftp.cwd('sub')
            await resolved(srv.dropControls(), 'drop')
            fs.rmdirSync(`${c.fdSrv}/sub`)
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            let rec = recorder()
            let e = await rejected(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt', null, { onTrace: rec.onTrace }), 'upload')
            assert.strict.deepEqual(e, `ftpUpload: can not restore the working directory after reconnecting (550), please use 'conn' to construct FTP`)
            assert.strict.deepEqual(tree(c.fdSrv), [], '不得寫入任何位置')
            assert.strict.deepEqual(rec.evs, [{ type: 'reconnect', ok: false }])
            assert.strict.deepEqual(await rejected(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), '再次'), notInit)
            assert.strict.deepEqual(tree(c.fdSrv), [])
            await resolved(ftp.conn(), 'conn')
            assert.strict.deepEqual(await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), '重連後'), 'ok')
        })

        it('未曾cwd: 閒置關閉後下一個操作照常(重新連線)', async function() {
            let { c, srv, ftp } = await connected('idle-nocwd')
            put(c.fdSrv, 'a.txt', 'abc')
            assert.strict.deepEqual(await resolved(ftp.isFile('./a.txt'), 'first'), true)
            await resolved(srv.dropControls(), 'drop')
            assert.strict.deepEqual(await resolved(ftp.isFile('./a.txt'), 'second'), true)
            assert.strict.deepEqual(srv.nAccept(), 2)
        })

        it('重新連線時連不上: reject固定訊息; 伺服器恢復後下一個操作重放cwd成功', async function() {
            let { c, srv, ftp } = await connected('reconnect-refused')
            put(c.fdSrv, 'sub/a.txt', 'abc')
            await ftp.cwd('sub')
            await resolved(srv.dropControls(), 'drop')
            let port = srv.port
            await srv.close()
            let rec = recorder()
            let e = await rejected(ftp.download('./a.txt', `${c.fdLocal}/a.txt`, null, { onTrace: rec.onTrace }), 'down', 15000)
            assert.strict.deepEqual(e, 'ftpDownload: can not reconnect to the server (ECONNREFUSED)')
            assert.strict.deepEqual(rec.evs, [{ type: 'reconnect', ok: false }])
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls', 15000), 'ftpLs: can not reconnect to the server (ECONNREFUSED)')
            let srv2 = await h.ftpServer({ fdRoot: c.fdSrv, port })
            assert.strict.deepEqual(await resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'down2'), 'ok')
            assert.strict.deepEqual(srv2.cmds.filter((v) => /^cwd /i.test(v)), ['cwd sub'])
        })

        it('重新連線停滯: 依timeLimit以固定訊息reject並關閉該連線', async function() {
            let { c, srv, ftp } = await connected('reconnect-mute')
            await resolved(ftp.pwd(), 'pwd') //先確認連線已建立
            await resolved(srv.dropControls(), 'drop')
            let port = srv.port
            await srv.close()
            let ms = net.createServer((s) => {
                s.on('error', () => {})
                s.on('data', () => {})
            })
            await new Promise((resolve) => ms.listen(port, '127.0.0.1', resolve))
            let socks = []
            let fireClosed = null
            let closed = new Promise((resolve) => {
                fireClosed = resolve
            })
            ms.on('connection', (s) => {
                socks.push(s)
                s.on('close', fireClosed)
            })
            h.track(() => new Promise((resolve) => {
                for (let s of socks) {
                    s.destroy()
                }
                ms.close(resolve)
            }))
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls', 15000), `ftpLs: can not reconnect to the server (TIMEOUT)`)
            assert.ok(fs.existsSync(c.fdSrv))
            assert.strict.deepEqual(socks.length, 1)
            await resolved(closed, '停滯之連線須關閉', 5000)
        })

        it('以RST中斷控制連線: 不使行程中止, 其後可重新連線', async function() {
            let { c, srv, ftp } = await connected('reset')
            put(c.fdSrv, 'a.txt', 'abc')
            assert.strict.deepEqual(await resolved(ftp.isFile('./a.txt'), 'first'), true)
            await resolved(srv.dropControls({ how: 'reset' }), 'reset')
            let ok = false
            for (let i = 0; i < 5 && !ok; i++) {
                ok = await ftp.isFile('./a.txt').catch(() => false)
            }
            assert.strict.deepEqual(ok, true)
        })

        it('併發操作於斷線後只建立一條新連線', async function() {
            let { c, srv, ftp } = await connected('single-flight')
            put(c.fdSrv, 'sub/a.txt', 'abc')
            await ftp.cwd('sub')
            await resolved(srv.dropControls(), 'drop')
            let rec = recorder()
            let rs = await resolved(Promise.all([
                ftp.isFile('./a.txt'),
                ftp.isFile('./a.txt', { onTrace: rec.onTrace }),
                ftp.ls('.'),
                ftp.pwd(),
            ]), 'all')
            assert.strict.deepEqual([rs[0], rs[1], rs[2].map((v) => v.name)], [true, true, ['a.txt']])
            assert.strict.deepEqual(srv.nAccept(), 2)
            assert.strict.deepEqual(rec.evs, [{ type: 'reconnect', ok: true }], '加入同一次嘗試者亦收到事件')
        })

        it('重放cwd停滯: 依timeLimit以固定訊息reject, 其後須重新conn', async function() {
            let n = 0
            let { c, srv, ftp } = await connected('replay-stall', { server: { hooks: { CMD: ({ cmd }) => cmd === 'CWD' && n++ >= 1 } } })
            fs.mkdirSync(`${c.fdSrv}/sub`)
            await resolved(ftp.cwd('sub'), 'cwd')
            await resolved(srv.dropControls(), 'drop')
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), `ftpLs: can not restore the working directory after reconnecting (TIMEOUT), please use 'conn' to construct FTP`)
            await resolved(srv.waitControls(0), '連線須關閉', 5000)
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls2'), notInit)
        })

        it('上傳之重新連線(重放cwd)停滯而遭中止: 不沿用舊連線, 須重新conn(第658項契約)', async function() {
            let n = 0
            let { c, srv, ftp } = await connected('upload-replay-stall', {
                server: { hooks: { CMD: ({ cmd }) => cmd === 'STOR' || (cmd === 'CWD' && n++ >= 1) } },
            })
            fs.mkdirSync(`${c.fdSrv}/sub`)
            await resolved(ftp.cwd('sub'), 'cwd')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            let rec = recorder()
            let e = await rejected(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt', null, { onTrace: rec.onTrace }), 'upload', 15000)
            assert.strict.deepEqual(e, `ftpUploadCore timeout[${TL}], can not remove the remote temporary file`)
            assert.ok(rec.evs.some((v) => v.type === 'timeout' && v.stage === 'clean'), '清理階段(含重新連線)逾時而中止')
            assert.strict.deepEqual(srv.cmds.filter((v) => /^cwd /i.test(v)), ['cwd sub', 'cwd sub'])
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), notInit)
            assert.strict.deepEqual(tree(c.fdSrv), ['sub/'])
        })

        it('上傳清理之重新連線尚未連上即遭中止(未曾cwd): 保留舊連線, 其後操作重新連線可用', async function() {
            let hit = false
            let { c, srv, ftp } = await connected('upload-connect-stall', {
                server: {
                    hooks: {
                        GREET: ({ n, send }) => {
                            if (n !== 2) {
                                send()
                            }
                        },
                        CMD: ({ cmd }) => cmd === 'STOR' && !hit && (hit = true),
                    },
                },
            })
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            await rejected(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload', 15000)
            assert.strict.deepEqual(await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload2'), 'ok')
            assert.ok(srv.nAccept() >= 3)
        })

        it('上傳中另行conn而失敗: 清理不另建連線, 訊息標示暫存未清', async function() {
            let sg = signal()
            let { c, srv, ftp } = await connected('upload-conn-failed', {
                server: {
                    hooks: {
                        GREET: ({ n, send }) => send(n === 2 ? '421 too many connections' : undefined),
                        CMD: ({ cmd }) => cmd === 'STOR' && (sg.fire(), true),
                    },
                },
            })
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            let p = rejected(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload', 15000)
            await sg.wait()
            assert.strict.deepEqual(await rejected(ftp.conn(), 'conn2'), 'ftpConn: can not connect to the server (421)')
            assert.strict.deepEqual(await p, `ftpUploadCore timeout[${TL}], can not remove the remote temporary file`)
            assert.strict.deepEqual(srv.nAccept(), 2)
        })

        it('quit取消進行中之重新連線: 該操作視為未連線, 該連線隨即關閉', async function() {
            let sg = signal()
            let { srv, ftp } = await connected('quit-cancel', {
                client: { timeLimit: 60000 },
                server: {
                    hooks: {
                        GREET: ({ n, send }) => {
                            if (n === 1) {
                                send()
                                return
                            }
                            sg.fire()
                        },
                    },
                },
            })
            await resolved(ftp.pwd(), 'pwd')
            await resolved(srv.dropControls(), 'drop')
            let q = rejected(ftp.ls('.'), 'ls')
            await sg.wait()
            assert.strict.deepEqual(await resolved(ftp.quit(), 'quit'), 'ok')
            assert.strict.deepEqual(await q, notInit)
            await resolved(srv.waitControls(0), '重新連線中之連線須關閉', 5000)
        })

        it('cwd回覆前另行conn: cwd以固定訊息reject且不記錄', async function() {
            let { c, srv, ftp } = await connected('cwd-replaced')
            fs.mkdirSync(`${c.fdSrv}/sub`)
            let p = rejected(ftp.cwd('sub'), 'cwd')
            await resolved(ftp.conn(), 'conn2')
            assert.strict.deepEqual(await p, 'ftpCwd: the connection to the server is closed (REPLACED)')
            await resolved(srv.dropControls(), 'drop')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload')
            assert.strict.deepEqual(tree(c.fdSrv), ['f.txt', 'sub/'])
        })

        for (let [name, cmdName, fn] of [
            ['下載(RETR待回應)', 'RETR', (ftp, c) => ftp.download('./a.txt', `${c.fdLocal}/a.txt`)],
            ['列舉(LIST退路待回應)', 'LIST', (ftp) => ftp.ls('.')],
        ]) {
            it(`${name}時伺服器僅關閉控制連線: reject並釋放數據連線`, async function() {
                let { c, srv, ftp } = await connected(`keepdata-${cmdName}`, {
                    client: { timeLimit: 60000 },
                    server: {
                        keepData: true,
                        hooks: {
                            CMD: ({ cmd, reply, destroy }) => {
                                if (cmd === 'STAT') {
                                    reply('502 not implemented') //使jsftp改用LIST
                                    return true
                                }
                                if (cmd === cmdName) {
                                    destroy()
                                    return true
                                }
                                return false
                            },
                        },
                    },
                })
                put(c.fdSrv, 'a.txt', 'abc')
                await rejected(fn(ftp, c), name)
                await resolved(srv.waitData(0), '數據連線須關閉', 5000)
            })
        }

        it('下載傳輸中伺服器僅關閉控制連線, 同時列舉: 列舉reject, 下載中之數據連線不被銷毀而完成', async function() {
            let sgData = signal()
            let go = gate()
            let n = 0
            let { c, ftp } = await connected('busy-data', {
                client: { timeLimit: 60000 },
                server: {
                    keepData: true,
                    hooks: {
                        RETR: async ({ data, reply, waitDs }) => {
                            reply('150 ok')
                            let ds = await waitDs()
                            sgData.fire()
                            await go.wait()
                            ds.end(data)
                        },
                        CMD: ({ cmd, destroy }) => cmd === 'STAT' && n++ === 0 && (destroy(), true),
                    },
                },
            })
            put(c.fdSrv, 'a.txt', 'abc')
            let pd = resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download')
            await sgData.wait()
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), 'ftpLs: the connection to the server is closed (CLOSED)')
            go.open()
            assert.strict.deepEqual(await pd, 'ok')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdLocal}/a.txt`, 'utf8'), 'abc')
        })

        it('下載各階段間控制連線中斷(模擬於暫存區清理之I/O期間): 不於未重放cwd之新連線取檔, 本機舊檔不動', async function() {
            let { c, srv, ftp } = await connected('gap-download')
            put(c.fdSrv, 'sub/a.txt', 'FROM-SUB')
            put(c.fdSrv, 'a.txt', 'FROM-ROOT')
            await resolved(ftp.cwd('sub'), 'cwd')
            fs.writeFileSync(`${c.fdLocal}/a.txt`, 'OLD')
            let readdirReal = fs.promises.readdir
            mock.method(fs.promises, 'readdir', async (...args) => {
                await srv.dropControls()
                return readdirReal(...args)
            })
            try {
                assert.strict.deepEqual(await rejected(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download'), 'ftpDownload: the connection to the server is closed (CLOSED)')
            }
            finally {
                mock.restoreAll()
            }
            assert.strict.deepEqual(fs.readFileSync(`${c.fdLocal}/a.txt`, 'utf8'), 'OLD')
            assert.strict.deepEqual(await resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download2'), 'ok')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdLocal}/a.txt`, 'utf8'), 'FROM-SUB')
            assert.strict.deepEqual(srv.nAccept(), 2, '中斷之連線不得由jsftp另行隱式重連')
        })

        it('再次conn: 工作資料夾紀錄重設', async function() {
            let { c, srv, ftp } = await connected('reconn-reset')
            fs.mkdirSync(`${c.fdSrv}/sub`)
            await resolved(ftp.cwd('sub'), 'cwd')
            await resolved(ftp.conn(), 'conn2')
            await resolved(srv.dropControls(), 'drop')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload')
            assert.strict.deepEqual(tree(c.fdSrv), ['f.txt', 'sub/'])
        })

        it('quit於已被關閉之連線: resolve且不另建連線', async function() {
            let { srv, ftp } = await connected('quit-dead')
            await resolved(ftp.pwd(), 'pwd') //先確認連線已建立
            await resolved(srv.dropControls(), 'drop')
            await resolved(ftp.quit(), 'quit')
            assert.strict.deepEqual(srv.nAccept(), 1)
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), notInit)
        })

    })

    describe('操作進行中控制連線中斷: 立即以固定訊息reject, 不等timeLimit, 不於新連線續送', function() {

        let TL2 = 60000

        it('ls', async function() {
            let n = 0
            let { c, ftp } = await connected('drop-ls', {
                client: { timeLimit: TL2 },
                server: { hooks: { CMD: ({ cmd, destroy }) => cmd === 'STAT' && n++ === 0 && (destroy(), true) } },
            })
            put(c.fdSrv, 'a.txt', 'abc')
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), 'ftpLs: the connection to the server is closed (CLOSED)')
            assert.strict.deepEqual((await resolved(ftp.ls('.'), 'ls2')).map((v) => v.name), ['a.txt'])
        })

        it('stat: MLST後於SIZE時中斷', async function() {
            let n = 0
            let { c, srv, ftp } = await connected('drop-stat', {
                client: { timeLimit: TL2 },
                server: { hooks: { CMD: ({ cmd, destroy }) => cmd === 'SIZE' && n++ === 0 && (destroy(), true) } },
            })
            put(c.fdSrv, 'sub/a.txt', 'abc')
            await ftp.cwd('sub')
            assert.strict.deepEqual(await rejected(ftp.stat('./a.txt'), 'stat'), 'ftpStat: the connection to the server is closed (CLOSED)')
            assert.strict.deepEqual(srv.cmds.filter((v) => /^size /i.test(v)).length, 1, '中斷後不得續送')
            assert.strict.deepEqual((await resolved(ftp.stat('./a.txt'), 'stat2')).size, 3)
        })

        it('download: 取得數據連線前中斷, 本機舊檔不動', async function() {
            let n = 0
            let { c, ftp } = await connected('drop-download', {
                client: { timeLimit: TL2 },
                server: { hooks: { CMD: ({ cmd, destroy }) => cmd === 'RETR' && n++ === 0 && (destroy(), true) } },
            })
            put(c.fdSrv, 'a.txt', 'abc')
            fs.writeFileSync(`${c.fdLocal}/a.txt`, 'OLD')
            assert.strict.deepEqual(await rejected(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download'), 'ftpDownload: the connection to the server is closed (CLOSED)')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdLocal}/a.txt`, 'utf8'), 'OLD')
            assert.strict.deepEqual(await resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download2'), 'ok')
        })

        it('mkdir與cwd', async function() {
            let n = 0
            let m = 0
            let { c, ftp } = await connected('drop-mkdir', {
                client: { timeLimit: TL2 },
                server: { hooks: { CMD: ({ cmd, destroy }) => ((cmd === 'MKD' && n++ === 0) || (cmd === 'CWD' && m++ === 0)) && (destroy(), true) } },
            })
            fs.mkdirSync(`${c.fdSrv}/sub`)
            assert.strict.deepEqual(await rejected(ftp.mkdir('./d1/f'), 'mkdir'), 'ftpMkdir: the connection to the server is closed (CLOSED)')
            assert.strict.deepEqual(await rejected(ftp.cwd('sub'), 'cwd'), 'ftpCwd: the connection to the server is closed (CLOSED)')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload')
            assert.strict.deepEqual(tree(c.fdSrv), ['f.txt', 'sub/'], '未成功之cwd不得重放')
        })

    })

    describe('各操作之timeLimit: 到時reject並銷毀本次所用之連線, 其後操作重新連線', function() {

        let check = async (srv, p, msg, label) => {
            let e = await rejected(p, label)
            assert.strict.deepEqual(e, msg)
            await resolved(srv.waitControls(0), `${label}: 控制連線須關閉`, 5000)
        }

        it('ls', async function() {
            let st = stall((cmd) => cmd === 'STAT')
            let { c, srv, ftp } = await connected('to-ls', { server: { hooks: { CMD: st.hook } } })
            put(c.fdSrv, 'sub/a.txt', 'abc')
            await ftp.cwd('sub')
            let rec = recorder()
            await check(srv, ftp.ls('.', { onTrace: rec.onTrace }), `ftpLs timeout[${TL}]`, 'ls')
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'ls' }])
            st.on = false
            let rec2 = recorder()
            let rs = await resolved(ftp.ls('.', { onTrace: rec2.onTrace }), 'ls2')
            assert.strict.deepEqual(rs.map((v) => v.name), ['a.txt'], '重新連線後仍為工作資料夾')
            assert.strict.deepEqual(rec2.evs, [{ type: 'reconnect', ok: true }])
        })

        it('stat、isFile、isFolder停滯時reject, 不以false回覆', async function() {
            let st = stall((cmd) => cmd === 'MLST')
            let { c, srv, ftp } = await connected('to-stat', { server: { hooks: { CMD: st.hook } } })
            put(c.fdSrv, 'a.txt', 'abc')
            for (let [name, fn] of [['stat', () => ftp.stat('./a.txt')], ['isFile', () => ftp.isFile('./a.txt')], ['isFolder', () => ftp.isFolder('./a.txt')]]) {
                st.on = true
                await check(srv, fn(), `ftpRaw[mlst] timeout[${TL}]`, name)
                st.on = false
                assert.strict.deepEqual(await resolved(ftp.isFile('./a.txt'), `${name} 其後`), true)
            }
        })

        it('stat停滯於SIZE', async function() {
            let st = stall((cmd) => cmd === 'SIZE')
            let { c, srv, ftp } = await connected('to-size', { server: { hooks: { CMD: st.hook } } })
            put(c.fdSrv, 'a.txt', 'abc')
            await check(srv, ftp.stat('./a.txt'), `ftpRaw[size] timeout[${TL}]`, 'size')
        })

        it('mkdir', async function() {
            let st = stall((cmd) => cmd === 'MKD')
            let { c, srv, ftp } = await connected('to-mkdir', { server: { hooks: { CMD: st.hook } } })
            await check(srv, ftp.mkdir('./d1/f'), `ftpRaw[mkd] timeout[${TL}]`, 'mkdir')
            st.on = false
            await resolved(ftp.mkdir('./d1/f'), 'mkdir2')
            assert.ok(fs.statSync(`${c.fdSrv}/d1`).isDirectory())
        })

        it('cwd停滯: 該次cwd不記錄', async function() {
            let st = stall((cmd, arg) => cmd === 'CWD' && arg === 'sub')
            let { c, srv, ftp } = await connected('to-cwd', { server: { hooks: { CMD: st.hook } } })
            fs.mkdirSync(`${c.fdSrv}/sub`)
            await check(srv, ftp.cwd('sub'), `ftpRaw[cwd] timeout[${TL}]`, 'cwd')
            st.on = false
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload')
            assert.strict.deepEqual(tree(c.fdSrv), ['f.txt', 'sub/'])
        })

        it('pwd', async function() {
            let st = stall((cmd) => cmd === 'PWD')
            let { srv, ftp } = await connected('to-pwd', { server: { hooks: { CMD: st.hook } } })
            await check(srv, ftp.pwd(), `ftpRaw[pwd] timeout[${TL}]`, 'pwd')
            st.on = false
            await resolved(ftp.pwd(), 'pwd2')
        })

        it('download: 停滯於查詢遠端檔案資訊, 以ftpDownload逾時訊息reject', async function() {
            let st = stall((cmd) => cmd === 'MLST')
            let { c, srv, ftp } = await connected('to-dl-stat', { server: { hooks: { CMD: st.hook } } })
            put(c.fdSrv, 'a.txt', 'abc')
            let rec = recorder()
            await check(srv, ftp.download('./a.txt', `${c.fdLocal}/a.txt`, null, { onTrace: rec.onTrace }), `ftpDownload timeout[${TL}]`, 'download')
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'stat' }])
            st.on = false
            assert.strict.deepEqual(await resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download2'), 'ok')
        })

        it('download: RETR未回150即停滯, 逾時後控制連線亦銷毀, 同一實例不須quit即可再下載', async function() {
            let st = stall((cmd) => cmd === 'RETR')
            let { c, srv, ftp } = await connected('to-dl-retr', { server: { hooks: { CMD: st.hook } } })
            put(c.fdSrv, 'sub/a.txt', 'abc')
            await ftp.cwd('sub')
            await check(srv, ftp.download('./a.txt', `${c.fdLocal}/a.txt`), `ftpDownload timeout[${TL}]`, 'download')
            st.on = false
            assert.strict.deepEqual(await resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download2'), 'ok')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdLocal}/a.txt`, 'utf8'), 'abc')
        })

        it('download: 傳輸中停滯, 逾時後銷毀控制與數據連線', async function() {
            let n = 0
            let { c, srv, ftp } = await connected('to-dl-data', {
                server: {
                    hooks: {
                        RETR: async ({ data, reply, waitDs, closeDsrv }) => {
                            reply('150 ok')
                            let ds = await waitDs()
                            if (n++ === 0) {
                                return //不送數據亦不回最終回應
                            }
                            ds.once('close', () => {
                                reply('226 done')
                                closeDsrv()
                            })
                            ds.end(data)
                        },
                    },
                },
            })
            put(c.fdSrv, 'a.txt', 'abc')
            await check(srv, ftp.download('./a.txt', `${c.fdLocal}/a.txt`), `ftpDownload timeout[${TL}]`, 'download')
            assert.strict.deepEqual(await resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download2'), 'ok')
        })

        it('syncToLocal與syncToRemote: 列舉停滯時依timeLimit逾時結束', async function() {
            let st = stall((cmd) => cmd === 'STAT')
            let { c, srv, ftp } = await connected('to-sync', { server: { hooks: { CMD: st.hook } } })
            put(c.fdSrv, 'r/a.txt', 'abc')
            put(c.fdLocal, 'up/b.txt', 'b')
            let rec = recorder()
            await check(srv, ftp.syncToLocal('./r', `${c.fdLocal}/down`, null, { onTrace: rec.onTrace }), `ftpLs timeout[${TL}]`, 'syncToLocal')
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'ls' }])
            let rec2 = recorder()
            await check(srv, ftp.syncToRemote(`${c.fdLocal}/up`, './r', null, { onTrace: rec2.onTrace }), `ftpLs timeout[${TL}]`, 'syncToRemote')
            assert.strict.deepEqual(rec2.evs, [{ type: 'reconnect', ok: true }, { type: 'timeout', timeLimit: TL, stage: 'ls' }])
            assert.ok(!fs.existsSync(`${c.fdSrv}/r/b.txt`))
        })

        it('quit未回覆即被伺服器關閉: 立即以固定訊息reject, 不等timeLimit', async function() {
            let { srv, ftp } = await connected('quit-closed', {
                client: { timeLimit: 60000 },
                server: { hooks: { CMD: ({ cmd, destroy }) => cmd === 'QUIT' && (destroy(), true) } },
            })
            await resolved(ftp.pwd(), 'pwd')
            assert.strict.deepEqual(await rejected(ftp.quit(), 'quit'), 'ftpQuit: the connection to the server is closed (CLOSED)')
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), notInit)
            assert.strict.deepEqual(srv.nAccept(), 1)
        })

        it('quit停滯: 依timeLimit逾時reject並銷毀連線', async function() {
            let st = stall((cmd) => cmd === 'QUIT')
            let { srv, ftp } = await connected('to-quit', { server: { hooks: { CMD: st.hook } } })
            await resolved(ftp.pwd(), 'pwd')
            let rec = recorder()
            await check(srv, ftp.quit({ onTrace: rec.onTrace }), `ftpQuit timeout[${TL}]`, 'quit')
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'quit' }])
        })

    })

    describe('絕對路徑與含..、.起首名稱之路徑', function() {

        let home = { server: { home: '/home/u1' } }

        it('mkdir: 絕對路徑建於該絕對位置, 不建於登入或工作資料夾下', async function() {
            let { c, ftp } = await connected('mkdir-abs', home)
            fs.mkdirSync(`${c.fdSrv}/home/u1`, { recursive: true })
            await resolved(ftp.mkdir('/abs/deep/f.txt'), 'mkdir')
            assert.strict.deepEqual(tree(c.fdSrv), ['abs/', 'abs/deep/', 'home/', 'home/u1/'])
        })

        it('mkdir: 含..、.起首名稱與前後空白之名稱依原樣建立', async function() {
            let { c, ftp } = await connected('mkdir-dots', home)
            fs.mkdirSync(`${c.fdSrv}/home/u1/w`, { recursive: true })
            await ftp.cwd('w')
            await resolved(ftp.mkdir('../x/f.txt'), 'mkdir ..')
            await resolved(ftp.mkdir('.hidden/a/f.txt'), 'mkdir .hidden')
            await resolved(ftp.mkdir('./.dot/f.txt'), 'mkdir ./.dot')
            assert.strict.deepEqual(tree(c.fdSrv), [
                'home/', 'home/u1/', 'home/u1/w/', 'home/u1/w/.dot/', 'home/u1/w/.hidden/', 'home/u1/w/.hidden/a/', 'home/u1/x/',
            ])
        })

        it('upload: 絕對路徑(含多層新資料夾)寫入該絕對位置', async function() {
            let { c, ftp } = await connected('up-abs', home)
            fs.mkdirSync(`${c.fdSrv}/home/u1`, { recursive: true })
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'abs-content')
            await resolved(ftp.upload(`${c.fdLocal}/f.txt`, '/abs/u/f.txt'), 'upload')
            assert.strict.deepEqual(tree(c.fdSrv), ['abs/', 'abs/u/', 'abs/u/f.txt', 'home/', 'home/u1/'])
        })

        for (let [name, fdRemote, expect] of [
            ['絕對', '/dst/d', 'dst/d'],
            ['含..', '../shared', 'home/shared'],
            ['相對(無./)', 'rel', 'home/u1/rel'],
            ['.起首名稱', '.hid', 'home/u1/.hid'],
            ['尾端/', './tail/', 'home/u1/tail'],
        ]) {
            it(`syncToRemote: fdRemote為${name}時寫入對應位置, 再次同步無差異`, async function() {
                let { c, ftp } = await connected(`sync-up-${fdRemote.replace(/[^a-z]/g, '')}`, home)
                fs.mkdirSync(`${c.fdSrv}/home/u1`, { recursive: true })
                put(c.fdSrv, `${expect}/keep.txt`, 'keep')
                put(c.fdLocal, 'src/a.txt', 'AAA')
                put(c.fdLocal, 'src/n/b.txt', 'BB')
                let r = await resolved(ftp.syncToRemote(`${c.fdLocal}/src`, fdRemote, null), 'sync')
                assert.strict.deepEqual(r.num, 2)
                assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/${expect}/a.txt`, 'utf8'), 'AAA')
                assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/${expect}/n/b.txt`, 'utf8'), 'BB')
                assert.strict.deepEqual(tree(c.fdSrv).filter((v) => v.endsWith('.txt')).length, 3, '不得寫到他處')
                let r2 = await resolved(ftp.syncToRemote(`${c.fdLocal}/src`, fdRemote, null), 'sync2')
                assert.strict.deepEqual(r2, { num: 0, files: [] })
            })
        }

        it('syncToLocal: fdRemote為絕對路徑時下載至本機資料夾之對應相對位置', async function() {
            let { c, ftp } = await connected('sync-down-abs', home)
            fs.mkdirSync(`${c.fdSrv}/home/u1`, { recursive: true })
            put(c.fdSrv, 'dst/a.txt', 'AAA')
            put(c.fdSrv, 'dst/n/.b', 'BB')
            let r = await resolved(ftp.syncToLocal('/dst', `${c.fdLocal}/down`, null), 'sync')
            assert.strict.deepEqual(r.num, 2)
            assert.strict.deepEqual(tree(`${c.fdLocal}/down`), ['a.txt', 'n/', 'n/.b'])
        })

    })

})
