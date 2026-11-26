import fs from 'fs'
import path from 'path'
import ssh2 from 'ssh2'


let { Server, utils } = ssh2
let { STATUS_CODE } = utils.sftp


//hostKey, 主機金鑰於行程內只產生一次並共用;
//ssh2之utils.generateKeyPairSync('ed25519')所產私鑰偶有無法解析者(實測5000次中14次'Malformed OpenSSH private key', ssh2 1.17.0), 此時new Server拋錯而測試偶發失敗,
//故產生後以utils.parseKey驗證, 不可解析者重產(有界)
let hostKey = null
let getHostKey = () => {
    if (hostKey !== null) {
        return hostKey
    }
    for (let i = 0; i < 20; i++) {
        let kp = utils.generateKeyPairSync('ed25519')
        if (!(utils.parseKey(kp.private) instanceof Error)) {
            hostKey = kp.private
            return hostKey
        }
    }
    throw new Error('can not generate a parsable host key')
}


/**
 * 啟動測試用之假SFTP伺服器，供測試連線與下載檔案
 *
 * 僅實作供w-ftp之CoreSFTP下載檔案所需指令，為唯讀伺服器，不支援上傳與刪除
 *
 * 主機金鑰於執行期即時生成，不需外部金鑰檔
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.fdRoot 輸入伺服器根目錄字串，客戶端所見路徑皆相對於此資料夾
 * @param {String} [opt.username='u1'] 輸入允許登入之帳號字串，預設'u1'
 * @param {String} [opt.password='p1'] 輸入允許登入之密碼字串，預設'p1'
 * @param {Integer} [opt.port=0] 輸入監聽port正整數，預設0代表由系統指派可用port
 * @param {Object} [opt.hooks={}] 輸入測試用之攔截函數物件，未給之鍵行為同原版，預設{}
 * @param {Function} [opt.hooks.READ] 輸入READ攔截函數，收到{ handle, offset, len, client, respond }，handle為該檔開啟代號字串(每次OPEN不同)，呼叫respond()即依原版回應；可延後呼叫(模擬停滯)、或不呼叫而以client.end()斷線(模擬傳輸中途斷線)
 * @param {Function} [opt.hooks.OPEN] 輸入OPEN攔截函數，收到{ client, respond }，呼叫respond()即依原版回應；可延後呼叫(模擬停滯於開啟遠端檔)
 * @param {Function} [opt.hooks.STAT] 輸入STAT與LSTAT攔截函數，收到{ client, path, respond }，呼叫respond()即依原版回應；可延後呼叫(模擬停滯於查詢遠端檔案資訊)
 * @param {Function} [opt.hooks.statSize] 輸入STAT與LSTAT回報大小之改寫函數，收到(實際大小, 客戶端路徑)回傳回報大小(FSTAT不改寫)，供模擬遠端回報大小與實際傳輸大小不符
 * @returns {Promise} 回傳Promise，resolve回傳伺服器物件，內含實際監聽port正整數與關閉伺服器函數close
 */
