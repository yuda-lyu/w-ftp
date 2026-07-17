import fs from 'fs'
import assert from 'assert'
import w from 'wsemi'
import WFtp from '../src/WFtp.mjs'
import fakeFtpServer from './lib/fakeFtpServer.mjs'


describe('api-ftp-flow', function() {

    //fdSrv, 假FTP伺服器根目錄, 內含第1層2個檔案與第2層1個檔案
    let fdSrv = './_apiftpflow_srv'

    //fdLocal, 本機下載與上傳來源資料夾
    let fdLocal = './_apiftpflow_local'

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
        srv = await fakeFtpServer({ fdRoot: fdSrv })

        //ftp
        ftp = WFtp({
            transportation: 'FTP',
            hostname: '127.0.0.1',
            port: srv.port,
            username: 'u1',
            password: 'p1',
            timeLimit: 10000,
        })

        //conn
        let r = await ftp.conn()
        assert.strict.deepEqual(r, 'ok')

    })

    after(async function() {
        await srv.close()
        w.fsDeleteFolder(fdSrv)
        w.fsDeleteFolder(fdLocal)
    })

    it('ls: 列舉根目錄之檔案與資料夾', async function() {
        let rs = await ftp.ls('.')
        rs = rs.map((v) => {
            return { name: v.name, size: v.isFolder ? null : v.size, isFolder: v.isFolder } //資料夾之size隨平台而異(ext4為4096, NTFS為0), 無語義不列入比對
        })
        rs.sort((a, b) => a.name.localeCompare(b.name))
        assert.strict.deepEqual(rs, [
            { name: 'sub', size: null, isFolder: true },
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

    it('upload: 上傳檔案至根目錄並核對內容', async function() {
        fs.writeFileSync(`${fdLocal}/up1.txt`, 'up1-data', 'utf8')
        let r = await ftp.upload(`${fdLocal}/up1.txt`, './up1.txt')
        assert.strict.deepEqual(r, 'ok')
        assert.strict.deepEqual(fs.readFileSync(`${fdSrv}/up1.txt`, 'utf8'), 'up1-data')
    })

    it('upload: 上傳檔案至多層資料夾(自動mkdir)並核對內容', async function() {
        fs.writeFileSync(`${fdLocal}/up2.txt`, 'up2-data', 'utf8')
        let r = await ftp.upload(`${fdLocal}/up2.txt`, './deep/up2.txt')
        assert.strict.deepEqual(r, 'ok')
        assert.strict.deepEqual(fs.readFileSync(`${fdSrv}/deep/up2.txt`, 'utf8'), 'up2-data')
    })

    it('登入失敗: 密碼錯誤時操作被拒絕', async function() {
        let ftpBad = WFtp({
            transportation: 'FTP',
            hostname: '127.0.0.1',
            port: srv.port,
            username: 'u1',
            password: 'bad',
            timeLimit: 10000,
        })
        await ftpBad.conn()
        let err = await ftpBad.ls('.')
            .then(() => null)
            .catch((e) => e)
        assert.strict.deepEqual(err !== null, true)
        assert.strict.deepEqual(err.code, 530)
        await ftpBad.quit()
            .catch(() => {})
    })

    it('quit: 正常關閉連線, 之後操作被拒絕', async function() {
        let r = await ftp.quit()
        assert.strict.deepEqual(r.code, 221)
        let err = await ftp.ls('.')
            .then(() => null)
            .catch((e) => e)
        assert.strict.deepEqual(err, `FTP has not been initialized. please use 'conn' to construct FTP`)
    })

})
