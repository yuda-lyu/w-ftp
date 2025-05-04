import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import join from 'lodash-es/join.js'
import isfun from 'wsemi/src/isfun.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import sep from 'wsemi/src/sep.mjs'
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

        //_fdRemote
        let _fdRemote = fdRemote
        if (strleft(fdRemote, 1) === '.') {
            _fdRemote = strdelleft(fdRemote, 1)
        }

        //merge
        let sfd = sep(_fdRemote, '/')
        // console.log('sfd', sfd, _fdRemote)
        let sr = sep(r, '/')
        // console.log('sr', sr, _fdRemote)
        r = [...sfd, ...sr]
        // console.log('merge r', r)
        r = join(r, '/')
        // console.log('join r', r)
        r = `./${r}`
        // console.log('r', r)

        return r
    }

    //fsLocal
    let fsLocal = fsTreeFolder(fdLocal, levelLimit)
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
