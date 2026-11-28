import fs from 'fs'
import net from 'net'
import path from 'path'
import w from 'wsemi'
import WFtp from '../../src/WFtp.mjs'
import fakeFtpServer from './fakeFtpServer.mjs'
import fakeSftpServer from './fakeSftpServer.mjs'
import { settleWithin } from './dlTestKit.mjs'


//本檔為連線生命週期(逾時、斷線、重新連線、連不上、絕對路徑)相關測試之共用工具(非測試檔)


/**
 * 建立單一案例之資料夾: <fdBase>/<name>/{srv,local,dltemp}, 已存在者清空
 *
 * @param {String} fdBase 輸入測試根資料夾
 * @param {String} name 輸入案例名
 * @returns {Object} 回傳{ fd, fdSrv, fdLocal, fdTemp }
 */
function prepareDirs(fdBase, name) {
    let fd = `${fdBase}/${name}`
    let r = { fd, fdSrv: `${fd}/srv`, fdLocal: `${fd}/local`, fdTemp: `${fd}/dltemp` }
    w.fsCleanFolder(fd)
    w.fsCreateFolder(r.fdSrv)
    w.fsCreateFolder(r.fdLocal)
    return r
}


/**
 * 於資料夾內寫入檔案(自動建立父資料夾)
 *
 * @param {String} fd 輸入根資料夾
 * @param {String} rp 輸入相對路徑
 * @param {String} text 輸入內容
 */
function put(fd, rp, text) {
    let fp = path.join(fd, rp)
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, text, 'utf8')
}


/**
 * 列舉資料夾下全部項目之相對路徑(以/分隔, 資料夾後綴/), 供斷言「寫到哪裡」
 *
 * @param {String} fd 輸入資料夾
 * @returns {Array} 回傳排序後之相對路徑陣列
 */
function tree(fd) {
    let rs = []
    let walk = (rel) => {
        for (let d of fs.readdirSync(path.join(fd, rel), { withFileTypes: true })) {
            let p = rel === '' ? d.name : `${rel}/${d.name}`
            if (d.isDirectory()) {
                rs.push(`${p}/`)
                walk(p)
            }
            else {
                rs.push(p)
            }
        }
    }
    walk('')
    return rs.sort()
}


/**
 * 建立本套件實例
 *
 * @param {String} transportation 輸入'FTP'或'SFTP'
 * @param {Integer} port 輸入port
 * @param {Object} [opt={}] 輸入其他WFtp設定
 * @returns {Object} 回傳WFtp實例
 */
function newClient(transportation, port, opt = {}) {
    return WFtp({
        transportation,
        hostname: '127.0.0.1',
        port,
        username: 'u1',
        password: 'p1',
        ...opt,
    })
}


/**
 * 蒐集本案例啟動之伺服器與實例, 供afterEach收尾(quit以上限防懸置, 之後關閉伺服器銷毀殘留socket)
 *
 * @returns {Object} 回傳{ ftpServer, sftpServer, client, track, cleanup }
 */
function harness() {
    let srvs = []
    let ftps = []
    let closers = []
    let ftpServer = async (opt) => {
        let s = await fakeFtpServer(opt)
        srvs.push(s)
        return s
    }
    let sftpServer = async (opt) => {
        let s = await fakeSftpServer(opt)
        srvs.push(s)
        return s
    }
    let client = (transportation, port, opt) => {
        let f = newClient(transportation, port, opt)
        ftps.push(f)
        return f
    }
    let track = (close) => {
        closers.push(close)
    }
    let cleanup = async () => {
        for (let f of ftps) {
            await settleWithin(Promise.resolve().then(() => f.quit()), 3000)
        }
        for (let s of srvs) {
            await settleWithin(s.close(), 3000)
        }
        for (let c of closers) {
            await settleWithin(Promise.resolve().then(c), 3000)
        }
        srvs = []
        ftps = []
        closers = []
    }
    return { ftpServer, sftpServer, client, track, cleanup }
}


