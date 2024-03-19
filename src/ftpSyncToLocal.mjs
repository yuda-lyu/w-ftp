import get from 'lodash-es/get'
import find from 'lodash-es/find'
import iseobj from 'wsemi/src/iseobj.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import ftpTreeFilesInLocalAndRemote from './ftpTreeFilesInLocalAndRemote.mjs'


async function ftpSyncToLocal(fdRemote, fdLocal, cbProcess, opt = {}) {

    //forceOverwriteWhenSync
    let forceOverwriteWhenSync = get(opt, 'forceOverwriteWhenSync')
    if (!isbol(forceOverwriteWhenSync)) {
        forceOverwriteWhenSync = false
    }

    //ftpLs
    let ftpLs = get(opt, 'ftpLs')
    if (!isfun(ftpLs)) {
        return Promise.reject(`opt.ftpLs is not a function`)
    }

    //ftpDownload
    let ftpDownload = get(opt, 'ftpDownload')
    if (!isfun(ftpDownload)) {
        return Promise.reject(`opt.ftpDownload is not a function`)
    }

    //check fdLocal
    if (!fsIsFolder(fdLocal)) {
        fsCreateFolder(fdLocal)
    }

    //ftpTreeFilesInLocalAndRemote
    let r = await ftpTreeFilesInLocalAndRemote(fdRemote, fdLocal, { ftpLs })
    let fsRemote = r.fsRemote
    let fsLocal = r.fsLocal
    // console.log('fsRemote', fsRemote)
    // console.log('fsLocal', fsLocal)

    //pmSeries
    let n = 0
    let ss = []
    await pmSeries(fsRemote, async (fileRemote) => {
        // console.log('fileRemote', fileRemote)

        //lpath
        let lpath = get(fileRemote, 'lpath', '')
        // console.log('lpath', lpath)

        //fileLocal
        let fileLocal = find(fsLocal, { path: lpath })
        // console.log('fileLocal', fileLocal)

        //fpRemote
        let fpRemote = get(fileRemote, 'rpath', '')
        // console.log('fpRemote', fpRemote)

        //fpLocal
        let fpLocal = get(fileRemote, 'lpath', '')
        // console.log('fpLocal', fpLocal)

        //cb
        let cb = (msg) => {
            if (isfun(cbProcess)) {
                cbProcess(msg)
            }
        }

        //ftpDownload
        if (!iseobj(fileLocal)) {
            //本地檔案不存在
            await ftpDownload(fpRemote, fpLocal, cb)
            n++
            ss.push({
                path: fileRemote.rpath,
                reason: 'no local file',
            })
        }
        else if (forceOverwriteWhenSync || (fileRemote.size !== fileLocal.size)) {
            //因無法對伺服器端檔案計算hash, 且儲存至本機的檔案變更時間為當時時間無法用以判斷, 暫時用本地檔案大小與遠端檔案大小檢測是否有變更
            await ftpDownload(fpRemote, fpLocal, cb)
            n++
            ss.push({
                path: fileRemote.rpath,
                reason: `size[${fileLocal.size}] of local file != size[${fileRemote.size}] of remote file`,
            })
        }

    })

    return {
        num: n,
        files: ss,
    }
}


export default ftpSyncToLocal
