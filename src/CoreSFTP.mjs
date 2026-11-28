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


function CoreSFTP(opt = {}) {
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


    async function ftpConn() {

        //sftp
        Ftp = new SFTPClient()
        // console.log('Ftp', Ftp)

        //connect
        await sftpConnect(Ftp)
        // console.log('Ftp(connect)', Ftp)

        return 'ok'
    }


    //sftpConnect, 以本實例之設定連線(conn與上傳逾時後之重新連線共用)
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


    //dropped, 上傳逾時等情形下由本套件銷毀之連線, 下一次上傳開始前重新連線
    let dropped = new WeakSet()


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


    async function ftpLs(fdRemote = '.') {
        let errTemp = null

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

        //list
        let res = await Ftp.list(fdRemote)
            .catch((err) => {
                errTemp = err
            })

        //clearTimeout
        clearTimeout(t)

        //check
        if (errTemp !== null) {
            pm.reject(errTemp)
            return pm
        }

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

        //resolve
        pm.resolve(res)

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

        //timeLimit
        let t = setTimeout(() => {

            //end
            Ftp.end()

            //clear
            Ftp = null

            pm.reject(`ftpQuit timeout[${timeLimit}]`)
        }, timeLimit)

        try {

            //end
            Ftp.end()

            //clear
            Ftp = null

            //clearTimeout
            clearTimeout(t)

            pm.resolve('ok')
        }
        catch (err) {
            pm.reject(err)
        }

        return pm
    }


    async function ftpMkdirCore(fpRemote) {
        let recursive = true
        return Ftp.mkdir(fpRemote, recursive)
    }


    async function ftpMkdir(fpRemote) {
        //輸入為檔案路徑, 會解析出父資料夾並進行逐層創建

        //sepTreeFolders
        let sstf = sepTreeFolders(fpRemote)
        // console.log('sstf', sstf)

        //若有多層資料夾才mkdir
        if (size(sstf) >= 1) {

            //last
            let sl = last(sstf)
            // console.log('sl', sl)

            //ftpMkdirCore
            await ftpMkdirCore(sl)

        }

        return 'ok'
    }


    // async function ftpMlst(fpRemote) {
    //     return ftpRaw('mlst', fpRemote)
    // }


    // async function ftpSize(fpRemote) {
    //     return ftpRaw('size', fpRemote)
    // }


    async function ftpCwd(fpRemote) {
        return Ftp.cwd(fpRemote)
    }


    async function ftpPwd() {
        return Ftp.pwd()
    }


    async function ftpStateTar(fpRemote) {

        //stat
        let file = null
        await Ftp.stat(fpRemote)
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
                    name: fpRemote,
                }
            })
            .catch((err) => {
                // console.log('Ftp.stat catch', err)
                file = {
                    err: err.toString(),
                }
            })
        // console.log('file', file)

        return file
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


    async function ftpIsFolder(fpRemote) {

        //ftpStateTar
        let fd = await ftpStateTar(fpRemote)

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


    async function ftpIsFile(fpRemote) {

        //ftpStateTar
        let file = await ftpStateTar(fpRemote)

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

        //check fdLocal
        if (!fsIsFolder(fdLocal)) {
            fsCreateFolder(fdLocal)
        }

        //ftpStateTar, 加計時: 伺服器於查詢遠端檔案資訊時停滯, 亦依timeLimit逾時(否則永不結束)
        let errStat = null
        let file = await downloadViaTemp.withTimeLimit({
            run: () => ftpStateTar(fpRemote),
            timeLimit,
            stage: 'stat',
            optCall,
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
        if (Ftp === null) {
            pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
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

        //Ftp, 固定本次所用之連線, 避免傳輸期間quit將Ftp設為null(已於上方確認不為null)
        let FtpNow = Ftp

        //downloadViaTemp, 先寫入暫存區, 傳輸成功且大小相符才移至fpLocal, 舊fpLocal於此之前不動; 逾時(timeLimit)自傳輸開始起計
        return downloadViaTemp({
            fpLocal,
            fileSize,
            timeLimit,
            fdTempInst: fdDownloadTemp,
            optCall,
            transfer: (fpTemp, ctl) => {

                //fastGet, 寫入暫存檔; SFTP無法中止, 逾時後可能於背景續行, 結束時由downloadViaTemp刪除暫存檔
                return FtpNow.fastGet(fpRemote, fpTemp, {
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

            },
        })
    }


    //genUploadAdapter, 上傳流程(uploadViaTemp)之SFTP操作, 固定使用本次上傳開始時之連線; 逾時時銷毀該連線並重新連線
    function genUploadAdapter(fpLocal, fpRemote, fileSize, cbProcess, emit) {
        let conn = Ftp
        let dead = dropped.has(conn) //先前上傳所銷毀而未能重新連線者, 開始前重新連線
        let connecting = null

        //isFile
        let isFile = async (fp) => {
            try {
                let st = await conn.stat(fp)
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
                let i = fpRemote.lastIndexOf('/')
                let fd = i < 0 ? '' : fpRemote.slice(0, i)
                if (fd === '' || fd === '.') {
                    return
                }
                //相對路徑先以伺服器之目前資料夾轉為絕對路徑: ssh2-sftp-client把'.'起首者一律當'./'改寫, 且根目錄為'/'時得'//a/b', 於Windows解析成網路路徑而無限遞迴
                if (!fd.startsWith('/')) {
                    fd = path.posix.join(await conn.realPath('.'), fd)
                }
                if (!active()) {
                    return
                }
                await conn.mkdir(fd, true)
            },
            put: (fpTemp, active) => {
                //sftpPutFile, 寫入遠端暫存名
                return sftpPutFile(conn, fpLocal, fpTemp, active, (sent) => {
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
                let st = await conn.stat(fp)
                if (get(st, 'isFile') !== true) {
                    throw new Error('not a file')
                }
                return st.size
            },
            isFile,
            posixRename: async (fpFrom, fpTo) => {
                //伺服器未宣告posix-rename@openssh.com擴充者回false, 由上傳流程改用rename
                if (get(conn, ['sftp', '_extensions', 'posix-rename@openssh.com']) !== '1') {
                    return false
                }
                await conn.posixRename(fpFrom, fpTo)
                return true
            },
            rename: (fpFrom, fpTo) => {
                return conn.rename(fpFrom, fpTo)
            },
            remove: (fp) => {
                return conn.delete(fp)
            },
            isAbsent: async (fp, errRemove) => {
                if (get(errRemove, 'code') === 2) { //SSH_FX_NO_SUCH_FILE
                    return true
                }
                //以ssh2之stat判斷, 僅SSH_FX_NO_SUCH_FILE視為不存在(ssh2-sftp-client之stat把一般失敗亦報為不存在)
                return new Promise((resolve) => {
                    conn.sftp.stat(fp, (err) => {
                        resolve(get(err, 'code') === 2)
                    })
                })
            },
            abort: () => {
                dead = true
                if (connecting !== null) {
                    sftpDestroy(connecting)
                    connecting = null
                }
                dropped.add(conn)
                sftpDestroy(conn)
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
                let client = new SFTPClient()
                connecting = client
                let ok = false
                try {
                    await sftpConnect(client)
                    ok = connecting === client && Ftp === conn
                }
                finally {
                    if (connecting === client) {
                        connecting = null
                    }
                    if (!ok) {
                        sftpDestroy(client)
                    }
                    emit('reconnect', { ok })
                }
                if (ok) {
                    Ftp = client
                }
                else if (Ftp === null || Ftp === conn) {
                    throw new Error('FTP connection was replaced') //本次連線已作廢且無可改用之連線
                }
                conn = Ftp //連線期間已由另一上傳或conn()換上新連線者改用之
                dead = false
            },
        }
        return adapter
    }


    async function ftpUpload(fpLocal, fpRemote, cbProcess, optCall = {}) {

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

        //uploadViaTemp, 先寫入遠端暫存名, 傳輸成功且大小相符才改名為fpRemote, 失敗時刪除暫存、舊fpRemote不動; 各階段以timeLimit計時
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