/**
 * 啟動只接受TCP連線而永不送出任何資料之伺服器(連線建立階段停滯), 回傳{ port, nOpen, waitClosed, close }
 *
 * @returns {Promise} 回傳Promise
 */
async function muteServer() {
    let socks = new Set()
    let waiters = []
    let check = () => {
        if (socks.size === 0) {
            for (let f of waiters) {
                f()
            }
            waiters = []
        }
    }
    let srv = net.createServer((s) => {
        socks.add(s)
        s.on('error', () => {})
        s.on('data', () => {})
        s.on('close', () => {
            socks.delete(s)
            check()
        })
    })
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
    return {
        port: srv.address().port,
        nOpen: () => socks.size,
        waitClosed: () => new Promise((resolve) => {
            waiters.push(resolve)
            check()
        }),
        close: () => {
            for (let s of socks) {
                s.destroy()
            }
            return new Promise((resolve) => srv.close(resolve))
        },
    }
}


/**
 * 取得一個目前無人監聽之port(連線將被拒)
 *
 * @returns {Promise} 回傳Promise，resolve回傳port
 */
async function refusedPort() {
    let srv = net.createServer()
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
    let port = srv.address().port
    await new Promise((resolve) => srv.close(resolve))
    return port
}


/**
 * 啟動轉送代理, 客戶端送出FIN後代理不回FIN(半開), 模擬關閉連線時停滯之伺服器
 *
 * @param {Integer} portTarget 輸入目標port
 * @returns {Promise} 回傳Promise，resolve回傳{ port, close }
 */
async function halfOpenProxy(portTarget) {
    let socks = new Set()
    let srv = net.createServer({ allowHalfOpen: true }, (c) => {
        let s = net.createConnection(portTarget, '127.0.0.1')
        socks.add(c)
        socks.add(s)
        c.on('error', () => {})
        s.on('error', () => {})
        c.on('data', (d) => {
            if (!s.destroyed && s.writable) {
                s.write(d)
            }
        })
        s.on('data', (d) => {
            if (!c.destroyed && c.writable) {
                c.write(d)
            }
        })
    })
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
    return {
        port: srv.address().port,
        close: () => {
            for (let s of socks) {
                s.destroy()
            }
            return new Promise((resolve) => srv.close(resolve))
        },
    }
}


/**
 * 斷言promise於ms內reject, 回傳錯誤值; 未結束或resolve即拋錯(訊息固定, 不內插錯誤值以外之內容)
 *
 * @param {Promise} p 輸入promise
 * @param {String} label 輸入說明
 * @param {Integer} [ms=8000] 輸入上限毫秒(真實計時器, 只防懸置)
 * @returns {Promise} 回傳錯誤值
 */
async function rejected(p, label, ms = 8000) {
    let r = await settleWithin(p, ms)
    if (!r.settled) {
        throw new Error(`${label}: not settled within ${ms}ms`)
    }
    if (r.ok) {
        throw new Error(`${label}: expected rejection, resolved ${JSON.stringify(r.value)}`)
    }
    return r.err
}


/**
 * 斷言promise於ms內resolve, 回傳值
 *
 * @param {Promise} p 輸入promise
 * @param {String} label 輸入說明
 * @param {Integer} [ms=8000] 輸入上限毫秒
 * @returns {Promise} 回傳resolve值
 */
async function resolved(p, label, ms = 8000) {
    let r = await settleWithin(p, ms)
    if (!r.settled) {
        throw new Error(`${label}: not settled within ${ms}ms`)
    }
    if (!r.ok) {
        throw new Error(`${label}: expected resolve, rejected ${String(r.err)}`)
    }
    return r.value
}


export { prepareDirs, put, tree, newClient, harness, muteServer, refusedPort, halfOpenProxy, rejected, resolved }
