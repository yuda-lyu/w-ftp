import assert from 'assert'
import WFtp from '../src/WFtp.mjs'
import fakeFtpServer from './lib/fakeFtpServer.mjs'


describe('api-ftp-stall', function() {

    let srv = null

    before(async function() {
        //srv, 停滯模式: 登入後所有指令停滯不回應
        srv = await fakeFtpServer({ mode: 'stall' })
    })

    after(async function() {
        await srv.close()
    })

    it('伺服器停滯時: ls與quit依timeLimit逾時reject, quit後再操作被拒絕', async function() {

        let ftp = WFtp({
            transportation: 'FTP',
            hostname: '127.0.0.1',
            port: srv.port,
            username: 'u1',
            password: 'p1',
            timeLimit: 1500,
        })

        //conn, 僅建構實例不實際連線, 故停滯伺服器下仍成功
        let r = await ftp.conn()
        assert.strict.deepEqual(r, 'ok')

        //ls, 逾時reject
        let errLs = await ftp.ls('.')
            .then(() => null)
            .catch((e) => e)
        assert.strict.deepEqual(errLs, 'ftpLs timeout[1500]')

        //quit, 逾時reject並清理連線
        let errQuit = await ftp.quit()
            .then(() => null)
            .catch((e) => e)
        assert.strict.deepEqual(errQuit, 'ftpQuit timeout[1500]')

        //quit後再操作被拒絕
        let errLs2 = await ftp.ls('.')
            .then(() => null)
            .catch((e) => e)
        assert.strict.deepEqual(errLs2, `FTP has not been initialized. please use 'conn' to construct FTP`)

    })

})