let fakeSftpServer = async(opt = {}) => {

    //fdRoot
    let fdRoot = path.resolve(opt.fdRoot)

    //username
    let username = opt.username || 'u1'

    //password
    let password = opt.password || 'p1'

    //port, 0代表由系統指派可用port, 供mocha平行測試時避免衝突
    let port = opt.port || 0

    //hooks
    let hooks = opt.hooks || {}

    //clients, 記錄連線中之客戶端, 供close時斷線(停滯情境之客戶端未quit時, 不斷線則server.close不結束)
    let clients = new Set()

    //hostKeys, 執行期即時生成(行程內共用, 見getHostKey)
    let hk = getHostKey()

    //toReal, 將客戶端路徑轉為根目錄內實體路徑, 並限制不可逃逸至根目錄外
    let toReal = (p) => {
        return path.resolve(fdRoot, '.' + path.posix.resolve('/', p))
    }

    //toAttrs
    let toAttrs = (stat) => {
        return {
            mode: stat.mode,
            uid: 0,
            gid: 0,
            size: stat.size,
            atime: Math.floor(stat.atimeMs / 1000),
            mtime: Math.floor(stat.mtimeMs / 1000),
        }
    }

    //bindSftp
    let bindSftp = (sftp, client) => {

        //handles, 記錄已開啟之資料夾與檔案
        let handles = {}
        let nHandle = 0

        //onStat, STAT與LSTAT行為相同, 因不支援連結檔
        let onStat = (id, p) => {
            let respond = () => {
                try {
                    let attrs = toAttrs(fs.statSync(toReal(p)))
                    if (typeof hooks.statSize === 'function' && fs.statSync(toReal(p)).isFile()) {
                        attrs.size = hooks.statSize(attrs.size, p)
                    }
                    sftp.attrs(id, attrs)
                }
                catch (err) {
                    sftp.status(id, STATUS_CODE.NO_SUCH_FILE)
                }
            }
            if (typeof hooks.STAT === 'function') {
                hooks.STAT({ client, path: p, respond })
                return
            }
            respond()
        }

        sftp.on('REALPATH', (id, p) => {
            let rp = path.posix.resolve('/', p === '.' ? '/' : p)
            sftp.name(id, [{ filename: rp, longname: rp, attrs: {} }])
        })

        sftp.on('STAT', onStat)

        sftp.on('LSTAT', onStat)

        sftp.on('FSTAT', (id, h) => {
            let hd = handles[h.toString()]
            if (!hd || hd.type !== 'file') {
                return sftp.status(id, STATUS_CODE.FAILURE)
            }
            sftp.attrs(id, toAttrs(fs.fstatSync(hd.fd)))
        })

        sftp.on('OPENDIR', (id, p) => {
            let rp = toReal(p)
            if (!fs.existsSync(rp) || !fs.statSync(rp).isDirectory()) {
                return sftp.status(id, STATUS_CODE.NO_SUCH_FILE)
            }
            let key = `d${nHandle}`
            nHandle += 1
            handles[key] = { type: 'dir', rp, hasRead: false }
            sftp.handle(id, Buffer.from(key))
        })

        sftp.on('READDIR', (id, h) => {
            let hd = handles[h.toString()]
            if (!hd || hd.type !== 'dir' || hd.hasRead) {
                return sftp.status(id, STATUS_CODE.EOF) //需回傳EOF告知客戶端已列舉完畢
            }
            hd.hasRead = true
            let names = fs.readdirSync(hd.rp).map((name) => {
                let stat = fs.statSync(path.join(hd.rp, name))
                let mark = stat.isDirectory() ? 'd' : '-'
                return {
                    filename: name,
                    longname: `${mark}rw-r--r-- 1 user user ${stat.size} Jan 1 00:00 ${name}`,
                    attrs: toAttrs(stat),
                }
            })
            sftp.name(id, names)
        })

        sftp.on('OPEN', (id, p) => {
            let respond = () => {
                try {
                    let fd = fs.openSync(toReal(p), 'r') //唯讀
                    let key = `f${nHandle}`
                    nHandle += 1
                    handles[key] = { type: 'file', fd }
                    sftp.handle(id, Buffer.from(key))
                }
                catch (err) {
                    sftp.status(id, STATUS_CODE.NO_SUCH_FILE)
                }
            }
            if (typeof hooks.OPEN === 'function') {
                hooks.OPEN({ client, respond })
                return
            }
            respond()
        })

        sftp.on('READ', (id, h, offset, len) => {
            let hd = handles[h.toString()]
            if (!hd || hd.type !== 'file') {
                return sftp.status(id, STATUS_CODE.FAILURE)
            }
            let buf = Buffer.alloc(len)
            let nRead = fs.readSync(hd.fd, buf, 0, len, offset) //先讀出, 延後回應時檔案已被關閉亦可回應
            let respond = () => {
                if (nRead === 0) {
                    return sftp.status(id, STATUS_CODE.EOF)
                }
                sftp.data(id, buf.subarray(0, nRead))
            }
            if (typeof hooks.READ === 'function') {
                hooks.READ({ handle: h.toString(), offset, len, client, respond })
                return
            }
            respond()
        })

        sftp.on('CLOSE', (id, h) => {
            let key = h.toString()
            let hd = handles[key]
            if (hd && hd.type === 'file') {
                fs.closeSync(hd.fd)
            }
            delete handles[key]
            sftp.status(id, STATUS_CODE.OK)
        })

    }

    //srv
    let srv = new Server({ hostKeys: [hk] }, (client) => {
        clients.add(client)
        client.on('close', () => {
            clients.delete(client)
        })
        client.on('authentication', (ctx) => {
            if (ctx.method === 'password' && ctx.username === username && ctx.password === password) {
                ctx.accept()
            }
            else if (ctx.method === 'none') {
                ctx.reject(['password']) //告知客戶端須使用password認證
            }
            else {
                ctx.reject()
            }
        })
        client.on('ready', () => {
            client.on('session', (accept) => {
                let session = accept()
                session.on('sftp', (accept) => {
                    bindSftp(accept(), client)
                })
            })
        })
        client.on('error', () => {}) //須catch, 避免客戶端斷線時拋出例外造成程序中止
    })

    //listen
    await new Promise((resolve) => {
        srv.listen(port, '127.0.0.1', resolve)
    })

    //close, 先斷開仍連線之客戶端, 否則server.close等待其結束
    let close = async() => {
        for (let c of clients) {
            c.end()
        }
        return new Promise((resolve) => {
            srv.close(resolve)
        })
    }

    return {
        port: srv.address().port,
        close,
    }
}


export default fakeSftpServer
