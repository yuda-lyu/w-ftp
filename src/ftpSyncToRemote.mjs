import path from 'path'
import get from 'lodash-es/get.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import ftpTreeFilesInLocalAndRemote from './ftpTreeFilesInLocalAndRemote.mjs'


async function ftpSyncToRemote(fdLocal, fdRemote, cbProcess, opt = {}) {

    //ftpLs
    let ftpLs = get(opt, 'ftpLs')
    if (!isfun(ftpLs)) {
        return Promise.reject(`opt.ftpLs is not a function`)
    }

    //ftpUpload
    let ftpUpload = get(opt, 'ftpUpload')
    if (!isfun(ftpUpload)) {
        return Promise.reject(`opt.ftpUpload is not a function`)
    }

    //forceOverwriteWhenSync
    let forceOverwriteWhenSync = get(opt, 'forceOverwriteWhenSync')
    if (!isbol(forceOverwriteWhenSync)) {
        forceOverwriteWhenSync = false
    }

    //levelLimit
    let levelLimit = get(opt, 'levelLimit')
    if (!ispint(levelLimit)) {
        levelLimit = null
    }

    //optUpload, 轉交ftpUpload之單次呼叫設定(觀察回調), 由ftpUpload檢測
    let optUpload = {
        onTrace: get(opt, 'onTrace'),
    }

    //optLs, 轉交ftpLs之單次呼叫設定(觀察回調), 列舉階段之逾時與重新連線亦可觀察
    let optLs = {
        onTrace: get(opt, 'onTrace'),
    }

    //ftpTreeFilesInLocalAndRemote
    let r = await ftpTreeFilesInLocalAndRemote(fdRemote, fdLocal, { ftpLs: (fd) => ftpLs(fd, optLs), levelLimit })
    let fsRemote = r.fsRemote
    let fsLocal = r.fsLocal
    // console.log('fsRemote', fsRemote)
    // console.log('fsLocal', fsLocal)

    //比對鍵以posix.normalize正規化: 遠端路徑('<fdRemote>/<名稱>')與本機推得之遠端路徑('./...'或'/...')寫法不同(如fdRemote為'sub'或'sub/')仍視為同一檔
    let key = (p) => path.posix.normalize(String(p))
    let kpRemote = new Map(fsRemote.map((v) => [key(v.rpath), v]))

    //pmSeries
    let n = 0
    let ss = []
    await pmSeries(fsLocal, async (fileLocal) => {
        // console.log('fileLocal', fileLocal)

        //rpath
        let rpath = get(fileLocal, 'rpath', '')
        // console.log('rpath', rpath)

        //fileRemote
        let fileRemote = kpRemote.get(key(rpath))
        // console.log('fileRemote', fileRemote)

        //fpRemote
        let fpRemote = get(fileLocal, 'rpath', '')
        // console.log('fpRemote', fpRemote)

        //fpLocal
        let fpLocal = get(fileLocal, 'path', '')
        // console.log('fpLocal', fpLocal)

        //cb
        let cb = (msg) => {
            if (isfun(cbProcess)) {
                cbProcess(msg)
            }
        }

        //ftpUpload
        if (!iseobj(fileRemote)) {
            //遠端檔案不存在
            await ftpUpload(fpLocal, fpRemote, cb, optUpload)
            n++
            ss.push({
                name: fileLocal.rpath,
                reason: 'no Remote file',
            })
        }
        else if (forceOverwriteWhenSync || (fileLocal.size !== fileRemote.size)) {
            //因無法對伺服器端檔案計算hash, 且儲存至本機的檔案變更時間為當時時間無法用以判斷, 暫時用本地檔案大小與遠端檔案大小檢測是否有變更
            await ftpUpload(fpLocal, fpRemote, cb, optUpload)
            n++
            ss.push({
                name: fileLocal.rpath,
                reason: `size[${fileRemote.size}] of remote file != size[${fileLocal.size}] of local file`,
            })
        }

    })

    return {
        num: n,
        files: ss,
    }
}


export default ftpSyncToRemote
