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

    let newFtp = () => {
        return WFtp({
            transportation: 'FTP',
            hostname: '127.0.0.1',
            port: srv.port,
            username: 'u1',
            password: 'p1',
            timeLimit: 1500,
        })
    }

    let errOf = (p) => {
        return p.then(() => null)
            .catch((e) => e)
    }

    it('伺服器停滯時: ls依timeLimit逾時reject並銷毀連線, 其後quit直接完成, quit後再操作被拒絕', async function() {

        let ftp = newFtp()

        //conn, 收到歡迎訊息即成功(停滯模式仍送220)
        let r = await ftp.conn()
        assert.strict.deepEqual(r, 'ok')

        //ls, 逾時reject
        assert.strict.deepEqual(await errOf(ftp.ls('.')), 'ftpLs timeout[1500]')

        //quit, 逾時已銷毀連線(規則R-CN-02), 不另建連線送QUIT, 直接完成
        assert.strict.deepEqual(await ftp.quit(), 'ok')

        //quit後再操作被拒絕
        assert.strict.deepEqual(await errOf(ftp.ls('.')), `FTP has not been initialized. please use 'conn' to construct FTP`)

    })

    it('伺服器停滯時: 連線仍存活之quit依timeLimit逾時reject, quit後再操作被拒絕', async function() {

        let ftp = newFtp()
        await ftp.conn()

        //quit, 逾時reject並清理連線
        assert.strict.deepEqual(await errOf(ftp.quit()), 'ftpQuit timeout[1500]')

        //quit後再操作被拒絕
        assert.strict.deepEqual(await errOf(ftp.ls('.')), `FTP has not been initialized. please use 'conn' to construct FTP`)

    })

})
