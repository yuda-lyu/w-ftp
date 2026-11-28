import fs from 'fs'
import net from 'net'
import path from 'path'


/**
 * 啟動測試用之假FTP伺服器，供測試連線、列舉、下載、上傳與停滯情境
 *
 * mode='normal'：實作jsftp所需之最小指令集（FEAT/SYST/USER/PASS/TYPE/STAT/MLST/SIZE/PASV/RETR/STOR/RNFR/RNTO/DELE/CWD/PWD/MKD/QUIT），以fdRoot為根目錄；STOR於收到指令時即建立(截斷)目標檔並隨數據逐段寫入(比照真實伺服器，中斷時留下部分內容)；控制連線關閉時一併關閉該工作階段之數據連線
 * mode='stall'：僅回應登入，其後所有指令停滯不回應，且收到FIN不回關（allowHalfOpen），重現測站FTP停滯致行程無法退出之情境
 *
 * @param {Object} opt 輸入設定物件
 * @param {String} [opt.mode='normal'] 輸入模式字串，'normal'或'stall'，預設'normal'
 * @param {String} [opt.fdRoot='.'] 輸入伺服器根目錄字串，客戶端所見路徑皆相對於此資料夾，stall模式不使用
 * @param {String} [opt.username='u1'] 輸入允許登入之帳號字串，預設'u1'
 * @param {String} [opt.password='p1'] 輸入允許登入之密碼字串，預設'p1'
 * @param {Integer} [opt.port=0] 輸入監聽port正整數，預設0代表由系統指派可用port
 * @param {Object} [opt.hooks={}] 輸入測試用之攔截函數物件，未給之鍵行為同原版，預設{}
 * @param {Function} [opt.hooks.SIZE] 輸入SIZE攔截函數，收到{ reply, size }：reply(text)回應控制連線一行，size為實際大小；供模擬SIZE指令失敗(如550)之伺服器
 * @param {Function} [opt.hooks.RETR] 輸入RETR攔截函數(可為async)，收到{ data, reply, waitDs, closeDsrv }：data為檔案內容Buffer，reply(text)回應控制連線一行，waitDs()等待數據連線，closeDsrv()關閉數據伺服器；供模擬傳一半即正常關閉、停滯、425等情境
 * @param {Function} [opt.hooks.STOR] 輸入STOR攔截函數(可為async)，收到{ path, fp, reply, waitDs, closeDsrv, store, destroy }：fp為實體路徑，store()依原版接收並寫入，destroy()銷毀控制連線；供模擬停滯、只收部分、426、552等情境
 * @param {Function} [opt.hooks.CMD] 輸入任一指令(登入指令除外)之攔截函數，收到{ cmd, arg, reply, next, destroy }；回傳true代表已接手(不再依原版處理，可延後呼叫next()依原版處理、或不呼叫模擬停滯)
 * @param {Boolean} [opt.renameOverwrite=true] 輸入RNTO於目標已存在時是否覆蓋布林值，false比照拒絕覆蓋之伺服器回553，預設true
 * @returns {Promise} 回傳Promise，resolve回傳伺服器物件，內含實際監聽port正整數、指令紀錄陣列cmds、目前控制連線數函數nControl與關閉伺服器函數close
 */
