import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import assert from 'assert'
import w from 'wsemi'
import fakeFtpServer from './lib/fakeFtpServer.mjs'
import fakeSftpServer from './lib/fakeSftpServer.mjs'
import { assertFile } from './lib/dlTestKit.mjs'
import { genBytes, leftovers } from './lib/ulTestKit.mjs'


//上傳逾時後不留背景工作: 子行程對停滯之伺服器上傳逾時並quit後可自行退出(殘留之socket、計時器或背景續傳會使行程卡住)
//規格(使用端需求Gitea #214 §4第6項): 逾時須真正中止傳輸, 不留背景續寫
describe('api-upload-stall-exit', function() {

    let fdBase = './test/_tmp/upload-stall-exit'
    let fpClient = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'clientUploadFlow.mjs')

    before(function() {
        w.fsDeleteFolder(fdBase)
    })

    after(function() {
        w.fsDeleteFolder(fdBase)
    })

    //prepare, 伺服器根目錄有舊檔, 本機新檔
    let prepare = (name) => {
        let fdSrv = `${fdBase}/${name}/srv`
        fs.mkdirSync(fdSrv, { recursive: true })
        let old = genBytes(701, 9)
        fs.writeFileSync(`${fdSrv}/t.bin`, old)
        let fpLocal = `${fdBase}/${name}/up.bin`
        fs.writeFileSync(fpLocal, genBytes(8 * 1024 * 1024, 3))
        return { fdSrv, fpLocal, old }
    }

    //runChild, 執行子行程, 逾watchdog未自行退出者強制結束並回exited=false
    let runChild = (args) => {
        return new Promise((resolve) => {
            let child = spawn(process.execPath, [fpClient, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
            let stdout = ''
            child.stdout.on('data', (d) => {
                stdout += d.toString()
            })
            child.stderr.on('data', (d) => {
                stdout += d.toString()
            })
            let watchdog = setTimeout(() => {
                child.kill('SIGKILL')
                resolve({ exited: false, code: null, stdout })
            }, 30000)
            child.on('exit', (code) => {
                clearTimeout(watchdog)
                resolve({ exited: true, code, stdout })
            })
        })
    }

    let check = (r, msg) => {
        assert.ok(r.stdout.includes(msg), `child stdout: ${r.stdout}`)
        assert.ok(r.stdout.includes('flow done'), `child stdout: ${r.stdout}`)
        assert.ok(r.exited, `子行程未能自行退出: ${r.stdout}`)
        assert.strict.deepEqual(r.code, 0, r.stdout)
    }

    it('FTP: 伺服器不讀數據(傳輸逾時), 清理成功後子行程自行退出, 無殘檔', async function() {
        let c = prepare('ftp-data')
        let srv = await fakeFtpServer({
            fdRoot: c.fdSrv,
            hooks: {
                STOR: async ({ fp, reply, waitDs }) => {
                    fs.writeFileSync(fp, '')
                    reply('150 ok')
                    let ds = await waitDs()
                    ds.pause()
                },
            },
        })
        let r = await runChild(['FTP', `${srv.port}`, '1500', c.fpLocal])
        await srv.close()
        check(r, 'upload err: ftpUploadCore timeout[1500]\n')
        assertFile(`${c.fdSrv}/t.bin`, c.old, '舊目標不變')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
    })

    it('FTP: STOR起伺服器對任何指令皆不再回應(含重新連線), 子行程仍自行退出', async function() {
        let c = prepare('ftp-all')
        let stall = false
        let srv = await fakeFtpServer({
            fdRoot: c.fdSrv,
            hooks: {
                CMD: ({ cmd }) => {
                    if (cmd === 'STOR') {
                        stall = true
                    }
                    return stall
                },
            },
        })
        let r = await runChild(['FTP', `${srv.port}`, '1500', c.fpLocal])
        await srv.close()
        check(r, 'upload err: ftpUploadCore timeout[1500], can not remove the remote temporary file')
        assertFile(`${c.fdSrv}/t.bin`, c.old, '舊目標不變')
    })

    it('SFTP: 寫入停滯(傳輸逾時), 清理成功後子行程自行退出, 無殘檔', async function() {
        let c = prepare('sftp-write')
        let n = 0
        let srv = await fakeSftpServer({
            fdRoot: c.fdSrv,
            hooks: {
                WRITE: ({ respond }) => {
                    if (n++ === 0) {
                        respond()
                    }
                },
            },
        })
        let r = await runChild(['SFTP', `${srv.port}`, '1500', c.fpLocal])
        await srv.close()
        check(r, 'upload err: ftpUploadCore timeout[1500]\n')
        assertFile(`${c.fdSrv}/t.bin`, c.old, '舊目標不變')
        assert.strict.deepEqual(leftovers(c.fdSrv), [])
    })

    it('SFTP: 寫入與刪除皆停滯, 子行程仍自行退出, 訊息標示暫存未清', async function() {
        let c = prepare('sftp-all')
        let srv = await fakeSftpServer({
            fdRoot: c.fdSrv,
            hooks: {
                WRITE: () => {},
                REMOVE: () => {},
            },
        })
        let r = await runChild(['SFTP', `${srv.port}`, '1500', c.fpLocal])
        await srv.close()
        check(r, 'upload err: ftpUploadCore timeout[1500], can not remove the remote temporary file')
        assertFile(`${c.fdSrv}/t.bin`, c.old, '舊目標不變')
    })

})
