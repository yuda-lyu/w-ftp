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


function CoreFTP(opt = {}) {
    let Ftp = null

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


    //cwds, 使用者以cwd成功切換過之路徑(依序), 上傳逾時後重新連線時重放, 使其後相對路徑指向同一資料夾
    let cwds = []


    //newJsftp, 以本實例之設定建立連線(conn與上傳之重新連線共用)
    function newJsftp() {
        return new Jsftp({
            host: hostname, //hostname or ip
            port, // defaults to 21
            user: username,
            pass: password,
        })
    }


    //hardDestroy, jsftp的destroy對socket僅做end()軟關閉, 對端不回FIN時socket殘留使行程無法退出, 故須於destroy前先取出socket參照再硬關閉
    function hardDestroy(conn) {

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


    async function ftpConn() {

        //pm
        let pm = genPm()

        try {
            Ftp = newJsftp()
            cwds = []
            pm.resolve('ok')
        }
        catch (err) {
            pm.reject(err)
        }

        return pm
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


    async function ftpLs(fdRemote = '.') {

        //pm
        let pm = genPm()

        //check
        if (Ftp === null) {
            pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
            return pm
        }

        //timeLimit
        let t = setTimeout(() => {
            pm.reject(`ftpLs timeout[${timeLimit}]`)
        }, timeLimit)

        Ftp.ls(fdRemote, (err, res) => {

            //clearTimeout
            clearTimeout(t)

            if (err) {
                //有些伺服器會回傳empty string(由jsftp.js提示), 故可能無法進行ls列舉, 且其回傳: Could not retrieve a file listing for ooo
                if (get(err, 'code') === 451) {
                    pm.resolve([]) //視為資料夾內無任何資料夾與檔案
                }
                else {
                    pm.reject(err)
                }
            }
            else {
                res = map(res, (v) => {
                    v.mtime = ftpMsToTime(v.time)
                    v.size = cint(v.size)
                    v.isFolder = ftpIsFolderCore(v)
                    return v
                })
                pm.resolve(res)
            }
        })

        return pm
    }


    async function ftpQuit() {

        //pm
        let pm = genPm()

        //check
        if (Ftp === null) {
            pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
            return pm
        }

        //conn, 固定本次欲關閉之連線: 期間上傳之重新連線或另一次quit可能改變Ftp
        let conn = Ftp

        //destroyAndClear, 硬關閉該連線, 仍為目前連線者清空
        let destroyAndClear = () => {

            //hardDestroy
            hardDestroy(conn)

            //clear
            if (Ftp === conn) {
                Ftp = null
            }

        }

        //timeLimit
        let t = setTimeout(() => {

            //destroyAndClear
            destroyAndClear()

            pm.reject(`ftpQuit timeout[${timeLimit}]`)
        }, timeLimit)

        conn.raw('quit', (err, res) => {

            //clearTimeout
            clearTimeout(t)

            //destroyAndClear
            destroyAndClear()

            //check, 逾時路徑硬關閉socket後可能觸發jsftp回調此處, 此時pm已reject, 下列resolve、reject不作用
            if (err) {
                pm.reject(err)
            }
            else {
                pm.resolve(res)
            }
        })

        return pm
    }


    async function ftpRaw(name, fpRemote) {

        //pm
        let pm = genPm()

        //check
        if (Ftp === null) {
            pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
            return pm
        }

        //timeLimit
        let t = setTimeout(() => {
            pm.reject(`ftpRaw[${name}] timeout[${timeLimit}]`)
        }, timeLimit)

        //raw
        Ftp.raw(name, fpRemote, (err, data) => {

            //clearTimeout
            clearTimeout(t)

            if (err) {
                pm.reject(err)
            }
            else {
                // console.log('ftpRaw then', fpRemote, data)
                pm.resolve(data)
            }
        })

        return pm
    }


    async function ftpMkdirCore(fpRemote) {
        return ftpRaw('mkd', fpRemote)
    }


    async function ftpMkdir(fpRemote) {
        //輸入為檔案路徑, 會解析出父資料夾並進行逐層創建

        //sepTreeFolders
        let sstf = sepTreeFolders(fpRemote)
        // console.log('sstf', sstf)

        //若有多層資料夾才mkdir
        if (size(sstf) >= 1) {
            await pmSeries(sstf, async (fd) => {
                // console.log('call ftpIsFolder', fd)
                let b = await ftpIsFolder(fd)
                if (!b) {
                    // console.log('call ftpMkdirCore', fd)
                    await ftpMkdirCore(fd)
                    // console.log('ftpMkdir', fd)
                }
            })

        }

        return 'ok'
    }


    async function ftpMlst(fpRemote) {
        return ftpRaw('mlst', fpRemote)
    }


    async function ftpSize(fpRemote) {
        return ftpRaw('size', fpRemote)
    }


    async function ftpCwd(fpRemote) {
        let r = await ftpRaw('cwd', fpRemote)
        //記錄成功切換之路徑, 供上傳之重新連線重放; 絕對路徑不依賴先前者, 只需記它
        if (String(fpRemote).startsWith('/')) {
            cwds = [fpRemote]
        }
        else {
            cwds.push(fpRemote)
        }
        return r
    }


    async function ftpPwd() {
        return ftpRaw('pwd')
    }


    async function ftpStateTar(fpRemote) {

        //check
        if (Ftp === null) {
            return Promise.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
        }

        //r
        let r = {}

        //ftpMlst
        let rmlst = null
        await ftpMlst(fpRemote)
            .then((res) => {
                rmlst = res
            })
            .catch((err) => {
                rmlst = {
                    err: err.toString(),
                }
            })
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

        //ftpSize
        let rsize = null
        await ftpSize(fpRemote)
            .then((res) => {
                rsize = res
            })
            .catch((err) => {
                rsize = {
                    err: err.toString(),
                }
            })
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


    async function ftpIsFolder(fpRemote) {

        //ftpStateTar
        let fd = await ftpStateTar(fpRemote)
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


    async function ftpIsFile(fpRemote) {

        //ftpStateTar
        let file = await ftpStateTar(fpRemote)
        // console.log('ftpIsFile ftpStateTar', fpRemote, 'file', file)

        //ftpIsFileCore
        let b = ftpIsFileCore(file)

        return b
    }


    async function ftpDownload(fpRemote, fpLocal, cbProcess = null, optCall = {}) {

        //pm
        let pm = genPm()

        //check
        if (Ftp === null) {
            pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
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

        //ftpStateTar
        let file = await ftpStateTar(fpRemote)
        // console.log('file', file)

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

        //check, 取不到遠端大小(如SIZE指令失敗, ftpStateTar此時回size為0)即無從核對是否下載完整, 預設拒絕
        if (!isnum(fileSize) || haskey(get(file, 'rsize'), 'err')) {
            pm.reject(`can not get the size of file[${fpRemote}]`)
            return pm
        }
        fileSize = cint(fileSize)
        // console.log('fileSize', fileSize)

        //check, 查詢期間已quit
        if (Ftp === null) {
            pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
            return pm
        }

        //Ftp, 固定本次所用之連線, 避免傳輸期間quit將Ftp設為null
        let FtpNow = Ftp

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

                    FtpNow.get(fpRemote, (err, socket) => {

                        //check, 取得數據socket失敗(如425)時尚未寫入任何內容
                        if (err) {
                            reject(err)
                            return
                        }

                        //check, 已逾時才取得socket者直接關閉, 不寫入
                        if (!ctl.active()) {
                            socket.destroy()
                            reject(`ftpDownload timeout[${timeLimit}]`)
                            return
                        }

                        //setAbort, 逾時時銷毀數據socket以停止傳輸
                        ctl.setAbort(() => {
                            socket.destroy()
                        })

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
    function genUploadAdapter(fpLocal, fpRemote, fileSize, cbProcess, emit) {
        let conn = Ftp
        let dead = false
        let stopPut = null
        let reconnectingFrom = null //重新連線(重放cwd)進行中之舊連線

        let abortConn = () => {
            dead = true
            hardDestroy(conn)
        }

        //dropConn, 銷毀指定連線(指令佇列已不可用); 為目前所用者另記為待重新連線. 逾時後才到之舊連線錯誤不影響重新連線之新連線
        let dropConn = (c) => {
            if (c === conn) {
                abortConn()
            }
            else {
                hardDestroy(c)
            }
        }

        //lost, 非伺服器回應之錯誤(連線關閉或出錯)時銷毀送出該指令之連線, 其後之清理重新連線
        let lost = (c) => (err) => {
            if (typeof get(err, 'code') !== 'number') {
                dropConn(c)
            }
            return Promise.reject(err)
        }

        let cmd = (name, ...args) => {
            return cmdOn(conn, name, ...args).catch(lost(conn))
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
                        if (typeof get(err, 'code') !== 'number') {
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
                    if (typeof get(err, 'code') !== 'number') {
                        throw err
                    }
                }
                let c = conn
                await putStream({
                    conn: c,
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
                        dropConn(c)
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
                let c = conn
                return sendOn(c, (cb) => {
                    c.rename(fpFrom, fpTo, cb) //RNFR後RNTO
                })
                    .catch(lost(c))
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
                //重新連線中遭中止者工作目錄未能還原, 不沿用舊連線(須重新conn)
                if (reconnectingFrom !== null && Ftp === reconnectingFrom) {
                    Ftp = null
                }
            },
            reconnect: async () => {
                if (!dead) {
                    return
                }
                //使用者已quit者不重新連線; 已另行conn者改用其新連線
                if (Ftp === null) {
                    throw new Error('FTP has quit')
                }
                if (Ftp !== conn) {
                    conn = Ftp
                    dead = false
                    return
                }
                let old = conn
                let c = newJsftp()
                c.on('error', () => {}) //重新連線之連線可能閒置(無指令監看), 其'error'無監聽者時使行程中止
                conn = c
                reconnectingFrom = old
                try {
                    for (let fd of cwds) {
                        await cmdOn(c, 'cwd', fd) //重放使用者之工作目錄, 使相對路徑指向同一資料夾
                    }
                }
                catch (err) {
                    hardDestroy(c)
                    if (Ftp === old) {
                        Ftp = null //工作目錄無法還原, 不沿用(免相對路徑指向他處), 須重新conn
                    }
                    reconnectingFrom = null
                    emit('reconnect', { ok: false })
                    throw err
                }
                reconnectingFrom = null
                if (Ftp === old) {
                    Ftp = c
                }
                else {
                    hardDestroy(c)
                    if (Ftp === null) {
                        emit('reconnect', { ok: false })
                        throw new Error('FTP connection was replaced')
                    }
                    conn = Ftp //重放期間已由另一上傳或conn()換上新連線者改用之
                }
                dead = false
                emit('reconnect', { ok: true })
            },
        }
    }


    async function ftpUpload(fpLocal, fpRemote, cbProcess, optCall = {}) {

        //check
        if (Ftp === null) {
            return Promise.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
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

        //uploadViaTemp, 先寫入遠端暫存名, 傳輸成功且大小相符才改名為fpRemote, 失敗時刪除暫存、舊fpRemote不動; 各階段以timeLimit計時; 不改變工作目錄
        return uploadViaTemp({
            fpLocal,
            fpRemote,
            fileSize,
            timeLimit,
            optCall,
            genAdapter: (emit) => genUploadAdapter(fpLocal, fpRemote, fileSize, cbProcess, emit),
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
