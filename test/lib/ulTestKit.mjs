import fs from 'fs'
import path from 'path'
import { genBytes, recorder, settleWithin } from './dlTestKit.mjs'


//本檔為上傳相關測試之共用工具(非測試檔), 供api-sftp-upload-temp與api-ftp-upload-temp共用


//reLeft, 本套件上傳用暫存名(暫存.part、舊檔暫名.old)
let reLeft = /\.\d+\.[0-9A-Za-z]{8}\.(part|old)$/


/**
 * 遞迴列出資料夾下之暫存名檔案(相對路徑), 資料夾不存在回[]
 *
 * @param {String} fd 輸入資料夾
 * @returns {Array} 回傳相對路徑陣列(已排序)
 */
function leftovers(fd) {
    let out = []
    let walk = (d, rel) => {
        if (!fs.existsSync(d)) {
            return
        }
        for (let name of fs.readdirSync(d)) {
            let fp = path.join(d, name)
            let r = rel === '' ? name : `${rel}/${name}`
            if (fs.statSync(fp).isDirectory()) {
                walk(fp, r)
            }
            else if (reLeft.test(name)) {
                out.push(r)
            }
        }
    }
    walk(fd, '')
    return out.sort()
}


/**
 * 建立一個上傳案例之資料夾(伺服器根目錄srv與本機目錄loc), 目標已有舊檔
 *
 * @param {String} fdBase 輸入測試根資料夾
 * @param {String} name 輸入案例名稱
 * @param {Object} [opt={}] 輸入設定, opt.size為本機新檔大小, opt.old為false時目標不存在, opt.seed為內容種子
 * @returns {Object} 回傳{ fdSrv, fpLocal, fpSrv, fresh, old }
 */
function prepareCase(fdBase, name, opt = {}) {
    let n = opt.size === undefined ? 100000 : opt.size
    let seed = opt.seed === undefined ? 2 : opt.seed
    let fdCase = `${fdBase}/${name}`
    fs.rmSync(fdCase, { recursive: true, force: true })
    let fdSrv = `${fdCase}/srv`
    let fdLoc = `${fdCase}/loc`
    fs.mkdirSync(fdSrv, { recursive: true })
    fs.mkdirSync(fdLoc, { recursive: true })
    let fresh = genBytes(n, seed)
    let old = genBytes(701, seed + 50)
    let fpLocal = `${fdLoc}/up.bin`
    fs.writeFileSync(fpLocal, fresh)
    let fpSrv = `${fdSrv}/t.bin`
    if (opt.old !== false) {
        fs.writeFileSync(fpSrv, old)
    }
    return { fdSrv, fpLocal, fpSrv, fresh, old }
}


/**
 * 斷言promise於ms內以reject結束, 回傳reject值
 *
 * @param {Promise} p 輸入promise
 * @param {String} label 輸入斷言說明
 * @param {Integer} [ms=20000] 輸入防懸置上限
 * @returns {Promise} 回傳reject值
 */
async function rejected(p, label, ms = 20000) {
    let r = await settleWithin(p, ms)
    if (!r.settled) {
        throw new Error(`${label}: not settled within ${ms}ms`)
    }
    if (r.ok) {
        throw new Error(`${label}: expected rejection, got resolve`)
    }
    return r.err
}


/**
 * 取reject值之文字(字串原樣, Error取message), 供訊息斷言
 *
 * @param {*} e 輸入reject值
 * @returns {String} 回傳文字
 */
function msgOf(e) {
    if (typeof e === 'string') {
        return e
    }
    return String(e && e.message)
}


export { leftovers, prepareCase, rejected, msgOf, recorder, genBytes, settleWithin }
