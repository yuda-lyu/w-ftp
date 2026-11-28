import fs from 'fs'
import assert from 'assert'
import { mock } from 'node:test'
import { recorder, signal, gate, settleWithin, catchUnhandled } from './lib/dlTestKit.mjs'
import { prepareDirs, put, tree, harness, muteServer, refusedPort, halfOpenProxy, rejected, resolved } from './lib/connTestKit.mjs'
import w from 'wsemi'


//SFTP之連線生命週期: 連不上、伺服器斷線、各操作之逾時、工作資料夾(cwd/pwd)、絕對路徑; 以假SFTP伺服器重現
describe('api-sftp-conn', function() {

    let fdBase = './test/_tmp/api-sftp-conn'
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

    //connected
    let connected = async (name, { server = {}, client = {} } = {}) => {
        let c = prepareDirs(fdBase, name)
        let srv = await h.sftpServer({ fdRoot: c.fdSrv, ...server })
        let ftp = h.client('SFTP', srv.port, { timeLimit: TL, fdDownloadTemp: c.fdTemp, ...client })
        await resolved(ftp.conn(), 'conn')
        return { c, srv, ftp }
    }

    //gateHook, st.on為true時停滯(不呼叫respond)
    let stall = () => {
        let st = { on: true, hit: signal() }
        st.hook = (ctx) => {
            if (st.on) {
                st.hit.fire()
                return
            }
            ctx.respond()
        }
        return st
    }

    let check = async (srv, p, msg, label) => {
        let e = await rejected(p, label)
        assert.strict.deepEqual(e, msg)
        await resolved(srv.waitClients(0), `${label}: 連線須關閉`, 5000)
    }

    describe('conn之連線錯誤', function() {

        it('連不上(拒絕連線): conn以固定訊息reject, 不輸出外來錯誤; 其後操作視為未連線', async function() {
            let port = await refusedPort()
            let ftp = h.client('SFTP', port, { timeLimit: 15000 })
            let rec = recorder()
            let logs = []
            let logOrig = console.log
            let errOrig = console.error
            console.log = (...a) => logs.push(a)
            console.error = (...a) => logs.push(a)
            let e
            try {
                e = await rejected(ftp.conn({ onTrace: rec.onTrace }), '拒絕連線', 15000)
            }
            finally {
                console.log = logOrig
                console.error = errOrig
            }
            assert.strict.deepEqual(e, 'ftpConn: can not connect to the server (ECONNREFUSED)')
            assert.strict.deepEqual(rec.evs, [{ type: 'connect', ok: false, code: 'ECONNREFUSED' }])
            assert.strict.deepEqual(logs.length, 0)
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), notInit)
            assert.strict.deepEqual(await rejected(ftp.upload('./test/lib/connTestKit.mjs', './x'), 'upload'), notInit)
            assert.strict.deepEqual(await resolved(ftp.quit(), 'conn失敗後quit照常完成(沿用原版)'), 'ok')
            assert.strict.deepEqual(await rejected(ftp.quit(), 'quit2'), notInit)
        })

        it('交握停滯: conn依timeLimit逾時reject並關閉連線', async function() {
            let ms = await muteServer()
            h.track(ms.close)
            let ftp = h.client('SFTP', ms.port, { timeLimit: 600 })
            let rec = recorder()
            let e = await rejected(ftp.conn({ onTrace: rec.onTrace }), '交握停滯')
            assert.strict.deepEqual(e, 'ftpConn timeout[600]')
            assert.strict.deepEqual(rec.evs, [
                { type: 'timeout', timeLimit: 600, stage: 'connect' },
                { type: 'connect', ok: false, code: 'TIMEOUT' },
            ])
            await resolved(ms.waitClosed(), '伺服器端連線須關閉')
        })

        it('認證被拒: conn以固定訊息reject, 不帶伺服器訊息', async function() {
            let c = prepareDirs(fdBase, 'auth')
            let srv = await h.sftpServer({ fdRoot: c.fdSrv, hooks: { AUTH: () => false } })
            let ftp = h.client('SFTP', srv.port, { timeLimit: TL })
            let e = await rejected(ftp.conn(), 'auth', 15000)
            assert.ok(/^ftpConn: can not connect to the server \([A-Z0-9_]+\)$/.test(e), String(e))
        })

    })

    describe('伺服器斷線', function() {

        it('閒置中被斷線: 操作以固定訊息reject, 不寫console, 再conn後可用', async function() {
            let { c, srv, ftp } = await connected('idle-drop')
            put(c.fdSrv, 'a.txt', 'abc')
            await resolved(ftp.isFile('./a.txt'), 'first')
            let logs = []
            let logOrig = console.log
            let errOrig = console.error
            console.log = (...a) => logs.push(a)
            console.error = (...a) => logs.push(a)
            try {
                await resolved(srv.dropClients(), 'drop')
                //客戶端處理斷線之時點無事件可等, 以操作結果判定
                let e = await rejected(ftp.ls('.'), 'ls')
                assert.strict.deepEqual(e, 'ftpLs: the connection to the server is closed (CLOSED)')
                assert.strict.deepEqual(await rejected(ftp.isFile('./a.txt'), 'isFile'), 'ftpStat: the connection to the server is closed (CLOSED)')
                await resolved(ftp.quit(), 'quit')
                await resolved(ftp.conn(), 'conn')
                assert.strict.deepEqual(await resolved(ftp.isFile('./a.txt'), 'after'), true)
            }
            finally {
                console.log = logOrig
                console.error = errOrig
            }
            assert.strict.deepEqual(logs.length, 0)
        })

        it('閒置中被斷線後上傳: 沿用上傳流程之失敗處置(reject且舊目標不動), 其後實例可用', async function() {
            let { c, srv, ftp } = await connected('idle-upload')
            put(c.fdSrv, 't.txt', 'OLD')
            await resolved(ftp.isFile('./t.txt'), 'first')
            await resolved(srv.dropClients(), 'drop')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'NEW')
            await rejected(ftp.upload(`${c.fdLocal}/f.txt`, './t.txt'), 'upload')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/t.txt`, 'utf8'), 'OLD')
            assert.strict.deepEqual(await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './t.txt'), 'upload2'), 'ok')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/t.txt`, 'utf8'), 'NEW')
        })

        it('下載各階段間被斷線(模擬於暫存區清理之I/O期間): reject固定訊息, 本機舊檔不動', async function() {
            let { c, srv, ftp } = await connected('gap-download')
            put(c.fdSrv, 'a.txt', 'abc')
            fs.writeFileSync(`${c.fdLocal}/a.txt`, 'OLD')
            let readdirReal = fs.promises.readdir
            mock.method(fs.promises, 'readdir', async (...args) => {
                await srv.dropClients()
                await new Promise((resolve) => setImmediate(resolve))
                return readdirReal(...args)
            })
            try {
                assert.strict.deepEqual(await rejected(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download'), 'ftpDownload: the connection to the server is closed (CLOSED)')
            }
            finally {
                mock.restoreAll()
            }
            assert.strict.deepEqual(fs.readFileSync(`${c.fdLocal}/a.txt`, 'utf8'), 'OLD')
        })

        it('ls進行中被斷線: reject固定訊息, 不等timeLimit', async function() {
            let { ftp } = await connected('drop-ls', { client: { timeLimit: 60000 }, server: { hooks: { OPENDIR: ({ client }) => client.end() } } })
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), 'ftpLs: the connection to the server is closed (CLOSED)')
        })

    })

    describe('各操作之timeLimit: 到時reject並銷毀本次所用之連線, 其後操作重新連線', function() {

        it('ls(停滯於OPENDIR)', async function() {
            let st = stall()
            let { c, srv, ftp } = await connected('to-opendir', { server: { hooks: { OPENDIR: st.hook } } })
            put(c.fdSrv, 'a.txt', 'abc')
            let rec = recorder()
            await check(srv, ftp.ls('.', { onTrace: rec.onTrace }), `ftpLs timeout[${TL}]`, 'ls')
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'ls' }])
            st.on = false
            let rec2 = recorder()
            let rs = await resolved(ftp.ls('.', { onTrace: rec2.onTrace }), 'ls2')
            assert.strict.deepEqual(rs.map((v) => v.name), ['a.txt'])
            assert.strict.deepEqual(rec2.evs, [{ type: 'reconnect', ok: true }])
        })

        it('逾時後併發操作只建立一條新連線', async function() {
            let st = stall()
            let { c, srv, ftp } = await connected('single-flight', { server: { hooks: { OPENDIR: st.hook } } })
            put(c.fdSrv, 'a.txt', 'abc')
            await check(srv, ftp.ls('.'), `ftpLs timeout[${TL}]`, 'ls')
            st.on = false
            let rec = recorder()
            let rs = await resolved(Promise.all([
                ftp.isFile('./a.txt'),
                ftp.isFile('./a.txt', { onTrace: rec.onTrace }),
                ftp.ls('.'),
                ftp.pwd(),
            ]), 'all')
            assert.strict.deepEqual([rs[0], rs[1], rs[3]], [true, true, '/'])
            assert.strict.deepEqual(srv.nAccept(), 2)
            assert.strict.deepEqual(rec.evs, [{ type: 'reconnect', ok: true }])
        })

        it('重新連線進行中另行conn: 該操作改用新連線(待其就緒), conn不受影響', async function() {
            let st = stall()
            let g2 = gate()
            let g3 = gate()
            let sg2 = signal()
            let sg3 = signal()
            let { c, srv, ftp } = await connected('reconnect-vs-conn', {
                server: {
                    hooks: {
                        OPENDIR: st.hook,
                        AUTH: ({ method, n }) => {
                            if (method !== 'password' || n === 1) {
                                return true
                            }
                            if (n === 2) {
                                sg2.fire()
                                return g2.wait()
                            }
                            sg3.fire()
                            return g3.wait()
                        },
                    },
                },
            })
            put(c.fdSrv, 'a.txt', 'abc')
            await check(srv, ftp.ls('.'), `ftpLs timeout[${TL}]`, 'ls')
            st.on = false
            let p = resolved(ftp.ls('.'), 'ls2') //重新連線(第2條), 認證停滯
            await sg2.wait()
            let q = resolved(ftp.conn(), 'conn2') //另行conn(第3條), 認證停滯
            await sg3.wait()
            g2.open()
            await new Promise((resolve) => setImmediate(resolve))
            g3.open()
            assert.strict.deepEqual(await q, 'ok')
            assert.strict.deepEqual((await p).map((v) => v.name), ['a.txt'])
            assert.strict.deepEqual(await resolved(ftp.isFile('./a.txt'), 'after'), true)
        })

        it('伺服器斷線後上傳至資料夾內: 以固定訊息reject, 其後實例可用', async function() {
            let { c, srv, ftp } = await connected('idle-upload-dir')
            await resolved(ftp.isFolder('.'), 'first')
            await resolved(srv.dropClients(), 'drop')
            await rejected(ftp.isFile('./x'), '先使客戶端得知斷線')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'NEW')
            assert.strict.deepEqual(await rejected(ftp.upload(`${c.fdLocal}/f.txt`, './d/t.txt'), 'upload'), 'ftpUpload: the connection to the server is closed (CLOSED)')
            assert.strict.deepEqual(await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './d/t.txt'), 'upload2'), 'ok')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/d/t.txt`, 'utf8'), 'NEW')
        })

        it('quit取消進行中之重新連線: 該操作立即視為未連線, 該連線關閉', async function() {
            let st = stall()
            let sg = signal()
            let { srv, ftp } = await connected('quit-cancel', {
                client: { timeLimit: 3000 },
                server: {
                    hooks: {
                        OPENDIR: st.hook,
                        AUTH: ({ method, n }) => {
                            if (method !== 'password' || n === 1) {
                                return true
                            }
                            sg.fire()
                            return new Promise(() => {})
                        },
                    },
                },
            })
            await check(srv, ftp.ls('.'), `ftpLs timeout[3000]`, 'ls')
            let p = ftp.ls('.')
            let pe = rejected(p, 'pending')
            await sg.wait()
            assert.strict.deepEqual(await resolved(ftp.quit(), 'quit'), 'ok')
            //未取消者須等重新連線自身之timeLimit(3000)才結束
            let r = await settleWithin(p, 1000)
            assert.strict.deepEqual(r.settled, true, 'quit須取消重新連線')
            assert.strict.deepEqual(await pe, notInit)
            await resolved(srv.waitClients(0), '重新連線中之連線須關閉', 1000)
        })

        it('逾時後重新連線被拒: 各操作以固定訊息reject, 伺服器恢復後下一個操作可用', async function() {
            let st = stall()
            let deny = false
            let { c, srv, ftp } = await connected('reconnect-auth', { server: { hooks: { OPENDIR: st.hook, AUTH: () => !deny } } })
            put(c.fdSrv, 'a.txt', 'abc')
            await check(srv, ftp.ls('.'), `ftpLs timeout[${TL}]`, 'ls')
            st.on = false
            deny = true
            let rec = recorder()
            assert.strict.deepEqual(await rejected(ftp.isFile('./a.txt', { onTrace: rec.onTrace }), 'isFile', 15000), 'ftpStat: can not reconnect to the server (AUTHENTICATION)')
            assert.strict.deepEqual(rec.evs, [{ type: 'reconnect', ok: false }])
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            assert.strict.deepEqual(await rejected(ftp.upload(`${c.fdLocal}/f.txt`, './f.txt'), 'upload', 15000), 'ftpUpload: can not reconnect to the server (AUTHENTICATION)')
            deny = false
            assert.strict.deepEqual(await resolved(ftp.isFile('./a.txt'), 'after'), true)
        })

        it('ls(停滯於READDIR)', async function() {
            let st = stall()
            let { srv, ftp } = await connected('to-readdir', { server: { hooks: { READDIR: st.hook } } })
            await check(srv, ftp.ls('.'), `ftpLs timeout[${TL}]`, 'ls')
        })

        it('stat、isFile、isFolder停滯時reject, 不以false回覆', async function() {
            let st = stall()
            let { c, srv, ftp } = await connected('to-stat', { server: { hooks: { STAT: st.hook } } })
            put(c.fdSrv, 'a.txt', 'abc')
            for (let [name, fn] of [['stat', () => ftp.stat('./a.txt')], ['isFile', () => ftp.isFile('./a.txt')], ['isFolder', () => ftp.isFolder('./a.txt')]]) {
                st.on = true
                await check(srv, fn(), `ftpStat timeout[${TL}]`, name)
                st.on = false
                assert.strict.deepEqual(await resolved(ftp.isFile('./a.txt'), `${name} 其後`), true)
            }
        })

        it('mkdir', async function() {
            let st = stall()
            let { c, srv, ftp } = await connected('to-mkdir', { server: { hooks: { MKDIR: st.hook } } })
            await check(srv, ftp.mkdir('./d1/f'), `ftpMkdir timeout[${TL}]`, 'mkdir')
            st.on = false
            await resolved(ftp.mkdir('./d1/f'), 'mkdir2')
            assert.ok(fs.statSync(`${c.fdSrv}/d1`).isDirectory())
        })

        it('cwd與pwd(停滯於REALPATH)', async function() {
            let st = stall()
            let { c, srv, ftp } = await connected('to-realpath', { server: { hooks: { REALPATH: st.hook } } })
            fs.mkdirSync(`${c.fdSrv}/sub`)
            await check(srv, ftp.cwd('sub'), `ftpCwd timeout[${TL}]`, 'cwd')
            await check(srv, ftp.pwd(), `ftpPwd timeout[${TL}]`, 'pwd')
            st.on = false
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd2'), '/', '未成功之cwd不得生效')
        })

        it('syncToLocal與syncToRemote: 列舉停滯時依timeLimit逾時結束', async function() {
            let st = stall()
            let { c, srv, ftp } = await connected('to-sync', { server: { hooks: { READDIR: st.hook } } })
            put(c.fdSrv, 'r/a.txt', 'abc')
            put(c.fdLocal, 'up/b.txt', 'b')
            let rec = recorder()
            await check(srv, ftp.syncToLocal('./r', `${c.fdLocal}/down`, null, { onTrace: rec.onTrace }), `ftpLs timeout[${TL}]`, 'syncToLocal')
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'ls' }])
            await check(srv, ftp.syncToRemote(`${c.fdLocal}/up`, './r'), `ftpLs timeout[${TL}]`, 'syncToRemote')
            assert.ok(!fs.existsSync(`${c.fdSrv}/r/b.txt`))
        })

        it('download停滯於查詢遠端檔案資訊: 銷毀連線, 同一實例不須quit即可再下載', async function() {
            let st = stall()
            let { c, srv, ftp } = await connected('to-dl-stat', { server: { hooks: { STAT: st.hook } } })
            put(c.fdSrv, 'a.txt', 'abc')
            let rec = recorder()
            await check(srv, ftp.download('./a.txt', `${c.fdLocal}/a.txt`, null, { onTrace: rec.onTrace }), `ftpDownload timeout[${TL}]`, 'download')
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'stat' }])
            st.on = false
            let rec2 = recorder()
            assert.strict.deepEqual(await resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`, null, { onTrace: rec2.onTrace }), 'download2'), 'ok')
            assert.strict.deepEqual(rec2.evs[0], { type: 'reconnect', ok: true })
        })

        it('download傳輸停滯: 銷毀本次連線使fastGet中止, 暫存清除, 其後可下載', async function() {
            let st = stall()
            let un = catchUnhandled()
            let { c, srv, ftp } = await connected('to-dl-read', { server: { hooks: { READ: st.hook } } })
            put(c.fdSrv, 'a.txt', 'abc')
            let rec = recorder()
            await check(srv, ftp.download('./a.txt', `${c.fdLocal}/a.txt`, null, { onTrace: rec.onTrace }), `ftpDownload timeout[${TL}]`, 'download')
            let [ev] = await rec.wait((e) => e.type === 'transfer' && e.late === true)
            assert.strict.deepEqual(ev.ok, false)
            await rec.wait((e) => e.type === 'temp' && e.act === 'remove')
            assert.strict.deepEqual(fs.readdirSync(c.fdTemp), [])
            st.on = false
            assert.strict.deepEqual(await resolved(ftp.download('./a.txt', `${c.fdLocal}/a.txt`), 'download2'), 'ok')
            un.stop()
            assert.strict.deepEqual(un.list, [])
        })

        it('quit: 伺服器不關閉連線時依timeLimit逾時reject', async function() {
            let { srv } = await connected('to-quit')
            let px = await halfOpenProxy(srv.port)
            h.track(px.close)
            let ftp = h.client('SFTP', px.port, { timeLimit: 800 })
            await resolved(ftp.conn(), 'conn')
            let rec = recorder()
            assert.strict.deepEqual(await rejected(ftp.quit({ onTrace: rec.onTrace }), 'quit'), 'ftpQuit timeout[800]')
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: 800, stage: 'quit' }])
            assert.strict.deepEqual(await rejected(ftp.ls('.'), 'ls'), notInit)
        })

    })

    describe('工作資料夾(cwd與pwd)', function() {

        let home = { server: { home: '/home/u1' } }

        let prep = (c) => {
            put(c.fdSrv, 'home/u1/sub/in.txt', 'in-sub')
            fs.mkdirSync(`${c.fdSrv}/home/u1/sub/deeper`, { recursive: true })
        }

        it('cwd後相對路徑以該資料夾為準: ls、stat、isFile、upload、download、mkdir、sync與pwd', async function() {
            let { c, ftp } = await connected('cwd-all', home)
            prep(c)
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd0'), '/home/u1')
            await resolved(ftp.cwd('sub'), 'cwd')
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd'), '/home/u1/sub')
            assert.strict.deepEqual((await resolved(ftp.ls('.'), 'ls')).map((v) => v.name).sort(), ['deeper', 'in.txt'])
            assert.strict.deepEqual((await resolved(ftp.ls(), 'ls default')).map((v) => v.name).sort(), ['deeper', 'in.txt'])
            assert.strict.deepEqual(await resolved(ftp.isFile('./in.txt'), 'isFile'), true)
            assert.strict.deepEqual((await resolved(ftp.stat('in.txt'), 'stat')).size, 6)
            fs.writeFileSync(`${c.fdLocal}/up.bin`, 'UP')
            assert.strict.deepEqual(await resolved(ftp.upload(`${c.fdLocal}/up.bin`, './n1/up.bin'), 'upload'), 'ok')
            assert.strict.deepEqual(await resolved(ftp.download('./in.txt', `${c.fdLocal}/in.txt`), 'download'), 'ok')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdLocal}/in.txt`, 'utf8'), 'in-sub')
            await resolved(ftp.mkdir('./m/f'), 'mkdir')
            put(c.fdLocal, 'tree/s.txt', 'synced')
            fs.mkdirSync(`${c.fdSrv}/home/u1/sub/dst`) //syncToRemote之遠端資料夾須已存在(原版行為)
            await resolved(ftp.syncToRemote(`${c.fdLocal}/tree`, 'dst'), 'syncToRemote')
            await resolved(ftp.syncToLocal('dst', `${c.fdLocal}/down`), 'syncToLocal')
            assert.strict.deepEqual(tree(`${c.fdLocal}/down`), ['s.txt'])
            assert.strict.deepEqual(tree(`${c.fdSrv}/home/u1`), [
                'sub/', 'sub/deeper/', 'sub/dst/', 'sub/dst/s.txt', 'sub/in.txt', 'sub/m/', 'sub/n1/', 'sub/n1/up.bin',
            ])
        })

        it('相對、..與絕對路徑之cwd依序生效; 絕對路徑之操作不受影響', async function() {
            let { c, ftp } = await connected('cwd-chain', home)
            prep(c)
            await resolved(ftp.cwd('sub'), 'cwd1')
            await resolved(ftp.cwd('deeper'), 'cwd2')
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd'), '/home/u1/sub/deeper')
            await resolved(ftp.cwd('..'), 'cwd3')
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd'), '/home/u1/sub')
            await resolved(ftp.cwd('/home'), 'cwd4')
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd'), '/home')
            assert.strict.deepEqual(await resolved(ftp.isFile('/home/u1/sub/in.txt'), 'abs'), true)
        })

        it('cwd後上傳目標之檔名部分為空、.或..者仍拒絕(不因解析而改變意義)', async function() {
            let { c, srv, ftp } = await connected('cwd-upload-bad', home)
            prep(c)
            await resolved(ftp.cwd('sub'), 'cwd')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            for (let bad of ['.', './', 'deeper/', '..', './deeper/..']) {
                assert.strict.deepEqual(await rejected(ftp.upload(`${c.fdLocal}/f.txt`, bad), bad), 'ftpUpload: fpRemote is not a file path, fpRemote is not changed')
            }
            assert.strict.deepEqual(srv.ops, [])
        })

        it('cwd後上傳逾時: 重新連線清理暫存於工作資料夾', async function() {
            let st = stall()
            st.on = false
            let { c, ftp } = await connected('cwd-upload-timeout', { server: { home: '/home/u1', hooks: { WRITE: st.hook } } })
            prep(c)
            await resolved(ftp.cwd('sub'), 'cwd')
            st.on = true
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'NEW')
            assert.strict.deepEqual(await rejected(ftp.upload(`${c.fdLocal}/f.txt`, './in.txt'), 'upload'), `ftpUploadCore timeout[${TL}]`)
            assert.strict.deepEqual(fs.readdirSync(`${c.fdSrv}/home/u1/sub`).sort(), ['deeper', 'in.txt'])
            assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/home/u1/sub/in.txt`, 'utf8'), 'in-sub')
            st.on = false
            assert.strict.deepEqual(await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './in.txt'), 'upload2'), 'ok')
            assert.strict.deepEqual(fs.readFileSync(`${c.fdSrv}/home/u1/sub/in.txt`, 'utf8'), 'NEW')
        })

        it('cwd後含..之路徑原樣交伺服器解析(不作字面正規化); 含..之多層新資料夾可建立', async function() {
            let { c, srv, ftp } = await connected('cwd-dotdot', home)
            prep(c)
            await resolved(ftp.cwd('sub'), 'cwd')
            fs.writeFileSync(`${c.fdLocal}/f.txt`, 'x')
            assert.strict.deepEqual(await resolved(ftp.upload(`${c.fdLocal}/f.txt`, './deeper/../n/../m/f.txt'), 'upload'), 'ok')
            assert.ok(fs.existsSync(`${c.fdSrv}/home/u1/sub/m/f.txt`) && fs.existsSync(`${c.fdSrv}/home/u1/sub/n`))
            let ws = srv.ops.filter((v) => v.op === 'open-write')
            assert.ok(ws.length === 1 && ws[0].path.startsWith('/home/u1/sub/deeper/../n/../m/f.txt.'), ws.map((v) => v.path).join())
            await resolved(ftp.mkdir('/abs/new/../other/f'), 'mkdir')
            assert.ok(fs.existsSync(`${c.fdSrv}/abs/new`) && fs.existsSync(`${c.fdSrv}/abs/other`))
        })

        it('cwd回覆前另行conn: cwd以固定訊息reject且不記錄', async function() {
            let { c, ftp } = await connected('cwd-replaced', home)
            prep(c)
            let p = rejected(ftp.cwd('sub'), 'cwd')
            await resolved(ftp.conn(), 'conn2')
            assert.ok(String(await p).startsWith('ftpCwd: the connection to the server is closed ('), String(await p))
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd'), '/home/u1')
        })

        it('cwd至不存在或非資料夾: reject固定訊息, 工作資料夾不變', async function() {
            let { c, ftp } = await connected('cwd-bad', home)
            prep(c)
            await resolved(ftp.cwd('sub'), 'cwd')
            for (let bad of ['nope', 'in.txt']) {
                assert.strict.deepEqual(await rejected(ftp.cwd(bad), bad), 'ftpCwd: can not change the working directory, fpRemote is not a folder')
            }
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd'), '/home/u1/sub')
        })

        it('cwd非有效字串: reject, 工作資料夾不變', async function() {
            let { ftp } = await connected('cwd-nostr', home)
            for (let bad of [undefined, null, '', 123, {}]) {
                let e = await rejected(ftp.cwd(bad), 'bad')
                assert.strict.deepEqual(e, 'ftpCwd: fpRemote is not an effective string')
            }
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd'), '/home/u1')
        })

        it('逾時重新連線後工作資料夾維持; 重新conn後回到登入資料夾', async function() {
            let st = stall()
            st.on = false
            let { c, srv, ftp } = await connected('cwd-reconnect', { server: { home: '/home/u1', hooks: { READDIR: st.hook } } })
            prep(c)
            await resolved(ftp.cwd('sub'), 'cwd')
            st.on = true
            await check(srv, ftp.ls('.'), `ftpLs timeout[${TL}]`, 'ls')
            st.on = false
            assert.strict.deepEqual((await resolved(ftp.ls('.'), 'ls2')).map((v) => v.name).sort(), ['deeper', 'in.txt'])
            await resolved(ftp.quit(), 'quit')
            await resolved(ftp.conn(), 'conn')
            assert.strict.deepEqual(await resolved(ftp.pwd(), 'pwd'), '/home/u1')
        })

    })

    describe('絕對路徑與含..、.起首名稱之路徑', function() {

        let home = { server: { home: '/home/u1' } }

        it('mkdir: 絕對路徑建於該絕對位置', async function() {
            let { c, ftp } = await connected('mkdir-abs', home)
            fs.mkdirSync(`${c.fdSrv}/home/u1`, { recursive: true })
            await resolved(ftp.mkdir('/abs/deep/f.txt'), 'mkdir')
            assert.strict.deepEqual(tree(c.fdSrv), ['abs/', 'abs/deep/', 'home/', 'home/u1/'])
        })

        it('mkdir: 含..與.起首名稱依原樣建立', async function() {
            let { c, ftp } = await connected('mkdir-dots', home)
            fs.mkdirSync(`${c.fdSrv}/home/u1`, { recursive: true })
            await resolved(ftp.mkdir('../x/f.txt'), 'mkdir ..')
            await resolved(ftp.mkdir('.hidden/a/f.txt'), 'mkdir .hidden')
            await resolved(ftp.mkdir('./.dot/f.txt'), 'mkdir ./.dot')
            assert.strict.deepEqual(tree(c.fdSrv), ['home/', 'home/u1/', 'home/u1/.dot/', 'home/u1/.hidden/', 'home/u1/.hidden/a/', 'home/x/'])
        })

        it('mkdir: 登入資料夾為根目錄之伺服器建多層相對路徑(原版於Windows無限遞迴)', async function() {
            let { c, ftp } = await connected('mkdir-root')
            await resolved(ftp.mkdir('./a/b/c/f.txt'), 'mkdir', 10000)
            await resolved(ftp.mkdir('d/e/f.txt'), 'mkdir2', 10000)
            assert.strict.deepEqual(tree(c.fdSrv), ['a/', 'a/b/', 'a/b/c/', 'd/', 'd/e/'])
        })

        it('mkdir: 父資料夾已存在、單層檔案不建任何資料夾', async function() {
            let { c, ftp } = await connected('mkdir-exist', home)
            fs.mkdirSync(`${c.fdSrv}/home/u1/p`, { recursive: true })
            await resolved(ftp.mkdir('p/f.txt'), 'exist')
            await resolved(ftp.mkdir('f.txt'), 'single')
            assert.strict.deepEqual(tree(c.fdSrv), ['home/', 'home/u1/', 'home/u1/p/'])
        })

        it('syncToRemote絕對路徑: 寫入該位置, 再次同步無差異', async function() {
            let { c, ftp } = await connected('sync-up-abs', home)
            fs.mkdirSync(`${c.fdSrv}/home/u1`, { recursive: true })
            fs.mkdirSync(`${c.fdSrv}/dst`, { recursive: true })
            put(c.fdLocal, 'src/a.txt', 'AAA')
            put(c.fdLocal, 'src/n/b.txt', 'BB')
            assert.strict.deepEqual((await resolved(ftp.syncToRemote(`${c.fdLocal}/src`, '/dst'), 'sync')).num, 2)
            assert.strict.deepEqual(tree(c.fdSrv), ['dst/', 'dst/a.txt', 'dst/n/', 'dst/n/b.txt', 'home/', 'home/u1/'])
            assert.strict.deepEqual(await resolved(ftp.syncToRemote(`${c.fdLocal}/src`, '/dst'), 'sync2'), { num: 0, files: [] })
        })

    })

})
