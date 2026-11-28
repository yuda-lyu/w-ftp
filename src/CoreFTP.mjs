import path from 'path'
import fs from 'fs'
import { Transform } from 'stream'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import genPm from 'wsemi/src/genPm.mjs'
import cint from 'wsemi/src/cint.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import sep from 'wsemi/src/sep.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import getFileName from 'wsemi/src/getFileName.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import ot from 'dayjs'
import Jsftp from 'jsftp'
import sepTreeFolders from './sepTreeFolders.mjs'
import ftpSyncToLocal from './ftpSyncToLocal.mjs'
import ftpSyncToRemote from './ftpSyncToRemote.mjs'
import downloadViaTemp from './downloadViaTemp.mjs'
import uploadViaTemp from './uploadViaTemp.mjs'
import connKeeper from './connKeeper.mjs'


function CoreFTP(opt = {}) {

    //hostname
    let hostname = get(opt, 'hostname')
    if (!isestr(hostname)) {
        throw new Error(`hostname[${hostname}] is not an effective string`)
    }

    //port
    let port = get(opt, 'port')
    if (!ispint(port)) {
        // throw new Error(`port[${port}] is not a positive integer`)
        port = 21
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
        timeLimit = 1 * 60 * 1000 //1min, 預設60000毫秒; 下載與上傳自傳輸開始起計此時間, 大檔須自行給較大值
    }
    timeLimit = cint(timeLimit)
    if (!(timeLimit > 0)) {
        timeLimit = 1 * 60 * 1000 //0與負數視為未給(setTimeout會把它當作1毫秒而使操作立即逾時), 改用預設
    }

    //fdDownloadTemp, 實例層級之下載暫存區, 非空字串才採用, 否則用預設, 於建構時轉絕對路徑
    let fdDownloadTemp = downloadViaTemp.resolveFdTemp(get(opt, 'fdDownloadTemp'), downloadViaTemp.fdTempDefault)


    //cwds, 使用者以cwd成功切換過之路徑(依序), 重新連線時重放, 使其後相對路徑指向同一資料夾
    let cwds = []


    //newJsftp, 以本實例之設定建立連線
    function newJsftp() {
        return new Jsftp({
            host: hostname, //hostname or ip
            port, // defaults to 21
            user: username,
            pass: password,
        })
    }


    //hardDestroy, jsftp的destroy對socket僅做end()軟關閉, 對端不回FIN時socket殘留使行程無法退出, 故須於destroy前先取出socket參照再硬關閉;
    //  bKeepBusy為true時(伺服器僅關閉控制連線)保留下載中之數據socket, 其完成與否由大小核對判定
    function hardDestroy(conn, bKeepBusy = false) {

        //check, 保留下載中之數據socket: 先自jsftp摘除, 其destroy亦不對之end()
        if (bKeepBusy && get(conn, ['_pasvSocket', 'wftpBusy']) === true) {
            conn._pasvSocket = undefined
        }

        //socket, destroy內會將socket與_pasvSocket設為undefined, 故須先取出參照
        let s = conn.socket
        let ps = conn._pasvSocket

        //error, 銷毀中或銷毀後之連線錯誤忽略(無監聽者時EventEmitter會拋出使程序中止)
        conn.on('error', () => {})

        //destroy
        conn.destroy()

        //destroy sockets
        if (s) {
            s.destroy()
        }
        if (ps) {
            ps.destroy()
        }

    }


    //guardExecute, 停用jsftp之隱式重連: jsftp.execute於控制socket不可寫時自行另建連線並重新登入而不重放cwd, 相對路徑即指向登入目錄;
    //  改為該指令以錯誤結束, 重新連線一律由本套件進行並重放cwd
    function guardExecute(link) {
        let client = link.client
        let execute = client.execute
        client.execute = function(action, callback) {
            if (link.dead || !this.socket || !this.socket.writable) {
                link.markDead('CLOSED')
                if (isfun(callback)) {
                    setImmediate(() => {
                        callback(new Error('connection closed'))
                    })
                }
                return
            }
            return execute.call(this, action, callback)
        }
    }


    //openLink, 建立一條新連線(conn與重新連線共用), 收到伺服器之歡迎訊息(220)才算就緒
    function openLink() {
        let client = newJsftp()
        let link = connKeeper.genLink(client, hardDestroy)
        guardExecute(link)

        //'error', 常駐監聽: 控制連線之錯誤(連不上、被重置等)無監聽者時EventEmitter拋出使行程中止
        client.on('error', (err) => {
            link.markDead(connKeeper.codeOfConn(err))
        })
        let sock = client.socket
        sock.on('end', () => {
            link.markDead('CLOSED')
        })
        sock.on('close', () => {
            link.markDead('CLOSED')
        })

        link.setReady(new Promise((resolve, reject) => {
            let onData = (res) => {
                if (res.isMark) {
                    return
                }
                client.removeListener('data', onData)
                if (res.code === 220) {
                    resolve()
                }
                else {
                    reject(String(res.code))
                }
            }
            client.on('data', onData)
            link.onDead(() => {
                reject(link.code)
            })
        }))

        return link
    }


    //isReply, 錯誤是否為伺服器之回應(code為FTP回應碼)
    function isReply(err) {
        return typeof get(err, 'code') === 'number'
    }


    //mapErr, 伺服器之回應沿用原錯誤; 控制連線中斷與數據連線錯誤回固定訊息
    function mapErr(err, link, op) {
        if (isReply(err)) {
            return err
        }
        if (link.dead) {
            return connKeeper.msgClosed(op, link.code)
        }
        if (isestr(get(err, 'code'))) {
            return connKeeper.msgFailed(op, connKeeper.codeOfConn(err))
        }
        return err
    }


    //reqOn, 於連線link執行回調式指令send(client, cb), 以limit毫秒計時(到時銷毀該連線; null不計時); onClosed為回覆前控制連線中斷之後續處置
    function reqOn(link, send, { op, limit, msgTimeout, stage, trace = null, onClosed = null }) {
        let run = (client) => {
            return new Promise((resolve, reject) => {
                send(client, (err, data) => {
                    if (err) {
                        reject(err)
                    }
                    else {
                        resolve(data)
                    }
                })
            })
        }
        return connKeeper.reqLink(link, run, { op, timeLimit: limit, msgTimeout, stage, trace, mapErr, onClosed })
    }


    //rawOn, 於連線link送出單一指令
    function rawOn(link, name, fpRemote, { op, limit = timeLimit, stage, trace = null }) {
        let send = (client, cb) => {
            client.raw(name, fpRemote, cb)
        }
        return reqOn(link, send, { op, limit, msgTimeout: `ftpRaw[${name}] timeout[${limit}]`, stage, trace })
    }


    //replay, 重新連線後依序重放成功過之cwd
    async function replay(link, limit) {
        for (let fd of [...cwds]) {
            await rawOn(link, 'cwd', fd, { op: 'ftpCwd', limit, stage: 'reconnect' })
        }
    }


    //keeper, 控制連線被伺服器關閉(閒置逾時等)或由本套件銷毀(逾時)者, 下一個操作重新連線並重放cwd
    let keeper = connKeeper({
        open: openLink,
        canReconnect: () => true,
        replay,
        timeLimit,
    })


    async function ftpConn(optCall = {}) {
        cwds = []
        return keeper.connect(downloadViaTemp.traceOf(optCall))
    }


    function ftpMsToTime(ms) {
        let mtime = ''
        if (!isnum(ms) && !isestr(ms)) {
            return mtime
        }
        try {
            // console.log('t0', ms)
            let d = ot(ms)
            let t = d.format('YYYY-MM-DDTHH:mm:ss')
            // console.log('t1', t)
            t = `${t}+00:00` //添加格林威治時間
            // console.log('t2', t)
            d = ot(t)
            mtime = d.format('YYYY-MM-DDTHH:mm:ssZ') //添加UTC時間
            // console.log('t3', mtime)
        }
        catch (err) {}
        return mtime
    }


    async function ftpLs(fdRemote = '.', optCall = {}) {

        //acquire
        let trace = downloadViaTemp.traceOf(optCall)
        let link = await keeper.acquire('ftpLs', trace)

        //ls
        let send = (client, cb) => {
            client.ls(fdRemote, cb)
        }
        //onClosed, 列舉(LIST退路)自開數據連線, 控制連線中斷時一併釋放(否則殘留至jsftp之閒置逾時, 行程無法退出)
        let onClosed = (l) => l.release()
        let res = await reqOn(link, send, { op: 'ftpLs', limit: timeLimit, msgTimeout: `ftpLs timeout[${timeLimit}]`, stage: 'ls', trace, onClosed })
            .catch((err) => {
                //有些伺服器會回傳empty string(由jsftp.js提示), 故可能無法進行ls列舉, 且其回傳: Could not retrieve a file listing for ooo
                if (get(err, 'code') === 451) {
                    return [] //視為資料夾內無任何資料夾與檔案
                }
                return Promise.reject(err)
            })

        res = map(res, (v) => {
            v.mtime = ftpMsToTime(v.time)
            v.size = cint(v.size)
            v.isFolder = ftpIsFolderCore(v)
            return v
        })

        return res
    }


    async function ftpQuit(optCall = {}) {

        //pm
        let pm = genPm()

        //check
        let link = keeper.current()
        if (link === null) {
            pm.reject(connKeeper.msgNotInit)
            return pm
        }

        //finish, 硬關閉本次欲關閉之連線, 仍為目前連線者清空(期間上傳之重新連線或另一次quit可能改變目前連線)
        let finish = (code) => {
            link.destroy(code)
            keeper.clearIf(link)
            keeper.cancelPending(link) //針對本連線之進行中重新連線一併取消
        }

        //check, 已中斷或尚未就緒之連線僅清理(不另建連線送QUIT)
        if (link.dead || !link.ready) {
            finish()
            pm.resolve('ok')
            return pm
        }

        let trace = downloadViaTemp.traceOf(optCall)
        let done = false
        let off = () => {}
        let end = (fn, v) => {
            if (done) {
                return
            }
            done = true
            clearTimeout(t)
            off()
            fn(v)
        }

        //timeLimit
        let t = setTimeout(() => {
            if (trace) {
                trace('timeout', { timeLimit, stage: 'quit' })
            }
            end(pm.reject, `ftpQuit timeout[${timeLimit}]`)
            finish('TIMEOUT')
        }, Math.min(timeLimit, downloadViaTemp.msTimerMax))

        //onDead, 伺服器未回覆QUIT即中斷連線; 本套件自行銷毀者(如另一次quit逾時)由本次計時器結束
        off = link.onDead(() => {
            if (link.dropped) {
                return
            }
            setImmediate(() => {
                end(pm.reject, connKeeper.msgClosed('ftpQuit', link.code))
                finish()
            })
        })

        link.client.raw('quit', (err, res) => {
            if (err) {
                end(pm.reject, isReply(err) ? err : connKeeper.msgClosed('ftpQuit', link.code || 'CLOSED'))
            }
            else {
                end(pm.resolve, res)
            }
            finish()
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
            let trace = downloadViaTemp.traceOf(optCall)
            let link = await keeper.acquire('ftpMkdir', trace)
            await pmSeries(sstf, async (fd) => {
                // console.log('call ftpIsFolder', fd)
                let file = await statOn(link, fd, { op: 'ftpMkdir', limit: timeLimit, stage: 'mkdir', trace })
                if (!ftpIsFolderCore(file)) {
                    // console.log('call ftpMkdirCore', fd)
                    await rawOn(link, 'mkd', fd, { op: 'ftpMkdir', stage: 'mkdir', trace })
                    // console.log('ftpMkdir', fd)
                }
            })

        }

        return 'ok'
    }


    async function ftpCwd(fpRemote, optCall = {}) {
        let trace = downloadViaTemp.traceOf(optCall)
        let link = await keeper.acquire('ftpCwd', trace)
        let r = await rawOn(link, 'cwd', fpRemote, { op: 'ftpCwd', stage: 'cwd', trace })
        //check, 回覆前已另行conn或quit: 本次切換不屬於目前連線, 不記錄亦不回成功
        if (keeper.current() !== link) {
            return Promise.reject(connKeeper.msgClosed('ftpCwd', 'REPLACED'))
        }
        //記錄成功切換之路徑, 供重新連線重放; 絕對路徑不依賴先前者, 只需記它
        if (String(fpRemote).startsWith('/')) {
            cwds = [fpRemote]
        }
        else {
            cwds.push(fpRemote)
        }
        return r
    }


    async function ftpPwd(optCall = {}) {
        let trace = downloadViaTemp.traceOf(optCall)
        let link = await keeper.acquire('ftpPwd', trace)
        return rawOn(link, 'pwd', undefined, { op: 'ftpPwd', stage: 'pwd', trace })
    }


    //statOn, 於連線link查詢遠端檔案資訊(MLST與SIZE): 伺服器回應之錯誤記入結果之err, 連線中斷與逾時reject; limit為null時不計時(由呼叫端計時)
    async function statOn(link, fpRemote, { op, limit, stage = 'stat', trace = null }) {

        //cmd, 伺服器回應之錯誤轉為{ err }
        let cmd = (name) => {
            return rawOn(link, name, fpRemote, { op, limit, stage, trace })
                .catch((err) => {
                    if (typeof err === 'string') { //本套件之固定訊息(連線中斷、逾時、數據連線錯誤)
                        return Promise.reject(err)
                    }
                    return {
                        err: err.toString(),
                    }
                })
        }

        //r
        let r = {}

        //mlst
        let rmlst = await cmd('mlst')
        // console.log('rmlst', rmlst)
        // raw mlst data => {
        //   code: 250,
        //   text: '250-Listing ./test3/test4\n' +
        //     ' type=dir;modify=20230820040522.822;perms=cplemfd; /test3/test4\n' +
        //     '250 End',
        //   isMark: false,
        //   isError: false
        // }
        // raw stat data => {
        //   code: 211,
        //   text: '211-Status of ./test/DECL_20210805055044.csv:\n' +
        //     ' -rw-rw-rw- 1 ftp ftp         1384928 Jul 20  2022 /test/DECL_20210805055044.csv\n' +
        //     '211 End',
        //   isMark: false,
        //   isError: false
        // }

        //check
        if (!iseobj(rmlst)) {
            return Promise.reject(`invalid result from ftpMlst`)
        }

        //parse rmlst
        let cft = (text) => {
            let s = sep(text, ';')
            let r = ''
            each(s, (v) => {
                if (strleft(v, 7) === 'modify=') {
                    let ss = sep(v, '=')
                    r = get(ss, 1, '')
                }
            })
            return r
        }
        if (true) {
            let text = get(rmlst, 'text', '')
            let isFolder = text.indexOf('type=dir;') >= 0
            let isFile = text.indexOf('type=file;') >= 0
            let imtime = cft(text)
            let mtime = ftpMsToTime(imtime)
            r = {
                ...r,
                rmlst,
                mtime,
                isFolder,
                isFile,
            }
        }

        //size
        let rsize = await cmd('size')
        // console.log('rsize', rsize)
        // raw size => { code: 213, text: '213 1384928', isMark: false, isError: false }
        // => 1384928

        //check
        if (!iseobj(rsize)) {
            return Promise.reject(`invalid result from ftpSize`)
        }

        //parse rsize
        if (true) {
            let code = get(rsize, 'code', '')
            let text = get(rsize, 'text', '')
            let size = text.replace(`${code} `, '')
            size = cint(size)
            r = {
                ...r,
                rsize,
                size,
            }
        }

        // console.log('ftpStateTar', r)
        return r
    }


    async function ftpStateTar(fpRemote, optCall = {}) {
        let trace = downloadViaTemp.traceOf(optCall)
        let link = await keeper.acquire('ftpStat', trace)
        return statOn(link, fpRemote, { op: 'ftpStat', limit: timeLimit, trace })
    }


    function ftpIsFolderCore(file) {

        //check
        if (!iseobj(file)) {
            return false
        }

        //b
        let b

        //isFolder
        b = get(file, 'isFolder', false)
        if (b) {
            return b
        }

        //type
        let type = get(file, 'type', -1)
        b = type === 1
        if (b) {
            return b
        }

        return b
    }


    async function ftpIsFolder(fpRemote, optCall = {}) {

        //ftpStateTar
        let fd = await ftpStateTar(fpRemote, optCall)
        // console.log('ftpIsFolder ftpStateTar', fpRemote, 'fd', fd)

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

        //isFolder
        b = get(file, 'isFile', false)
        if (b) {
            return b
        }

        //type
        let type = get(file, 'type', -1)
        b = type === 0
        if (b) {
            return b
        }

        return b

    }


    async function ftpIsFile(fpRemote, optCall = {}) {

        //ftpStateTar
        let file = await ftpStateTar(fpRemote, optCall)
        // console.log('ftpIsFile ftpStateTar', fpRemote, 'file', file)

        //ftpIsFileCore
        let b = ftpIsFileCore(file)

        return b
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

        //舊fpLocal不先刪除, 下載完成並核對後才由暫存檔取代

        //check fdLocal
        if (!fsIsFolder(fdLocal)) {
            fsCreateFolder(fdLocal)
        }

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

        //statOn, 查詢遠端檔案資訊階段以timeLimit計時, 到時銷毀本次所用之連線
        let errStat = null
        let file = await downloadViaTemp.withTimeLimit({
            run: () => statOn(link, fpRemote, { op: 'ftpDownload', limit: null }),
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

        //ftpIsFileCore
        let b = ftpIsFileCore(file)
        // console.log('b', b)

        //check
        if (!b) {
            pm.reject(`fpRemote[${fpRemote}] is not a file`)
            return pm
        }

        //check
        if (!iseobj(file) || haskey(file, 'err')) {
            pm.reject(`fpRemote[${fpRemote}] does not have information`)
            return pm
        }

        //fileSize
        let fileSize = get(file, 'size', '')

        //check, 取不到遠端大小(如SIZE指令失敗, statOn此時回size為0)即無從核對是否下載完整, 預設拒絕
        if (!isnum(fileSize) || haskey(get(file, 'rsize'), 'err')) {
            pm.reject(`can not get the size of file[${fpRemote}]`)
            return pm
        }
        fileSize = cint(fileSize)
        // console.log('fileSize', fileSize)

        //check, 查詢期間已quit
        if (keeper.current() === null) {
            pm.reject(connKeeper.msgNotInit)
            return pm
        }

        //downloadViaTemp, 先寫入暫存區, 傳輸成功且大小相符才移至fpLocal, 舊fpLocal於此之前不動; 逾時(timeLimit)自傳輸開始起計
        //  數據socket關閉不代表傳完(連線中途正常關閉或被重置時jsftp皆不回報錯誤), 故完成與否以大小核對判定
        return downloadViaTemp({
            fpLocal,
            fileSize,
            timeLimit,
            fdTempInst: fdDownloadTemp,
            optCall,
            transfer: (fpTemp, ctl) => {
                return new Promise((resolve, reject) => {

                    //socket, 數據socket
                    let socket = null

                    //setAbort, 逾時時銷毀數據socket與本次所用之控制連線(伺服器停滯時其指令佇列已不可用)
                    ctl.setAbort(() => {
                        if (socket !== null) {
                            socket.destroy()
                        }
                        link.destroy('TIMEOUT')
                    })

                    //onDead, 取得數據socket前控制連線中斷(含傳輸開始前即已中斷)即結束(jsftp不回呼進行中之指令); 取得後以數據socket與大小核對判定
                    let off = link.onDead(() => {
                        setImmediate(() => {
                            if (socket === null) {
                                reject(connKeeper.msgClosed('ftpDownload', link.code))
                                link.release() //釋放尚未交付之數據socket
                            }
                        })
                    })

                    link.client.get(fpRemote, (err, s) => {
                        off()

                        //check, 取得數據socket失敗(如425)時尚未寫入任何內容
                        if (err) {
                            reject(link.dead && !isReply(err) ? connKeeper.msgClosed('ftpDownload', link.code) : err)
                            return
                        }

                        socket = s
                        s.wftpBusy = true //下載中之數據socket, 控制連線中斷時不予釋放

                        //createWriteStream, 寫入暫存檔
                        let writer = fs.createWriteStream(fpTemp)

                        //errWriter
                        let errWriter = null

                        //數據socket之錯誤由jsftp監聽(取得socket後不再回報), 傳輸是否完整一律以大小核對判定

                        //socket data
                        let dss = 0
                        socket.on('data', (d) => {
                            // console.log('socket.on data', d)

                            //cbProcess, 逾時後不再通知
                            if (isfun(cbProcess) && ctl.active()) {
                                let ds = size(d)
                                dss += ds
                                let r = dss / fileSize * 100
                                // console.log(`receving... ${dig((r), 1)}%`)
                                cbProcess({
                                    progress: r,
                                    name: getFileName(fpLocal),
                                    fpRemote,
                                    fpLocal,
                                })
                            }

                            //write
                            if (!writer.destroyed) {
                                writer.write(d)
                            }

                        })

                        //socket close
                        socket.on('close', () => {
                            // console.log('socket close')

                            //end, 無數據時要呼叫end告知已結束
                            if (!writer.destroyed) {
                                writer.end()
                            }

                        })

                        //writer error, 寫入失敗(如磁碟已滿)時停止接收
                        writer.on('error', (e) => {
                            errWriter = e
                            socket.destroy()
                        })

                        //writer close, 檔案已關閉後才結束, 供核對大小與移動
                        writer.on('close', () => {
                            if (errWriter !== null) {
                                reject(errWriter)
                            }
                            else {
                                resolve()
                            }
                        })

                        //resume
                        socket.resume()

                    })

                })
            },
        })
    }


    //watchClose, 控制連線關閉或出錯時呼叫fn(jsftp於連線關閉時不回呼進行中之指令, 其'error'事件無監聽者時使程序中止), 回傳解除函數
    function watchClose(conn, fn) {
        let s = conn.socket
        let onClose = () => {
            setImmediate(fn) //先讓同批抵達之回應處理完
        }
        if (s) {
            s.once('close', onClose)
        }
        conn.on('error', onClose)
        return () => {
            if (s) {
                s.removeListener('close', onClose)
            }
            conn.removeListener('error', onClose)
        }
    }


    //sendOn, 於指定連線執行send(cb)送出指令(不另計時, 由上傳流程之各階段計時), 控制連線於回覆前關閉或出錯即reject
    function sendOn(conn, send) {
        return new Promise((resolve, reject) => {
            let unwatch = () => {}
            send((err, data) => {
                unwatch()
                if (err) {
                    reject(err)
                }
                else {
                    resolve(data)
                }
            })
            unwatch = watchClose(conn, () => {
                reject(new Error('connection closed'))
            })
        })
    }


    //cmdOn, 於指定連線送出單一指令
    function cmdOn(conn, name, ...args) {
        return sendOn(conn, (cb) => {
            conn.raw(name, ...args, cb)
        })
    }


    //codesStor, 傳輸開始後仍有其他指令待回應時, 只有這些回應碼視為STOR之最終回應(其餘屬該指令)
    let codesStor = [226, 425, 426, 451, 452, 551, 552]


    //putStream, 以串流讀本機檔並STOR至fpTemp, 收到伺服器之最終回應(226、250或4xx、5xx)才結束;
    //  jsftp於數據socket關閉即呼叫回呼, 早於最終回應, 故另監聽控制連線之回應; jsftp.put以串流傳入時其'readable'監聽使串流停住, 故用getPutSocket;
    //  未取得最終回應即失敗(逾時中止、連線錯誤)者, 控制連線可能仍等該指令之回覆, 以onDirty通知呼叫端銷毀連線
    function putStream({ conn, fpLocal, fpTemp, active, onSent, setStop, onDirty }) {
        return new Promise((resolve, reject) => {
            if (!active()) {
                reject(new Error('upload is stopped'))
                return
            }

            let reader = fs.createReadStream(fpLocal)
            let sent = 0
            let meter = new Transform({
                transform(chunk, encoding, cb) {
                    sent += chunk.length
                    onSent(sent)
                    cb(null, chunk)
                },
            })

            let socket = null //數據socket, 收到150後由jsftp以meter.pipe交出
            let errData = null //數據連線錯誤, 待最終回應後一併處理
            let replied = false
            let done = false
            let unwatch = () => {}

            let finish = (err) => {
                if (done) {
                    return
                }
                done = true
                conn.removeListener('data', onReply)
                unwatch()
                reader.destroy()
                if (err) {
                    meter.destroy()
                    if (socket !== null) {
                        socket.destroy()
                    }
                    if (!replied) {
                        onDirty()
                    }
                    reject(err)
                }
                else {
                    resolve()
                }
            }

            //onReply, 控制連線之回應; 同一連線併發其他指令時(如傳輸中呼叫stat), 其回應不得當作本次傳輸之結果:
            //  jsftp於發出此事件時佇列首即待回應之指令(STOR收到150即移出佇列)
            let onReply = (res) => {
                if (res.isMark) {
                    return
                }
                let code = res.code
                let pending = String(get(conn, ['commandQueue', 0, 'action'], '')).split(' ')[0].toLowerCase()
                if (socket === null) {
                    if (code >= 400 && (pending === 'pasv' || pending === 'stor')) {
                        replied = true
                        let err = new Error(res.text)
                        err.code = code
                        finish(err)
                    }
                    return
                }
                if (pending !== '' && codesStor.indexOf(code) < 0) {
                    return
                }
                if (code >= 400) {
                    replied = true
                    let err = new Error(res.text)
                    err.code = code
                    finish(err)
                }
                else if (code === 226 || code === 250) {
                    replied = true
                    finish(errData)
                }
            }

            conn.on('data', onReply)
            unwatch = watchClose(conn, () => {
                finish(new Error('connection closed during transfer')) //如quit、伺服器關閉控制連線或其錯誤
            })
            setStop(() => {
                finish(new Error('upload is stopped'))
            })

            reader.on('error', (err) => {
                finish(err)
            })
            meter.on('error', (err) => {
                finish(err)
            })

            //pipe, jsftp於收到150後呼叫meter.pipe(數據socket), 藉此取得該socket
            let pipe = meter.pipe
            meter.pipe = function(dest, opts) {
                if (done || !active()) {
                    dest.destroy()
                    return dest
                }
                socket = dest
                dest.on('error', (err) => {
                    errData = errData || err
                })
                return pipe.call(this, dest, opts)
            }

            reader.pipe(meter)

            conn.getPutSocket(meter, fpTemp, (err) => {
                if (!err || done) {
                    return
                }
                let e = err instanceof Error ? err : new Error('data connection error')
                if (socket !== null) {
                    errData = errData || e //傳輸中之數據連線錯誤, 待最終回應
                    return
                }
                finish(e) //未開始傳輸即失敗; 伺服器回應之錯誤已由onReply處理
            })

        })
    }


    //genUploadAdapter, 上傳流程(uploadViaTemp)之FTP操作, 固定使用本次上傳開始時之連線; 逾時時銷毀該連線(含數據socket)並重新連線
    function genUploadAdapter(linkStart, fpLocal, fpRemote, fileSize, cbProcess, emit) {
        let link = linkStart
        let dead = false
        let stopPut = null
        let cancel = null //取消本次重新連線嘗試

        let abortConn = () => {
            dead = true
            link.destroy()
        }

        //dropConn, 銷毀指定連線(指令佇列已不可用); 為目前所用者另記為待重新連線. 逾時後才到之舊連線錯誤不影響重新連線之新連線
        let dropConn = (l) => {
            if (l === link) {
                abortConn()
            }
            else {
                l.destroy()
            }
        }

        //lost, 非伺服器回應之錯誤(連線關閉或出錯)時銷毀送出該指令之連線, 其後之清理重新連線
        let lost = (l) => (err) => {
            if (!isReply(err)) {
                dropConn(l)
            }
            return Promise.reject(err)
        }

        let cmd = (name, ...args) => {
            let l = link
            return cmdOn(l.client, name, ...args).catch(lost(l))
        }

        //isFile, 以MLST之type判斷(避免把資料夾當檔案搬走); MLST不支援者以SIZE判斷
        let isFile = async (fp) => {
            try {
                let r = await cmd('mlst', fp)
                return get(r, 'text', '').indexOf('type=file;') >= 0
            }
            catch (err) {
                if (get(err, 'code') !== 500 && get(err, 'code') !== 502) {
                    return false
                }
            }
            try {
                await cmd('size', fp)
                return true
            }
            catch (err) {
                return false
            }
        }

        return {
            prepare: async (active) => {
                //若有多層資料夾才逐層mkdir
                let sstf = sepTreeFolders(fpRemote)
                await pmSeries(sstf, async (fd) => {
                    if (!active()) {
                        return
                    }
                    let b = false
                    try {
                        let r = await cmd('mlst', fd)
                        b = get(r, 'text', '').indexOf('type=dir;') >= 0
                    }
                    catch (err) {
                        if (!isReply(err)) {
                            throw err
                        }
                    }
                    if (!b && active()) {
                        await cmd('mkd', fd)
                    }
                })
            },
            put: async (fpTemp, active) => {
                //TYPE I, 使登入流程於傳輸前完成(其回應不混入傳輸之回應監聽)並確保二進位模式
                try {
                    await cmd('type', 'I')
                }
                catch (err) {
                    if (!isReply(err)) {
                        throw err
                    }
                }
                let l = link
                await putStream({
                    conn: l.client,
                    fpLocal,
                    fpTemp,
                    active,
                    onSent: (sent) => {
                        //cbProcess, 逾時後串流已於中止時銷毀而不再通知; 回調拋錯忽略
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
                    },
                    setStop: (fn) => {
                        stopPut = fn
                    },
                    onDirty: () => {
                        dropConn(l)
                    },
                })
            },
            size: async (fp) => {
                let r = await cmd('size', fp)
                let m = /^213 (\d+)\s*$/.exec(get(r, 'text', ''))
                if (m === null) {
                    throw new Error('invalid result from SIZE')
                }
                return Number(m[1])
            },
            isFile,
            rename: (fpFrom, fpTo) => {
                let l = link
                return sendOn(l.client, (cb) => {
                    l.client.rename(fpFrom, fpTo, cb) //RNFR後RNTO
                })
                    .catch(lost(l))
            },
            remove: (fp) => {
                return cmd('dele', fp)
            },
            isAbsent: async (fp) => {
                try {
                    await cmd('size', fp)
                    return false
                }
                catch (err) {
                    return get(err, 'code') === 550
                }
            },
            abort: () => {
                abortConn()
                if (stopPut !== null) {
                    stopPut()
                }
                //取消本次重新連線嘗試: 重放cwd中被取消者視為重放失敗而清空連線(須重新conn), 尚未連上者保留舊連線供下一個操作再試
                if (cancel !== null) {
                    cancel()
                    cancel = null
                }
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
    }


    async function ftpUpload(fpLocal, fpRemote, cbProcess, optCall = {}) {

        //check
        if (keeper.current() === null) {
            return Promise.reject(connKeeper.msgNotInit)
        }

        //fpRemote
        if (!isestr(fpRemote)) {
            return Promise.reject(`fpRemote[${fpRemote}] is not an effective string`)
        }

        //fpLocal
        if (!isestr(fpLocal)) {
            return Promise.reject(`fpLocal[${fpLocal}] is not an effective string`)
        }

        //check
        if (!fsIsFile(fpLocal)) {
            return Promise.reject(`fpLocal[${fpLocal}] is not a file`)
        }

        //statSync
        let stat = fs.statSync(fpLocal)

        //fileSize
        let fileSize = get(stat, 'size', 0)

        //check
        if (!isnum(fileSize)) {
            return Promise.reject(`can not get the size of file[${fpLocal}]`)
        }
        fileSize = cint(fileSize)
        // console.log('fileSize', fileSize)

        //link, 控制連線已中斷者於此重新連線並重放cwd
        let link = await keeper.acquire('ftpUpload', downloadViaTemp.traceOf(optCall))

        //uploadViaTemp, 先寫入遠端暫存名, 傳輸成功且大小相符才改名為fpRemote, 失敗時刪除暫存、舊fpRemote不動; 各階段以timeLimit計時; 不改變工作目錄
        return uploadViaTemp({
            fpLocal,
            fpRemote,
            fileSize,
            timeLimit,
            optCall,
            genAdapter: (emit) => genUploadAdapter(link, fpLocal, fpRemote, fileSize, cbProcess, emit),
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
            return ftpSyncToLocal(fdRemote, fdLocal, cbProcess, { ...opt, ftpLs, ftpDownload })
        },
        syncToRemote: async (fdLocal, fdRemote, cbProcess, opt = {}) => {
            return ftpSyncToRemote(fdLocal, fdRemote, cbProcess, { ...opt, ftpLs, ftpUpload })
        },
        stat: ftpStateTar,
        mkdir: ftpMkdir,
        cwd: ftpCwd,
        pwd: ftpPwd,
    }
}


export default CoreFTP
