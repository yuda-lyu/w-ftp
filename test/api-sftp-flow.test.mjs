import fs from 'fs'
import assert from 'assert'
import w from 'wsemi'
import WFtp from '../src/WFtp.mjs'
import fakeSftpServer from './lib/fakeSftpServer.mjs'


describe('api-sftp-flow', function() {

    //fdSrv, 假SFTP伺服器根目錄, 內含第1層2個檔案與第2層1個檔案
    let fdSrv = './_apisftpflow_srv'

    //fdLocal, 本機下載目的資料夾
    let fdLocal = './_apisftpflow_local'

    let srv = null
    let ftp = null

    before(async function() {

        //建立伺服器根目錄與測試檔案
        w.fsCleanFolder(fdSrv)
        fs.writeFileSync(`${fdSrv}/t1.txt`, 'abc-123', 'utf8')
        fs.writeFileSync(`${fdSrv}/t2.txt`, 'def-45678', 'utf8')
        w.fsCreateFolder(`${fdSrv}/sub`)
        fs.writeFileSync(`${fdSrv}/sub/t3.txt`, 'ghi-3', 'utf8')

        //建立本機資料夾
        w.fsCleanFolder(fdLocal)

        //srv, port給0由系統指派, 避免平行測試時衝突
        srv = await fakeSftpServer({ fdRoot: fdSrv })

        //ftp
        ftp = WFtp({
            transportation: 'SFTP',
            hostname: '127.0.0.1',
            port: srv.port,
            username: 'u1',
            password: 'p1',
            timeLimit: 15000,
        })

        //conn
        await ftp.conn()

    })

    after(async function() {
        await srv.close()
        w.fsDeleteFolder(fdSrv)
        w.fsDeleteFolder(fdLocal)
    })

    it('ls: 列舉根目錄之檔案與資料夾', async function() {
        let rs = await ftp.ls('.')
        rs = rs.map((v) => {
            return { name: v.name, size: v.size, isFolder: v.isFolder }
        })
        rs.sort((a, b) => a.name.localeCompare(b.name))
        assert.strict.deepEqual(rs, [
            { name: 'sub', size: 0, isFolder: true },
            { name: 't1.txt', size: 7, isFolder: false },
            { name: 't2.txt', size: 9, isFolder: false },
        ])
    })

    it('isFile與isFolder: 檔案, 資料夾與不存在路徑', async function() {
        assert.strict.deepEqual(await ftp.isFile('./t1.txt'), true)
        assert.strict.deepEqual(await ftp.isFolder('./t1.txt'), false)
        assert.strict.deepEqual(await ftp.isFolder('./sub'), true)
        assert.strict.deepEqual(await ftp.isFile('./sub'), false)
        assert.strict.deepEqual(await ftp.isFile('./nonexist.txt'), false)
        assert.strict.deepEqual(await ftp.isFolder('./nonexist'), false)
    })

    it('download: 下載第2層檔案並核對內容', async function() {
        let r = await ftp.download('./sub/t3.txt', `${fdLocal}/t3.txt`)
        assert.strict.deepEqual(r, 'ok')
        assert.strict.deepEqual(fs.readFileSync(`${fdLocal}/t3.txt`, 'utf8'), 'ghi-3')
    })

    it('quit: 正常關閉連線, 之後操作被拒絕', async function() {
        let r = await ftp.quit()
        assert.strict.deepEqual(r, 'ok')
        let err = await ftp.ls('.')
            .then(() => null)
            .catch((e) => e)
        assert.strict.deepEqual(err, `FTP has not been initialized. please use 'conn' to construct FTP`)
    })

})
