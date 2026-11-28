import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import last from 'lodash-es/last.js'
import map from 'lodash-es/map.js'
import genPm from 'wsemi/src/genPm.mjs'
import cint from 'wsemi/src/cint.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import getFileName from 'wsemi/src/getFileName.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import ot from 'dayjs'
import SFTPClient from 'ssh2-sftp-client'
import sepTreeFolders from './sepTreeFolders.mjs'
import ftpSyncToLocal from './ftpSyncToLocal.mjs'
import ftpSyncToRemote from './ftpSyncToRemote.mjs'
import downloadViaTemp from './downloadViaTemp.mjs'
import uploadViaTemp from './uploadViaTemp.mjs'
import connKeeper from './connKeeper.mjs'


//msgNotFolder, cwd之目標不存在或非資料夾時之固定訊息
let msgNotFolder = `ftpCwd: can not change the working directory, fpRemote is not a folder`


function CoreSFTP(opt = {}) {

    //hostname
    let hostname = get(opt, 'hostname')
    if (!isestr(hostname)) {
        throw new Error(`hostname[${hostname}] is not an effective string`)
    }

    //port
    let port = get(opt, 'port')
    if (!ispint(port)) {
        // throw new Error(`port[${port}] is not a positive integer`)
        port = 22
    }
    port = cint(port)

    //username
    let username = get(opt, 'username')
    if (!isestr(username)) {
        throw new Error(`username[${username}] is not an effective string`)
    }

    //password
    let password = get(opt, 'password')
    if (!isestr(password)) {
        throw new Error(`password[${password}] is not an effective string`)
    }

    //timeLimit
    let timeLimit = get(opt, 'timeLimit')
    if (!isnum(timeLimit)) {
        timeLimit = 1 * 60 * 1000 //1min, 預設60000毫秒; 下載與上傳(含SFTP)自傳輸開始起計此時間, 大檔須自行給較大值
    }
    timeLimit = cint(timeLimit)
    if (!(timeLimit > 0)) {
        timeLimit = 1 * 60 * 1000 //0與負數視為未給(setTimeout會把它當作1毫秒而使操作立即逾時, SFTP下載與上傳皆受timeLimit約束), 改用預設
    }

    //fdDownloadTemp, 實例層級之下載暫存區, 非空字串才採用, 否則用預設, 於建構時轉絕對路徑
    let fdDownloadTemp = downloadViaTemp.resolveFdTemp(get(opt, 'fdDownloadTemp'), downloadViaTemp.fdTempDefault)


    //cwdNow, 使用者以cwd設定之工作資料夾(伺服器端絕對路徑); SFTP協定無工作資料夾, 由本套件保存並解析相對路徑, 未設定為null(相對路徑交伺服器以登入資料夾解析)
    let cwdNow = null


    //rp, 以工作資料夾解析遠端路徑, 絕對路徑與未曾cwd者原樣; 只串接而不作字面正規化('..'交伺服器解析, 免與符號連結之實際解析不同)
    function rp(p) {
        if (cwdNow === null || !isestr(p) || p.startsWith('/')) {
            return p
        }
        let s = p.replace(/^(\.(\/|$))+/, '') //去除開頭之'./'
        if (s === '') {
            return cwdNow
        }
        return `${cwdNow.replace(/\/+$/, '')}/${s}`
    }


    //rpFile, 解析上傳目標: 檔名部分為空、'.'或'..'者原樣交上傳流程拒絕(正規化會改變其意義)
    function rpFile(p) {
        let name = p.slice(p.lastIndexOf('/') + 1)
        if (name === '' || name === '.' || name === '..') {
            return p
        }
        return rp(p)
    }


    //sftpConnect, 以本實例之設定連線(conn與重新連線共用)
    function sftpConnect(client) {
        return client.connect({
            host: hostname, //hostname or ip
            port, // defaults to 22
            username,
            password,
            // forceIPv4: false, // boolean (optional) Only connect via IPv4 address
            // forceIPv6: false, // boolean (optional) Only connect via IPv6 address
            // agent: process.env.SSH_AGENT, // string - Path to ssh-agent's UNIX socket
            // privateKey: fs.readFileSync('/path/to/key'), // Buffer or string that contains
            // passphrase: 'a pass phrase', // string - For an encrypted private key
            // readyTimeout: 20000, // integer How long (in ms) to wait for the SSH handshake
            // strictVendor: true, // boolean - Performs a strict server vendor check
            // debug: myDebug,// function - Set this to a function that receives a single, string argument to get detailed (local) debug information.
            // debug: (msg) => {
            //     console.log('debug', msg)
            // },
            // retries: 2, // integer. Number of times to retry connecting //ssh2-sftp-client 12.0.0以上版本已刪除retry功能
            // retry_factor: 2, // integer. Time factor used to calculate time between retries //ssh2-sftp-client 12.0.0以上版本已刪除retry功能
            // retry_minTimeout: 2000, // integer. Minimum timeout between attempts //ssh2-sftp-client 12.0.0以上版本已刪除retry功能
        })
    }


    //sftpDestroy, 硬關閉連線(不等待伺服器回應), 之後不再送出任何資料; 進行中之指令由ssh2以錯誤結束
    function sftpDestroy(client) {
        try {
            client.endCalled = true //本套件主動關閉, 比照end()使ssh2-sftp-client不輸出全域監聽訊息
            client.sftp = undefined //其後經此物件之指令立即以未連線結束(不再送往已關閉之連線)
            client.client.destroy()
            let sock = get(client, ['client', '_sock'])
            if (sock) {
                sock.destroy() //quit(end)後socket已不可寫, ssh2之destroy不作用, 對端不回FIN時socket殘留使行程無法退出
            }
        }
        catch (err) {}
    }


    //openLink, 建立一條新連線(conn與重新連線共用)
    function openLink() {

        //client, 全域監聽改為不輸出(ssh2-sftp-client預設把伺服器斷線與錯誤原文寫至console), 連線狀態由本套件監看
        let client = new SFTPClient('sftp', { error: () => {}, end: () => {}, close: () => {} })

        let link = connKeeper.genLink(client, sftpDestroy)
        client.client.on('error', (err) => link.markDead(connKeeper.codeOfConn(err)))
        client.client.on('end', () => link.markDead('CLOSED'))
        client.client.on('close', () => link.markDead('CLOSED'))

        link.setReady(sftpConnect(client)
            .then(() => {
                client.sftp.once('close', () => link.markDead('CLOSED')) //僅sftp子系統通道關閉者亦視為連線中斷
            }, (err) => {
                return Promise.reject(connKeeper.codeOfConn(err))
            }))

        return link
    }


    //keeper, 本套件主動銷毀(逾時、上傳中止)之連線於下一個操作自動重新連線; 伺服器斷線者(原版即不自動重連)須再conn
    let keeper = connKeeper({
        open: openLink,
        canReconnect: (link) => link.dropped,
        timeLimit,
    })


    //mapErr, 連線已中斷者一律回固定訊息, 其餘(伺服器之回應)沿用原錯誤
    function mapErr(err, link, op) {
        if (link.dead || !link.client.sftp) {
            link.markDead('CLOSED')
            return connKeeper.msgClosed(op, link.code)
        }
        return err
    }


    //req, 於連線link執行請求run(client), 以timeLimit計時(到時銷毀該連線)
    function req(link, run, op, stage, trace) {
        return connKeeper.reqLink(link, run, { op, timeLimit, msgTimeout: `${op} timeout[${timeLimit}]`, stage, trace, mapErr })
    }


    async function ftpConn(optCall = {}) {
        cwdNow = null
        return keeper.connect(downloadViaTemp.traceOf(optCall))
    }


    //sftpMkdirp, 逐層建立資料夾fd(已存在者略過): 相對路徑以伺服器之登入資料夾轉為絕對路徑(空段與'.'段略去)
    //  (ssh2-sftp-client把'.'起首者一律當'./'改寫, 且根目錄為'/'時得'//a/b', 於Windows解析成網路路徑而無限遞迴);
    //  含'..'者不作字面正規化(伺服器可能經符號連結解析), 且該函式庫之遞迴建立無法處理, 改依序逐層查詢(跟隨連結)與建立
    async function sftpMkdirp(client, fd, active = () => true) {
        if (!fd.startsWith('/')) {
            fd = `${await client.realPath('.')}/${fd}`
        }
        let ss = fd.split('/').filter((v) => v !== '' && v !== '.')
        if (!active() || ss.length === 0) {
            return
        }
        if (ss.indexOf('..') < 0) {
            await client.mkdir(`/${ss.join('/')}`, true)
            return
        }
        for (let p of sepTreeFolders(`/${ss.join('/')}/x`)) {
            let st = await client.stat(p)
                .catch((err) => {
                    if (get(err, 'code') === 'ENOENT') {
                        return null
                    }
                    throw err
                })
            if (!active()) {
                return
            }
            if (st === null) {
                await client.mkdir(p, false)
            }
        }
    }


    async function ftpLs(fdRemote = '.', optCall = {}) {

        //acquire
        let trace = downloadViaTemp.traceOf(optCall)
        let link = await keeper.acquire('ftpLs', trace)

        //list
        let res = await req(link, (client) => client.list(rp(fdRemote)), 'ftpLs', 'ls', trace)

        //add
        res = map(res, (v) => {
            // console.log('v', v)
            let d
            d = ot(v.accessTime)
            v.atime = d.format('YYYY-MM-DDTHH:mm:ssZ') //添加UTC存取時間, 為UTC不須再轉
            d = ot(v.modifyTime)
            v.mtime = d.format('YYYY-MM-DDTHH:mm:ssZ') //添加UTC修改時間, 為UTC不須再轉
            v.isFolder = ftpIsFolderCore(v)
            return v
        })

        return res
    }


    async function ftpQuit(optCall = {}) {

        //check
        let link = keeper.current()
        if (link === null) {
            return Promise.reject(connKeeper.msgNotInit)
        }

        //clear, 其後之操作視為未連線; 進行中之重新連線一併取消
        keeper.clearIf(link)
        keeper.cancelPending(link)

        //check, 已中斷之連線僅清理
        if (link.dead) {
            link.destroy()
            return 'ok'
        }

        //pm
        let pm = genPm()
        let trace = downloadViaTemp.traceOf(optCall)

        //timeLimit, 伺服器不關閉連線時到時硬關閉
        let t = setTimeout(() => {
            if (trace) {
                trace('timeout', { timeLimit, stage: 'quit' })
            }
            pm.reject(`ftpQuit timeout[${timeLimit}]`)
            link.destroy('TIMEOUT')
        }, Math.min(timeLimit, downloadViaTemp.msTimerMax))

        //end, 待連線關閉
        new Promise((resolve) => {
            resolve(link.client.end())
        })
            .then(() => {
                clearTimeout(t)
                link.destroy()
                pm.resolve('ok')
            }, (err) => {
                clearTimeout(t)
                link.destroy()
                pm.reject(connKeeper.msgClosed('ftpQuit', connKeeper.codeOfConn(err)))
            })

        return pm
    }


    async function ftpMkdir(fpRemote, optCall = {}) {
        //輸入為檔案路徑, 會解析出父資料夾並進行逐層創建

        //sepTreeFolders
        let sstf = sepTreeFolders(fpRemote)
        // console.log('sstf', sstf)

        //若有多層資料夾才mkdir
        if (size(sstf) >= 1) {

            //last
            let sl = last(sstf)
            // console.log('sl', sl)

            let trace = downloadViaTemp.traceOf(optCall)
            let link = await keeper.acquire('ftpMkdir', trace)
            await req(link, (client) => sftpMkdirp(client, rp(sl)), 'ftpMkdir', 'mkdir', trace)

        }

        return 'ok'
    }


    // async function ftpMlst(fpRemote) {
    //     return ftpRaw('mlst', fpRemote)
    // }


    // async function ftpSize(fpRemote) {
    //     return ftpRaw('size', fpRemote)
    // }


    async function ftpCwd(fpRemote, optCall = {}) {

        //check
        if (keeper.current() === null) {
            return Promise.reject(connKeeper.msgNotInit)
        }
        if (!isestr(fpRemote)) {
            return Promise.reject(`ftpCwd: fpRemote is not an effective string`)
        }

        let trace = downloadViaTemp.traceOf(optCall)
        let link = await keeper.acquire('ftpCwd', trace)

        //fd, 目標存在且為資料夾才回其絕對路徑, 否則null
        let fd = await req(link, async (client) => {
            let p = await client.realPath(rp(fpRemote))
            if (!isestr(p)) {
                return null
            }
            let st = await client.stat(p)
                .catch((err) => {
                    if (get(err, 'code') === 'ENOENT') {
                        return null
                    }
                    throw err
                })
            return get(st, 'isDirectory') === true ? p : null
        }, 'ftpCwd', 'cwd', trace)

        if (fd === null) {
            return Promise.reject(msgNotFolder)
        }
        //check, 回覆前已另行conn或quit: 本次切換不屬於目前連線, 不記錄亦不回成功
        if (keeper.current() !== link) {
            return Promise.reject(connKeeper.msgClosed('ftpCwd', 'REPLACED'))
        }
        cwdNow = fd

        return fd
    }


    async function ftpPwd(optCall = {}) {
        let trace = downloadViaTemp.traceOf(optCall)
        let link = await keeper.acquire('ftpPwd', trace)
        if (cwdNow !== null) {
            return cwdNow
        }
        return req(link, (client) => client.realPath('.'), 'ftpPwd', 'pwd', trace)
    }


    //statOn, 於連線link查詢遠端檔案資訊: 伺服器回應之錯誤回{ err }, 連線中斷與逾時reject; limit為null時不計時(由呼叫端計時)
    async function statOn(link, fp, name, { op, limit, trace = null }) {

        //stat
        let file = null
        await connKeeper.reqLink(link, (client) => client.stat(fp), { op, timeLimit: limit, msgTimeout: `${op} timeout[${limit}]`, stage: 'stat', trace, mapErr })
            .then((res) => {
                // console.log('Ftp.stat then', res)
                // mode: 33279, // integer representing type and permissions
                // uid: 1000, // user ID
                // gid: 985, // group ID
                // size: 5, // file size
                // accessTime: 1566868566000, // Last access time. milliseconds
                // modifyTime: 1566868566000, // last modify time. milliseconds
                // isDirectory: false, // true if object is a directory
                // isFile: true, // true if object is a file
                // isBlockDevice: false, // true if object is a block device
                // isCharacterDevice: false, // true if object is a character device
                // isSymbolicLink: false, // true if object is a symbolic link
                // isFIFO: false, // true if object is a FIFO
                // isSocket: false // true if object is a socket
                let d
                d = ot(res.accessTime)
                let atime = d.format('YYYY-MM-DDTHH:mm:ssZ') //添加UTC存取時間, 為UTC不須再轉
                d = ot(res.modifyTime)
                let mtime = d.format('YYYY-MM-DDTHH:mm:ssZ') //添加UTC修改時間, 為UTC不須再轉
                file = {
                    ...res,
                    atime,
                    mtime,
                    name,
                }
            })
            .catch((err) => {
                // console.log('Ftp.stat catch', err)
                if (typeof err === 'string') { //本套件之固定訊息(連線中斷、逾時)
                    return Promise.reject(err)
                }
                file = {
                    err: err.toString(),
                }
            })
        // console.log('file', file)

        return file
    }


    async function ftpStateTar(fpRemote, optCall = {}) {
        let trace = downloadViaTemp.traceOf(optCall)
        let link = await keeper.acquire('ftpStat', trace)
        return statOn(link, rp(fpRemote), fpRemote, { op: 'ftpStat', limit: timeLimit, trace })
    }


    function ftpIsFolderCore(fd) {

        //check
        if (!iseobj(fd)) {
            return false
        }

        //b
        let b

        //isDirectory
        b = get(fd, 'isDirectory', null) === true
        if (b) {
            return b
        }

        //type
        let type = get(fd, 'type', '')
        b = type === 'd'
        if (b) {
            return b
        }

        return false
    }


    async function ftpIsFolder(fpRemote, optCall = {}) {

        //ftpStateTar
        let fd = await ftpStateTar(fpRemote, optCall)

        //ftpIsFolderCore
        let b = ftpIsFolderCore(fd)

        return b
    }


    function ftpIsFileCore(file) {

        //check
        if (!iseobj(file)) {
            return false
        }

        //b
        let b

        //isFile
        b = get(file, 'isFile', null) === true
        if (b) {
            return b
        }

        //type
        let type = get(file, 'type', '')
        b = type === '-'
        if (b) {
            return b
        }

        return b
    }


    async function ftpIsFile(fpRemote, optCall = {}) {

        //ftpStateTar
        let file = await ftpStateTar(fpRemote, optCall)

        //ftpIsFileCore
        let b = ftpIsFileCore(file)

        return b
    }


    //sftpPutFile, 以ssh2之open、write、close並行寫入遠端檔(取代fastPut: fastPut於本機檔傳輸中被截短時無限迴圈, 連線關閉時不回呼):
    //  本機以串流讀至檔尾(傳輸中被改短即提早結束, 由大小核對判定), 未回應之寫入至多nParallel個; 失敗、中止(active()為false)或連線關閉後不再送出寫入
    function sftpPutFile(client, fpLocal, fpRemote, active, onSent) {
        let nParallel = 64
        return new Promise((resolve, reject) => {
            let sftp = client.sftp
            if (!sftp) {
                reject(new Error('No SFTP connection available'))
                return
            }
            let handle = null
            let reader = null
            let pos = 0
            let sent = 0
            let nWait = 0
            let ended = false
            let done = false

            //onClose, 連線於傳輸中關閉(如quit、伺服器斷線或逾時銷毀)時結束, 先讓待回應之指令以其錯誤結束
            let onClose = () => {
                setImmediate(() => {
                    finish(new Error('connection closed during transfer'))
                })
            }

            let finish = (err) => {
                if (done) {
                    return
                }
                done = true
                client.client.removeListener('close', onClose)
                if (reader !== null) {
                    reader.destroy()
                }
                if (err) {
                    if (handle !== null) {
                        sftp.close(handle, () => {}) //盡力關閉遠端檔, 不等待回應
                    }
                    reject(err)
                }
                else {
                    resolve()
                }
            }

            let tryClose = () => {
                if (done || !ended || nWait > 0 || handle === null) { //handle為null表關閉指令已送出
                    return
                }
                let h = handle
                handle = null
                sftp.close(h, (err) => {
                    finish(err || null)
                })
            }

            client.client.once('close', onClose)

            sftp.open(fpRemote, 'w', (errOpen, h) => {
                if (errOpen) {
                    finish(errOpen)
                    return
                }
                handle = h
                if (done || !active()) {
                    sftp.close(h, () => {})
                    handle = null
                    finish(new Error('upload is stopped'))
                    return
                }
                reader = fs.createReadStream(fpLocal, { highWaterMark: 32768 })
                reader.on('data', (chunk) => {
                    if (done || !active()) {
                        finish(new Error('upload is stopped'))
                        return
                    }
                    let at = pos
                    pos += chunk.length
                    nWait++
                    if (nWait >= nParallel) {
                        reader.pause()
                    }
                    sftp.write(handle, chunk, 0, chunk.length, at, (errWrite) => {
                        nWait--
                        if (done) {
                            return
                        }
                        if (errWrite) {
                            finish(errWrite)
                            return
                        }
                        sent += chunk.length
                        onSent(sent)
                        if (nWait < nParallel && !ended) {
                            reader.resume()
                        }
                        tryClose()
                    })
                })
                reader.on('end', () => {
                    ended = true
                    tryClose()
                })
                reader.on('error', (errRead) => {
                    finish(errRead)
                })
            })

        })
    }


    async function ftpDownload(fpRemote, fpLocal, cbProcess = null, optCall = {}) {

        //pm
        let pm = genPm()

        //check
        if (keeper.current() === null) {
            pm.reject(connKeeper.msgNotInit)
            return pm
        }

        //fpRemote
        if (!isestr(fpRemote)) {
            pm.reject(`fpRemote[${fpRemote}] is not an effective string`)
            return pm
        }

        //fpLocal
        if (!isestr(fpLocal)) {
            pm.reject(`fpLocal[${fpLocal}] is not an effective string`)
            return pm
        }

        //fdLocal
        let fdLocal = path.dirname(fpLocal)
        // console.log('fdLocal', fdLocal)

        //check fdLocal
        if (!fsIsFolder(fdLocal)) {
            fsCreateFolder(fdLocal)
        }

        //fpTarget, 於呼叫時以工作資料夾解析, 其後cwd不影響本次下載
        let fpTarget = rp(fpRemote)

        //link, 本次下載固定使用此連線
        let link = null
        let errConn = null
        await keeper.acquire('ftpDownload', downloadViaTemp.traceOf(optCall))
            .then((v) => {
                link = v
            }, (err) => {
                errConn = err
            })
        if (errConn !== null) {
            pm.reject(errConn)
            return pm
        }

        //statOn, 加計時: 伺服器於查詢遠端檔案資訊時停滯, 亦依timeLimit逾時(否則永不結束), 到時銷毀本次所用之連線
        let errStat = null
        let file = await downloadViaTemp.withTimeLimit({
            run: () => statOn(link, fpTarget, fpRemote, { op: 'ftpDownload', limit: null }),
            timeLimit,
            stage: 'stat',
            optCall,
            onTimeout: () => link.destroy('TIMEOUT'),
        })
            .catch((err) => {
                errStat = err
            })
        // console.log('file', file)

        //check
        if (errStat !== null) {
            pm.reject(errStat)
            return pm
        }

        //check, 查詢期間已quit
        if (keeper.current() === null) {
            pm.reject(connKeeper.msgNotInit)
            return pm
        }

        //ftpIsFileCore
        let b = ftpIsFileCore(file)
        // console.log('b', b)

        //check
        if (!b) {
            pm.reject(`fpRemote[${fpRemote}] is not a file`)
            return pm
        }

        //check
        if (!iseobj(file)) {
            pm.reject(`fpRemote[${fpRemote}] does not have information`)
            return pm
        }

        //fileSize
        let fileSize = get(file, 'size', '')

        //check
        if (!isnum(fileSize)) {
            pm.reject(`can not get the size of file[${fpRemote}]`)
            return pm
        }
        fileSize = cint(fileSize)
        // console.log('fileSize', fileSize)

        //downloadViaTemp, 先寫入暫存區, 傳輸成功且大小相符才移至fpLocal, 舊fpLocal於此之前不動; 逾時(timeLimit)自傳輸開始起計
        return downloadViaTemp({
            fpLocal,
            fileSize,
            timeLimit,
            fdTempInst: fdDownloadTemp,
            optCall,
            transfer: (fpTemp, ctl) => {

                //逾時時銷毀本次所用之連線以中止傳輸(fastGet本身無中止介面)
                ctl.setAbort(() => {
                    link.destroy('TIMEOUT')
                })

                return new Promise((resolve, reject) => {
                    if (link.dead) {
                        reject(connKeeper.msgClosed('ftpDownload', link.code))
                        return
                    }

                    //onDead, 連線銷毀後fastGet可能永不回呼; 其自身之錯誤(伺服器斷線)先行, 沿用原錯誤
                    let off = link.onDead(() => {
                        setImmediate(() => {
                            reject(connKeeper.msgClosed('ftpDownload', link.code))
                        })
                    })

                    //fastGet, 寫入暫存檔
                    link.client.fastGet(fpTarget, fpTemp, {
                        step: (total_transferred, chunk, total) => {
                            // console.log(total_transferred, chunk, total)
                            // 32768 32768 1384928
                            // 65536 32768 1384928
                            // ...
                            // 1376256 32768 1384928
                            // 1384928 8672 1384928

                            //cbProcess, 逾時後不再通知
                            if (isfun(cbProcess) && ctl.active()) {
                                let r = total_transferred / total * 100
                                // console.log(`receving... ${dig((r), 1)}%`)
                                cbProcess({
                                    progress: r,
                                    name: getFileName(fpLocal),
                                    fpRemote,
                                    fpLocal,
                                })
                            }

                        },
                    })
                        .then((v) => {
                            off()
                            resolve(v)
                        }, (err) => {
                            off()
                            reject(err)
                        })

                })

            },
        })
    }


    //genUploadAdapter, 上傳流程(uploadViaTemp)之SFTP操作, 固定使用本次上傳開始時之連線; 逾時時銷毀該連線並重新連線
    //  fpTarget為以工作資料夾解析後之遠端目標, fpRemote為使用者傳入值(供進度回呼)
    function genUploadAdapter(linkStart, fpLocal, fpRemote, fpTarget, fileSize, cbProcess, emit) {
        let link = linkStart
        let dead = false
        let cancel = null //取消本次重新連線嘗試

        //isFile
        let isFile = async (fp) => {
            try {
                let st = await link.client.stat(fp)
                return get(st, 'isFile') === true
            }
            catch (err) {
                return false
            }
        }

        let adapter = {
            prepare: async (active) => {
                await adapter.reconnect()
                if (!active()) {
                    return
                }
                //目標所在資料夾存在多層時逐層創建(由ssh2-sftp-client處理)
                let i = fpTarget.lastIndexOf('/')
                let fd = i < 0 ? '' : fpTarget.slice(0, i)
                if (fd === '' || fd === '.') {
                    return
                }
                if (!link.client.sftp) { //伺服器已斷線: 以固定訊息失敗, 其後之reconnect重新連線(比照無資料夾之目標於清理時重新連線)
                    let msg = connKeeper.msgClosed('ftpUpload', link.code || 'CLOSED')
                    dead = true
                    link.destroy()
                    throw msg
                }
                await sftpMkdirp(link.client, fd, active)
            },
            put: (fpTemp, active) => {
                //sftpPutFile, 寫入遠端暫存名
                return sftpPutFile(link.client, fpLocal, fpTemp, active, (sent) => {
                    //cbProcess, 逾時後連線已銷毀、寫入不再成功而不再通知; 回調拋錯忽略
                    if (isfun(cbProcess) && fileSize > 0) {
                        let r = sent / fileSize * 100
                        // console.log(`sending... ${dig((r), 1)}%`)
                        try {
                            cbProcess({
                                progress: r,
                                name: getFileName(fpLocal),
                                fpRemote,
                                fpLocal,
                            })
                        }
                        catch (err) {}
                    }
                })
            },
            size: async (fp) => {
                let st = await link.client.stat(fp)
                if (get(st, 'isFile') !== true) {
                    throw new Error('not a file')
                }
                return st.size
            },
            isFile,
            posixRename: async (fpFrom, fpTo) => {
                //伺服器未宣告posix-rename@openssh.com擴充者回false, 由上傳流程改用rename
                if (get(link.client, ['sftp', '_extensions', 'posix-rename@openssh.com']) !== '1') {
                    return false
                }
                await link.client.posixRename(fpFrom, fpTo)
                return true
            },
            rename: (fpFrom, fpTo) => {
                return link.client.rename(fpFrom, fpTo)
            },
            remove: (fp) => {
                return link.client.delete(fp)
            },
            isAbsent: async (fp, errRemove) => {
                if (get(errRemove, 'code') === 2) { //SSH_FX_NO_SUCH_FILE
                    return true
                }
                //以ssh2之stat判斷, 僅SSH_FX_NO_SUCH_FILE視為不存在(ssh2-sftp-client之stat把一般失敗亦報為不存在)
                let client = link.client
                return new Promise((resolve) => {
                    client.sftp.stat(fp, (err) => {
                        resolve(get(err, 'code') === 2)
                    })
                })
            },
            abort: () => {
                dead = true
                if (cancel !== null) {
                    cancel()
                    cancel = null
                }
                link.destroy()
            },
            reconnect: async () => {
                if (!dead) {
                    return
                }
                //使用者已quit者不重新連線; 已另行conn或他方已換上新連線者改用之
                let r = null
                try {
                    r = await keeper.reconnect(link, {
                        setCancel: (fn) => {
                            cancel = fn
                        },
                    })
                }
                catch (e) {
                    cancel = null
                    if (get(e, 'kind') !== 'quit') {
                        emit('reconnect', { ok: false })
                    }
                    throw connKeeper.msgOfReconnect('ftpUpload', e)
                }
                cancel = null
                if (r.reconnected) {
                    emit('reconnect', { ok: true })
                }
                link = r.link
                dead = false
            },
        }
        return adapter
    }


    async function ftpUpload(fpLocal, fpRemote, cbProcess, optCall = {}) {

        //pm
        let pm = genPm()

        //check
        if (keeper.current() === null) {
            pm.reject(connKeeper.msgNotInit)
            return pm
        }

        //fpRemote
        if (!isestr(fpRemote)) {
            pm.reject(`fpRemote[${fpRemote}] is not an effective string`)
            return pm
        }

        //fpLocal
        if (!isestr(fpLocal)) {
            pm.reject(`fpLocal[${fpLocal}] is not an effective string`)
            return pm
        }

        //check
        if (!fsIsFile(fpLocal)) {
            pm.reject(`fpLocal[${fpLocal}] is not a file`)
            return pm
        }

        //statSync
        let stat = fs.statSync(fpLocal)

        //fileSize
        let fileSize = get(stat, 'size', 0)

        //check
        if (!isnum(fileSize)) {
            pm.reject(`can not get the size of file[${fpLocal}]`)
            return pm
        }
        fileSize = cint(fileSize)
        // console.log('fileSize', fileSize)

        //fpTarget, 於呼叫時以工作資料夾解析, 其後cwd不影響本次上傳
        let fpTarget = rpFile(fpRemote)

        //link, 本套件曾銷毀(逾時)之連線於此重新連線; 伺服器斷線者原樣交上傳流程(沿用其失敗處置: 清理時中止並重新連線, 使實例其後可用)
        let link = keeper.current()
        if (!(link.dead && !link.dropped)) {
            let errConn = null
            await keeper.acquire('ftpUpload', downloadViaTemp.traceOf(optCall))
                .then((v) => {
                    link = v
                }, (err) => {
                    errConn = err
                })
            if (errConn !== null) {
                pm.reject(errConn)
                return pm
            }
        }

        //uploadViaTemp, 先寫入遠端暫存名, 傳輸成功且大小相符才改名為fpRemote, 失敗時刪除暫存、舊fpRemote不動; 各階段以timeLimit計時
        return uploadViaTemp({
            fpLocal,
            fpRemote: fpTarget,
            fileSize,
            timeLimit,
            optCall,
            genAdapter: (emit) => genUploadAdapter(link, fpLocal, fpRemote, fpTarget, fileSize, cbProcess, emit),
        })
    }


    return {
        conn: ftpConn,
        quit: ftpQuit,
        ls: ftpLs,
        isFile: ftpIsFile,
        isFolder: ftpIsFolder,
        download: ftpDownload,
        upload: ftpUpload,
        syncToLocal: async (fdRemote, fdLocal, cbProcess, opt = {}) => {
            return ftpSyncToLocal(fdRemote, fdLocal, cbProcess, { ...opt, ftpLs, ftpDownload }) //比照CoreFTP轉交opt(原版未轉交, levelLimit等皆被忽略)
        },
        syncToRemote: async (fdLocal, fdRemote, cbProcess, opt = {}) => {
            return ftpSyncToRemote(fdLocal, fdRemote, cbProcess, { ...opt, ftpLs, ftpUpload }) //比照CoreFTP轉交opt(原版未轉交)
        },
        stat: ftpStateTar,
        mkdir: ftpMkdir,
        cwd: ftpCwd,
        pwd: ftpPwd,
    }
}


export default CoreSFTP
