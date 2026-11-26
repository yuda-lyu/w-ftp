import fs from 'fs'
import assert from 'assert'
import w from 'wsemi'
import WFtp from '../src/WFtp.mjs'
import fakeFtpServer from './lib/fakeFtpServer.mjs'


//多層資料夾之syncToRemote與syncToLocal(真實WFtp經假FTP伺服器, 不替身ftpLs/ftpUpload/ftpDownload)
//規格(使用端需求, wsemi fsTreeFolder之levelLimit改制): opt.levelLimit未給時表不限層數, 本機端列舉須含全部層級,
//本機端列舉短少(例如誤以只列第1層之形式呼叫wsemi之fsTreeFolder)會使上傳漏檔, 或使已同步之深層檔案被重複下載
describe('api-ftp-sync-multilevel', function() {

    //fdBase, 測試臨時資料夾(依測試規範放test/_tmp/<案名>/)
    let fdBase = './test/_tmp/ftp-sync-multilevel'
    let fdSrv = `${fdBase}/srv`
    let fdUp = `${fdBase}/up`
    let fdDw = `${fdBase}/dw`

    let srv = null
    let ftp = null

    before(async function() {
        w.fsDeleteFolder(fdBase)

        //fdSrv, 伺服器端: 第1層1個檔案, 第2層1個檔案, 第3層1個檔案
        w.fsCreateFolder(`${fdSrv}/a/b`)
        fs.writeFileSync(`${fdSrv}/r1.txt`, 'r1', 'utf8')
        fs.writeFileSync(`${fdSrv}/a/r2.txt`, 'r2-22', 'utf8')
        fs.writeFileSync(`${fdSrv}/a/b/r3.txt`, 'r3-333', 'utf8')

        //fdUp, 本機上傳來源: 第1層1個檔案, 第2層1個檔案, 第3層1個檔案
        w.fsCreateFolder(`${fdUp}/m/n`)
        fs.writeFileSync(`${fdUp}/u1.txt`, 'u1', 'utf8')
        fs.writeFileSync(`${fdUp}/m/u2.txt`, 'u2-22', 'utf8')
        fs.writeFileSync(`${fdUp}/m/n/u3.txt`, 'u3-333', 'utf8')

        //fdDw, 本機下載目的
        w.fsCreateFolder(fdDw)

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
            fdDownloadTemp: `${fdBase}/dltemp`, //下載暫存區(指定之, 免於cwd留下預設資料夾)
        })
        let r = await ftp.conn()
        assert.strict.deepEqual(r, 'ok')
    })

    after(async function() {
        await ftp.quit()
            .catch(() => {})
        await srv.close()
        w.fsDeleteFolder(fdBase)
    })

    it('syncToRemote: 本機3層資料夾全部上傳至伺服器, 再同步一次無差異(num=0)', async function() {
        let r = await ftp.syncToRemote(fdUp, '.', null)
        assert.strict.deepEqual(r.num, 3)
        assert.strict.deepEqual(fs.readFileSync(`${fdSrv}/u1.txt`, 'utf8'), 'u1')
        assert.strict.deepEqual(fs.readFileSync(`${fdSrv}/m/u2.txt`, 'utf8'), 'u2-22')
        assert.strict.deepEqual(fs.readFileSync(`${fdSrv}/m/n/u3.txt`, 'utf8'), 'u3-333')
        let r2 = await ftp.syncToRemote(fdUp, '.', null)
        assert.strict.deepEqual(r2.num, 0)
    })

    it('syncToLocal: 伺服器3層以上資料夾全部下載至本機, 再同步一次無差異(num=0)', async function() {

        //此時伺服器含r1,a/r2,a/b/r3與上一案上傳之u1,m/u2,m/n/u3, 共6個檔案
        let r = await ftp.syncToLocal('.', fdDw, null)
        assert.strict.deepEqual(r.num, 6)
        assert.strict.deepEqual(fs.readFileSync(`${fdDw}/r1.txt`, 'utf8'), 'r1')
        assert.strict.deepEqual(fs.readFileSync(`${fdDw}/a/r2.txt`, 'utf8'), 'r2-22')
        assert.strict.deepEqual(fs.readFileSync(`${fdDw}/a/b/r3.txt`, 'utf8'), 'r3-333')
        assert.strict.deepEqual(fs.readFileSync(`${fdDw}/m/n/u3.txt`, 'utf8'), 'u3-333')
        let r2 = await ftp.syncToLocal('.', fdDw, null)
        assert.strict.deepEqual(r2.num, 0)
    })

    it('syncToLocal與syncToRemote給levelLimit=1: 只處理第1層(既有行為不變)', async function() {
        let fdDw1 = `${fdBase}/dw1`
        w.fsCreateFolder(fdDw1)
        let r = await ftp.syncToLocal('.', fdDw1, null, { levelLimit: 1 })
        assert.strict.deepEqual(r.num, 2) //伺服器第1層僅r1.txt與u1.txt
        assert.strict.deepEqual(fs.existsSync(`${fdDw1}/r1.txt`), true)
        assert.strict.deepEqual(fs.existsSync(`${fdDw1}/a`), false)
    })

})
