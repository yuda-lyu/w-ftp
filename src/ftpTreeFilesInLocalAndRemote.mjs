import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import join from 'lodash-es/join.js'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import strdelleft from 'wsemi/src/strdelleft.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import ftpTreeFolder from './ftpTreeFolder.mjs'


async function ftpTreeFilesInLocalAndRemote(fdRemote, fdLocal, opt = {}) {

    //check fdLocal
    if (!fsIsFolder(fdLocal)) {
        return Promise.reject(`fdLocal[${fdLocal}] is not a folder`)
    }

    //ftpLs
    let ftpLs = get(opt, 'ftpLs')
    if (!isfun(ftpLs)) {
        return Promise.reject(`opt.ftpLs is not a function`)
    }

    //levelLimit
    let levelLimit = get(opt, 'levelLimit')
    if (!ispint(levelLimit)) {
        levelLimit = null
    }

    //path.resolve
    fdLocal = path.resolve(fdLocal) //轉絕對路徑
    // console.log('fdLocal', fdLocal)

    //cvrp
    let cvrp = (p) => {

        //replace
        p = path.resolve(p) //轉絕對路徑
        let r = p.replace(fdLocal, '') //取代本機路徑
        let o = new RegExp(`\\\\`, 'g')
        r = String(r).replace(o, '/')

        //merge, fdRemote之絕對('/'起首)維持絕對, 其'..'與'.'起首名稱原樣保留; 空段與'.'段略去, 名稱不修剪前後空白
        let sfd = filter(String(isestr(fdRemote) ? fdRemote : '').split('/'), (v) => v !== '' && v !== '.')
        let sr = filter(r.split('/'), (v) => v !== '')
        r = join([...sfd, ...sr], '/')
        let abs = isestr(fdRemote) && fdRemote.startsWith('/')

        return abs ? `/${r}` : `./${r}`
    }

    //optLocal, wsemi之fsTreeFolder自1.9.80起第2參數為opt, 未給opt.levelLimit即列舉全部層級, 故不限層數(null)時不給opt.levelLimit, 有限層數才給
    let optLocal = levelLimit === null ? {} : { levelLimit }

    //fsLocal
    let fsLocal = fsTreeFolder(fdLocal, optLocal)
    fsLocal = filter(fsLocal, (v) => {
        return !v.isFolder
    })
    fsLocal = map(fsLocal, (v) => {
        let stat = fs.statSync(v.path)
        v.size = get(stat, 'size', 0)
        v.rpath = cvrp(v.path)
        return v
    })
    // console.log('fsLocal', fsLocal)

    //cvlp
    let cvlp = (rp) => {
        // console.log('fdRemote', fdRemote)
        // console.log('fdLocal', fdLocal)
        if (fdRemote !== '.') {
            rp = rp.replace(fdRemote, '')
            // console.log('rp', rp)
        }
        if (strleft(rp, 1) === '.') {
            rp = strdelleft(rp, 1)
        }
        if (strleft(rp, 1) === '/') {
            rp = strdelleft(rp, 1)
        }
        let r = path.resolve(fdLocal, rp)
        // console.log('r', r)
        return r
    }

    //fsRemote
    let fsRemote = await ftpTreeFolder(fdRemote, ftpLs, { levelLimit })
    fsRemote = filter(fsRemote, (v) => {
        return !v.isFolder
    })
    fsRemote = map(fsRemote, (v) => {
        v.lpath = cvlp(v.rpath)
        return v
    })
    // console.log('fsRemote', fsRemote)

    return {
        fsRemote,
        fsLocal,
    }
}


export default ftpTreeFilesInLocalAndRemote
