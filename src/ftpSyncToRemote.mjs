import get from 'lodash/get'
import find from 'lodash/find'
import iseobj from 'wsemi/src/iseobj.mjs'
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

    //ftpTreeFilesInLocalAndRemote
    let r = await ftpTreeFilesInLocalAndRemote(fdRemote, fdLocal, { ftpLs })
    let fsRemote = r.fsRemote
    let fsLocal = r.fsLocal
    // console.log('fsRemote', fsRemote)
    // console.log('fsLocal', fsLocal)

    //pmSeries
    let n = 0
    let ss = []
    await pmSeries(fsLocal, async (fileLocal) => {
        // console.log('fileLocal', fileLocal)

        //rpath
        let rpath = get(fileLocal, 'rpath', '')
        // console.log('rpath', rpath)

        //fileRemote
        let fileRemote = find(fsRemote, { rpath })
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
            await ftpUpload(fpLocal, fpRemote, cb)
            n++
            ss.push({
                name: fileLocal.rpath,
                reason: 'no Remote file',
            })
        }
        else if (fileLocal.size !== fileRemote.size) {
            //遠端檔案大小與本機檔案大小不同
            await ftpUpload(fpLocal, fpRemote, cb)
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
