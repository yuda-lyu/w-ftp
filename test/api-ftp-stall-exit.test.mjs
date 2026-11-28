import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import assert from 'assert'
import fakeFtpServer from './lib/fakeFtpServer.mjs'


describe('api-ftp-stall-exit', function() {

    //run, 對停滯模式伺服器(指令不回應, 收到FIN不回關)起子行程執行conn→(ls)→quit後自然結束(不呼叫process.exit), 卡死時由watchdog強殺並判定失敗
    let run = async (scenario) => {

        let srv = await fakeFtpServer({ mode: 'stall' })
        let fpClient = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'clientQuitFlow.mjs')

        //spawn, 以子行程驗證event loop可清空
        let r = await new Promise((resolve) => {
            let child = spawn(process.execPath, [fpClient, `${srv.port}`, '2000', scenario], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
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
            }, 15000)
            child.on('close', (code) => {
                clearTimeout(watchdog)
                resolve({ exited: true, code, stdout })
            })
        })

        await srv.close()

        //斷言: 流程有跑完且行程自行退出
        assert.strict.deepEqual(r.stdout.includes('flow done'), true, `child stdout: ${r.stdout}`)
        assert.strict.deepEqual(r.exited, true, '子行程未能自行退出, 殘留socket致event loop無法清空')
        assert.strict.deepEqual(r.code, 0)

        return r.stdout
    }

    it('伺服器停滯且不回FIN時: ls逾時銷毀連線, 子行程完成流程後仍可自行退出', async function() {
        let stdout = await run('ls')
        assert.strict.deepEqual(stdout.includes('ls err: ftpLs timeout[2000]'), true, `child stdout: ${stdout}`)
        assert.strict.deepEqual(stdout.includes('quit ok: ok'), true, `child stdout: ${stdout}`)
    })

    it('伺服器停滯且不回FIN時: quit逾時硬關閉socket, 子行程可自行退出(回歸: 殘留socket致行程卡死)', async function() {
        let stdout = await run('quit')
        assert.strict.deepEqual(stdout.includes('quit err: ftpQuit timeout[2000]'), true, `child stdout: ${stdout}`)
    })

})
