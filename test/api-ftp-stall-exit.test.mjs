import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import assert from 'assert'
import fakeFtpServer from './lib/fakeFtpServer.mjs'


describe('api-ftp-stall-exit', function() {

    it('伺服器停滯且不回FIN時, 子行程完成流程後仍可自行退出(回歸: quit硬關閉socket, 殘留socket致行程卡死)', async function() {

        //srv, 停滯模式: 指令不回應, 收到FIN不回關
        let srv = await fakeFtpServer({ mode: 'stall' })

        //fpClient, 子行程腳本, 執行conn→ls→quit後自然結束, 不呼叫process.exit
        let fpClient = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'clientQuitFlow.mjs')

        //spawn, 以子行程驗證event loop可清空, 卡死時由watchdog強殺並判定失敗
        let r = await new Promise((resolve) => {
            let child = spawn(process.execPath, [fpClient, `${srv.port}`, '2000'], { stdio: ['ignore', 'pipe', 'pipe'] })
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
            child.on('exit', (code) => {
                clearTimeout(watchdog)
                resolve({ exited: true, code, stdout })
            })
        })

        await srv.close()

        //斷言: 流程有跑完且行程自行退出
        assert.strict.deepEqual(r.stdout.includes('ls err: ftpLs timeout[2000]'), true, `child stdout: ${r.stdout}`)
        assert.strict.deepEqual(r.stdout.includes('quit err: ftpQuit timeout[2000]'), true, `child stdout: ${r.stdout}`)
        assert.strict.deepEqual(r.stdout.includes('flow done'), true, `child stdout: ${r.stdout}`)
        assert.strict.deepEqual(r.exited, true, '子行程未能自行退出, 殘留socket致event loop無法清空')
        assert.strict.deepEqual(r.code, 0)

    })

})
