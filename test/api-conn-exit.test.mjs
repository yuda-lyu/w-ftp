import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import assert from 'assert'
import fakeFtpServer from './lib/fakeFtpServer.mjs'
import fakeSftpServer from './lib/fakeSftpServer.mjs'
import { refusedPort, halfOpenProxy, prepareDirs } from './lib/connTestKit.mjs'
import w from 'wsemi'


//以子行程驗證: 連線錯誤(連不上、閒置時被RST)不使行程中止(未捕捉例外); 關閉連線停滯時依timeLimit銷毀連線使行程可自行退出
describe('api-conn-exit', function() {

    let fdBase = './test/_tmp/api-conn-exit'
    let fpClient = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'clientConnFlow.mjs')

    after(function() {
        w.fsDeleteFolder(fdBase)
    })

    //runChild, 起子行程(隱藏視窗), 收到'ready'訊息時呼叫onReady後回覆; 30秒未結束即強制結束(防懸置)
    let runChild = (args, onReady) => {
        return new Promise((resolve) => {
            let child = spawn(process.execPath, [fpClient, ...args.map(String)], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
            let out = ''
            child.stdout.on('data', (d) => {
                out += d.toString()
            })
            child.stderr.on('data', (d) => {
                out += d.toString()
            })
            child.on('message', async (m) => {
                if (m === 'ready') {
                    await onReady()
                    if (child.connected) {
                        child.send('go', () => {})
                    }
                }
            })
            let watchdog = setTimeout(() => {
                child.kill('SIGKILL')
                resolve({ exited: false, code: null, out })
            }, 30000)
            child.on('close', (code) => {
                clearTimeout(watchdog)
                resolve({ exited: true, code, out })
            })
        })
    }

    for (let transportation of ['FTP', 'SFTP']) {

        it(`${transportation}連不上之伺服器: conn與其後操作皆reject, 行程不中止並自行退出`, async function() {
            let port = await refusedPort()
            let r = await runChild(['refused', transportation, port, 15000], async () => {})
            assert.ok(r.out.includes('conn err: ftpConn: can not connect to the server (ECONNREFUSED)'), r.out)
            assert.ok(r.out.includes('ls err: '), r.out)
            assert.ok(r.out.includes('flow done'), r.out)
            assert.strict.deepEqual([r.exited, r.code], [true, 0], r.out)
        })

    }

    it('FTP閒置時控制連線被RST: 行程不中止, 其後重新連線可用', async function() {
        let c = prepareDirs(fdBase, 'ftp-reset')
        let srv = await fakeFtpServer({ fdRoot: c.fdSrv })
        let r = await runChild(['reset', 'FTP', srv.port, 5000], async () => {
            await srv.dropControls({ how: 'reset' })
        })
        await srv.close()
        assert.ok(r.out.includes('ls2 ok'), r.out)
        assert.ok(r.out.includes('flow done'), r.out)
        assert.strict.deepEqual([r.exited, r.code], [true, 0], r.out)
    })

    it('SFTP關閉連線停滯(伺服器不關閉): quit依timeLimit逾時reject, 行程可自行退出', async function() {
        let c = prepareDirs(fdBase, 'sftp-quit')
        let srv = await fakeSftpServer({ fdRoot: c.fdSrv })
        let px = await halfOpenProxy(srv.port)
        let r = await runChild(['quit', 'SFTP', px.port, 800], async () => {})
        await px.close()
        await srv.close()
        assert.ok(r.out.includes('quit err: ftpQuit timeout[800]'), r.out)
        assert.ok(r.out.includes('flow done'), r.out)
        assert.strict.deepEqual([r.exited, r.code], [true, 0], r.out)
    })

})
