import fs from 'fs'
import { spawnSync } from 'child_process'


//本檔為下載暫存區相關測試之共用工具(非測試檔), 供api-sftp-download-temp與api-ftp-download-temp共用


//setTimeoutReal, 模組載入時保存之真實計時器, 防懸置上限一律用此
let setTimeoutReal = setTimeout
let clearTimeoutReal = clearTimeout


/**
 * 產生逐位元組相異之合成內容(位置i之值由i與seed決定), 使內容錯位、缺塊、補零皆可由逐位元組比對看出
 *
 * @param {Integer} n 輸入位元組數
 * @param {Integer} seed 輸入種子(不同檔取不同值)
 * @returns {Buffer} 回傳內容
 */
function genBytes(n, seed) {
    let b = Buffer.alloc(n)
    for (let i = 0; i < n; i++) {
        b[i] = (i * 31 + Math.floor(i / 251) * 7 + seed * 13 + 1) & 0xff
    }
    return b
}


/**
 * 列舉資料夾內之名稱, 資料夾不存在回[]
 *
 * @param {String} fd 輸入資料夾
 * @returns {Array} 回傳名稱陣列(已排序)
 */
function listDir(fd) {
    if (!fs.existsSync(fd)) {
        return []
    }
    return fs.readdirSync(fd).sort()
}


/**
 * 觀察回調之紀錄器: onTrace收集事件, wait(pred, n)等待第n個符合之事件(防懸置上限用真實計時器)
 *
 * @param {Function} [onEvent] 輸入每個事件發生當下額外同步呼叫之函數(供當下快照檔案狀態)
 * @returns {Object} 回傳{ evs, onTrace, wait }
 */
function recorder(onEvent) {
    let evs = []
    let waiters = []
    let check = () => {
        waiters = waiters.filter((w) => {
            let ms = evs.filter(w.pred)
            if (ms.length >= w.n) {
                clearTimeoutReal(w.t)
                w.resolve(ms)
                return false
            }
            return true
        })
    }
    let onTrace = (e) => {
        if (typeof onEvent === 'function') {
            onEvent(e)
        }
        evs.push(e)
        check()
    }
    let wait = (pred, n = 1, ms = 15000) => {
        return new Promise((resolve, reject) => {
            let w = { pred, n, resolve }
            w.t = setTimeoutReal(() => {
                waiters = waiters.filter((x) => x !== w)
                reject(new Error(`wait trace timeout: got ${JSON.stringify(evs)}`))
            }, ms)
            waiters.push(w)
            check()
        })
    }
    return { evs, onTrace, wait }
}


/**
 * 等待promise結束, 逾ms(真實計時器, 只防懸置)仍未結束回settled為false
 *
 * @param {Promise} p 輸入promise
 * @param {Integer} ms 輸入上限毫秒
 * @returns {Promise} 回傳{ settled, ok, value, err }
 */
function settleWithin(p, ms) {
    return new Promise((resolve) => {
        let t = setTimeoutReal(() => {
            resolve({ settled: false, ok: false, value: null, err: null })
        }, ms)
        p.then((value) => {
            clearTimeoutReal(t)
            resolve({ settled: true, ok: true, value, err: null })
        }, (err) => {
            clearTimeoutReal(t)
            resolve({ settled: true, ok: false, value: null, err })
        })
    })
}


/**
 * 閘門: wait()回傳之promise於open()後resolve
 *
 * @returns {Object} 回傳{ wait, open, isOpen }
 */
function gate() {
    let opened = false
    let fns = []
    return {
        wait: () => {
            if (opened) {
                return Promise.resolve()
            }
            return new Promise((resolve) => {
                fns.push(resolve)
            })
        },
        open: () => {
            opened = true
            for (let f of fns) {
                f()
            }
            fns = []
        },
        isOpen: () => opened,
    }
}


/**
 * 訊號: 被觸發後resolve, 可等待(防懸置上限用真實計時器)
 *
 * @returns {Object} 回傳{ fire, wait }
 */
function signal() {
    let fired = false
    let fns = []
    return {
        fire: () => {
            if (fired) {
                return
            }
            fired = true
            for (let f of fns) {
                f()
            }
            fns = []
        },
        wait: (ms = 15000) => {
            if (fired) {
                return Promise.resolve()
            }
            return new Promise((resolve, reject) => {
                let t = setTimeoutReal(() => {
                    reject(new Error('wait signal timeout'))
                }, ms)
                fns.push(() => {
                    clearTimeoutReal(t)
                    resolve()
                })
            })
        },
    }
}


/**
 * 描述檔案狀態(不存在、資料夾、大小與前段是否全為0), 供斷言失敗訊息使用, 不輸出內容本身
 *
 * @param {String} fp 輸入檔案路徑
 * @returns {String} 回傳描述字串
 */
function fileState(fp) {
    if (!fs.existsSync(fp)) {
        return 'absent'
    }
    let st = fs.statSync(fp)
    if (st.isDirectory()) {
        return 'directory'
    }
    let b = fs.readFileSync(fp)
    let head = b.subarray(0, Math.min(1024, b.length))
    let bNul = b.length > 0 && head.every((v) => v === 0)
    return `size=${b.length}${bNul ? ', first bytes are all NUL' : ''}`
}


/**
 * 斷言檔案內容逐位元組等於expected(字串以utf8比對), 失敗訊息只描述狀態不輸出內容
 *
 * @param {String} fp 輸入檔案路徑
 * @param {String|Buffer} expected 輸入預期內容
 * @param {String} label 輸入斷言說明
 */
function assertFile(fp, expected, label) {
    let exp = Buffer.isBuffer(expected) ? expected : Buffer.from(expected, 'utf8')
    let ok = false
    try {
        ok = fs.readFileSync(fp).equals(exp)
    }
    catch (err) {}
    if (!ok) {
        throw new Error(`${label}: expected size=${exp.length}, actual ${fileState(fp)}`)
    }
}


/**
 * 收集測試期間之未處理rejection
 *
 * @returns {Object} 回傳{ list, stop }
 */
function catchUnhandled() {
    let list = []
    let fn = (reason) => {
        list.push(String(reason))
    }
    process.on('unhandledRejection', fn)
    return {
        list,
        stop: () => {
            process.removeListener('unhandledRejection', fn)
        },
    }
}


/**
 * 取得一個已結束之行程之id(測試用之已不存在之行程id): 起一個立即結束之子行程(同步等其結束, 隱藏視窗)並回傳其pid
 *
 * @returns {Integer} 回傳行程id
 */
function deadPid() {
    let r = spawnSync(process.execPath, ['-e', '0'], { windowsHide: true, stdio: 'ignore' })
    return r.pid
}


export { genBytes, listDir, recorder, settleWithin, gate, signal, fileState, assertFile, catchUnhandled, setTimeoutReal, deadPid }