let fakeFtpServer = async (opt = {}) => {

    //mode
    let mode = opt.mode || 'normal'

    //hooks
    let hooks = opt.hooks || {}

    //fdRoot
    let fdRoot = path.resolve(opt.fdRoot || '.')

    //username
    let username = opt.username || 'u1'

    //password
    let password = opt.password || 'p1'

    //port, 0代表由系統指派可用port, 供mocha平行測試時避免衝突
    let port = opt.port || 0

    //renameOverwrite
    let renameOverwrite = opt.renameOverwrite !== false

    //cmds, 依序記錄收到之指令(PASS不記密碼), 供測試斷言
    let cmds = []

    //controls, 記錄連線中之控制socket
    let controls = new Set()

    //sockets, 記錄所有控制與數據socket, 供close時強制銷毀
    let sockets = new Set()

    //dsrvs, 記錄PASV數據伺服器, 供close時關閉
    let dsrvs = new Set()

    //resolveP, 將客戶端路徑依當前工作目錄轉為根目錄內實體路徑, 並限制不可逃逸至根目錄外
    let resolveP = (cwd, p) => {
        return path.resolve(fdRoot, '.' + path.posix.resolve(cwd, p || '.'))
    }

    //lsLines, 產生unix格式列表行, 供STAT回應, 行首空格為FTP多行回應之延續行格式
    let lsLines = (rp) => {
        return fs.readdirSync(rp).map((name) => {
            let st = fs.statSync(path.join(rp, name))
            let mark = st.isDirectory() ? 'd' : '-'
            return ` ${mark}rw-r--r-- 1 ftp ftp ${st.size} Jan 01 00:00 ${name}`
        })
    }

    //waitDs, 等待PASV數據連線建立
    let waitDs = (state) => {
        return new Promise((resolve) => {
            if (state.ds !== null) {
                resolve(state.ds)
                return
            }
            state.onDs = resolve
        })
    }

    //closeDsrv, 傳輸完成後關閉數據伺服器
    let closeDsrv = (state) => {
        if (state.dsrv !== null) {
            state.dsrv.close()
            dsrvs.delete(state.dsrv)
            state.dsrv = null
        }
        state.ds = null
    }

    //handleCmdStall, 停滯模式: 僅回應登入, 其後指令(含quit)一律不回應
    let handleCmdStall = (socket, state, line) => {
        let cmd = line.split(' ')[0].toUpperCase()
        if (cmd === 'USER') {
            socket.write('331 password required\r\n')
        }
        else if (cmd === 'PASS') {
            socket.write('230 logged in\r\n')
        }
    }

    //store, STOR之原版處理: 收到指令即建立(截斷)檔案, 隨數據逐段寫入, 數據連線關閉後回226
    let store = async (socket, state, rp) => {
        let fd = null
        try {
            fd = fs.openSync(rp, 'w')
        }
        catch (err) {
            socket.write('553 could not create file\r\n')
            if (state.ds !== null) {
                state.ds.destroy()
            }
            closeDsrv(state)
            return
        }
        socket.write('150 ok to send data\r\n')
        let ds = await waitDs(state)
        ds.on('data', (d) => {
            fs.writeSync(fd, d)
        })
        ds.once('close', () => {
            fs.closeSync(fd)
            socket.write('226 transfer complete\r\n') //數據socket關閉後須回最終回應, 完成jsftp之指令佇列
            closeDsrv(state)
        })
        ds.resume()
    }

    //handleCmdNormal
    let handleCmdNormal = async (socket, state, line) => {
        let cmd = line.split(' ')[0].toUpperCase()
        let arg = line.slice(cmd.length + 1)
        cmds.push(cmd === 'PASS' ? 'PASS' : line)
        if (typeof hooks.CMD === 'function' && cmd !== 'USER' && cmd !== 'PASS') {
            let taken = hooks.CMD({
                cmd,
                arg,
                reply: (text) => socket.write(`${text}\r\n`),
                next: () => handleCmdDefault(socket, state, cmd, arg),
                destroy: () => socket.destroy(),
            })
            if (taken === true) {
                return
            }
        }
        await handleCmdDefault(socket, state, cmd, arg)
    }

    //handleCmdDefault
    let handleCmdDefault = async (socket, state, cmd, arg) => {
        if (cmd === 'FEAT') {
            socket.write('211-Features:\r\n MLST\r\n SIZE\r\n211 End\r\n')
        }
        else if (cmd === 'SYST') {
            socket.write('215 UNIX Type: L8\r\n')
        }
        else if (cmd === 'USER') {
            state.user = arg
            socket.write('331 password required\r\n')
        }
        else if (cmd === 'PASS') {
            if (state.user === username && arg === password) {
                state.authed = true
                socket.write('230 logged in\r\n')
            }
            else {
                socket.write('530 login incorrect\r\n')
            }
        }
        else if (cmd === 'TYPE') {
            socket.write('200 ok\r\n')
        }
        else if (!state.authed) {
            //未登入不得執行後續指令, 比照真實伺服器行為
            socket.write('530 not logged in\r\n')
        }
        else if (cmd === 'PWD') {
            socket.write('257 "/" is current directory\r\n')
        }
        else if (cmd === 'CWD') {
            state.cwd = path.posix.resolve(state.cwd, arg)
            socket.write('250 ok\r\n')
        }
        else if (cmd === 'MKD') {
            fs.mkdirSync(resolveP(state.cwd, arg), { recursive: true })
            socket.write(`257 "${arg}" created\r\n`)
        }
        else if (cmd === 'STAT') {
            let rp = resolveP(state.cwd, arg)
            if (!fs.existsSync(rp)) {
                socket.write('450 no such file or directory\r\n')
                return
            }
            let st = fs.statSync(rp)
            let lines
            if (st.isDirectory()) {
                lines = lsLines(rp)
            }
            else {
                let name = path.posix.basename(path.posix.resolve('/', arg))
                lines = [` -rw-r--r-- 1 ftp ftp ${st.size} Jan 01 00:00 ${name}`]
            }
            socket.write(`211-Status of ${arg}\r\n${lines.map((l) => l + '\r\n').join('')}211 End\r\n`)
        }
        else if (cmd === 'MLST') {
            let rp = resolveP(state.cwd, arg)
            if (!fs.existsSync(rp)) {
                socket.write('550 no such file or directory\r\n')
                return
            }
            let type = fs.statSync(rp).isDirectory() ? 'dir' : 'file'
            socket.write(`250-Listing ${arg}\r\n type=${type};modify=20240101000000.000; ${arg}\r\n250 End\r\n`)
        }
        else if (cmd === 'SIZE') {
            let rp = resolveP(state.cwd, arg)
            if (!fs.existsSync(rp) || fs.statSync(rp).isDirectory()) {
                socket.write('550 not a regular file\r\n')
                return
            }
            if (typeof hooks.SIZE === 'function') {
                hooks.SIZE({ reply: (text) => socket.write(`${text}\r\n`), size: fs.statSync(rp).size })
                return
            }
            socket.write(`213 ${fs.statSync(rp).size}\r\n`)
        }
        else if (cmd === 'PASV') {
            state.ds = null
            let dsrv = net.createServer((ds) => {
                sockets.add(ds)
                ds.on('error', () => {})
                ds.on('close', () => {
                    sockets.delete(ds)
                })
                state.ds = ds
                if (state.onDs !== null) {
                    let f = state.onDs
                    state.onDs = null
                    f(ds)
                }
            })
            dsrvs.add(dsrv)
            state.dsrv = dsrv
            await new Promise((resolve) => {
                dsrv.listen(0, '127.0.0.1', resolve)
            })
            let p = dsrv.address().port
            socket.write(`227 Entering Passive Mode (127,0,0,1,${Math.floor(p / 256)},${p % 256})\r\n`)
        }
        else if (cmd === 'RETR') {
            let rp = resolveP(state.cwd, arg)
            if (!fs.existsSync(rp) || fs.statSync(rp).isDirectory()) {
                socket.write('550 no such file\r\n')
                return
            }
            if (typeof hooks.RETR === 'function') {
                await hooks.RETR({
                    data: fs.readFileSync(rp),
                    reply: (text) => {
                        socket.write(`${text}\r\n`)
                    },
                    waitDs: () => waitDs(state),
                    closeDsrv: () => closeDsrv(state),
                })
                return
            }
            socket.write('150 opening data connection\r\n')
            let ds = await waitDs(state)
            ds.once('close', () => {
                socket.write('226 transfer complete\r\n') //數據socket關閉後須回最終回應, 完成jsftp之指令佇列
                closeDsrv(state)
            })
            ds.end(fs.readFileSync(rp))
        }
        else if (cmd === 'STOR') {
            let rp = resolveP(state.cwd, arg)
            if (typeof hooks.STOR === 'function') {
                await hooks.STOR({
                    path: arg,
                    fp: rp,
                    reply: (text) => {
                        socket.write(`${text}\r\n`)
                    },
                    waitDs: () => waitDs(state),
                    closeDsrv: () => closeDsrv(state),
                    store: () => store(socket, state, rp),
                    destroy: () => socket.destroy(),
                })
                return
            }
            await store(socket, state, rp)
        }
        else if (cmd === 'RNFR') {
            let rp = resolveP(state.cwd, arg)
            if (!fs.existsSync(rp)) {
                socket.write('550 no such file or directory\r\n')
                return
            }
            state.rnfr = rp
            socket.write('350 ready for destination name\r\n')
        }
        else if (cmd === 'RNTO') {
            let rp = resolveP(state.cwd, arg)
            let from = state.rnfr
            state.rnfr = null
            if (from === null) {
                socket.write('503 bad sequence of commands\r\n')
                return
            }
            if (!renameOverwrite && fs.existsSync(rp)) {
                socket.write('553 file exists\r\n')
                return
            }
            try {
                fs.renameSync(from, rp)
                socket.write('250 renamed\r\n')
            }
            catch (err) {
                socket.write('550 rename failed\r\n')
            }
        }
        else if (cmd === 'DELE') {
            try {
                fs.unlinkSync(resolveP(state.cwd, arg))
                socket.write('250 deleted\r\n')
            }
            catch (err) {
                socket.write('550 delete failed\r\n')
            }
        }
        else if (cmd === 'QUIT') {
            socket.write('221 goodbye\r\n')
            socket.end()
        }
        else {
            socket.write('502 command not implemented\r\n')
        }
    }

    //srv, stall模式使用allowHalfOpen, 收到客戶端FIN時socket維持半開不自動回關
    let srv = net.createServer({ allowHalfOpen: mode === 'stall' }, (socket) => {
        sockets.add(socket)
        controls.add(socket)
        socket.on('error', () => {}) //須catch, 避免客戶端斷線時拋出例外造成程序中止
        let state = { cwd: '/', user: '', authed: false, ds: null, dsrv: null, onDs: null, buf: '', rnfr: null }
        socket.on('close', () => {
            sockets.delete(socket)
            controls.delete(socket)
            if (mode !== 'stall') { //控制連線關閉即結束工作階段, 關閉其數據連線
                if (state.ds !== null) {
                    state.ds.destroy()
                }
                closeDsrv(state)
            }
        })
        socket.on('data', (d) => {
            state.buf += d.toString()
            let i
            while ((i = state.buf.indexOf('\r\n')) >= 0) {
                let line = state.buf.slice(0, i)
                state.buf = state.buf.slice(i + 2)
                if (mode === 'stall') {
                    handleCmdStall(socket, state, line)
                }
                else {
                    handleCmdNormal(socket, state, line)
                        .catch(() => {})
                }
            }
        })
        socket.write('220 fake ftp server ready\r\n')
    })

    //listen
    await new Promise((resolve) => {
        srv.listen(port, '127.0.0.1', resolve)
    })

    //close, 強制銷毀殘留socket(stall模式之半開socket不銷毀會使mocha無法結束)
    let close = async () => {
        for (let s of sockets) {
            s.destroy()
        }
        for (let d of dsrvs) {
            d.close()
        }
        return new Promise((resolve) => {
            srv.close(resolve)
        })
    }

    return {
        port: srv.address().port,
        cmds,
        nControl: () => controls.size,
        close,
    }
}


export default fakeFtpServer
