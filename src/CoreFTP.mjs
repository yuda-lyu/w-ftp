import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import last from 'lodash-es/last.js'
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
        timeLimit = 1 * 60 * 1000 //1hr
    }
    timeLimit = cint(timeLimit)


    async function ftpConn() {

        //pm
        let pm = genPm()

        try {
            Ftp = new Jsftp({
                host: hostname, //hostname or ip
                port, // defaults to 21
                user: username,
                pass: password,
            })
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

        //timeLimit
        let t = setTimeout(() => {

            //destroy
            Ftp.destroy()

            //clear
            Ftp = null

            pm.reject(`ftpQuit timeout[${timeLimit}]`)
        }, timeLimit)

        Ftp.raw('quit', (err, res) => {

            //clearTimeout
            clearTimeout(t)

            //destroy
            Ftp.destroy()

            //clear
            Ftp = null

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
        return ftpRaw('cwd', fpRemote)
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


    async function ftpDownload(fpRemote, fpLocal, cbProcess = null) {

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

        //check fpLocal
        if (fsIsFile(fpLocal)) {
            fs.unlinkSync(fpLocal)
        }

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

        //check
        if (!isnum(fileSize)) {
            pm.reject(`can not get the size of file[${fpRemote}]`)
            return pm
        }
        fileSize = cint(fileSize)
        // console.log('fileSize', fileSize)

        //timeLimit
        let t = setTimeout(() => {
            pm.reject(`ftpDownload timeout[${timeLimit}]`)
        }, timeLimit)

        Ftp.get(fpRemote, (err, socket) => {

            //check
            if (err) {

                //clearTimeout
                clearTimeout(t)

                pm.reject(err)
                return
            }

            //createWriteStream
            let writer = fs.createWriteStream(fpLocal)

            //socket data
            let dss = 0
            socket.on('data', (d) => {
                // console.log('socket.on data', d)

                //cbProcess
                if (isfun(cbProcess)) {
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
                writer.write(d)

            })

            //socket close
            socket.on('close', () => {
                // console.log('socket close')

                //end, 無數據時要呼叫end告知已結束
                writer.end()

            })

            //writer finish
            writer.on('finish', () => {
                // console.log('writer finish')

                //clearTimeout
                clearTimeout(t)

                if (err) {
                    pm.reject(err)
                }
                else {
                    pm.resolve('ok')
                }
            })

            //writer error
            writer.on('error', (err) => {
                console.log('writer error', err)
            })

            //resume
            socket.resume()

        })

        return pm
    }


    async function ftpUploadCore(fpLocal, fpRemote, cbProcess) {

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

        //bufferLocal
        let bufferLocal = fs.readFileSync(fpLocal)

        // //createReadStream
        // let reader = fs.createReadStream(fpLocal)

        //timeLimit
        let t = setTimeout(() => {
            pm.reject(`ftpUploadCore timeout[${timeLimit}]`)
        }, timeLimit)

        let dss = 0
        Ftp.put(bufferLocal, fpRemote, (err, buffer) => {
            // console.log('Ftp.put', err, buffer)

            //check
            if (err) {

                //clearTimeout
                clearTimeout(t)

                pm.reject(err)
                return
            }

            //check
            if (size(buffer) === 0) {

                //clearTimeout
                clearTimeout(t)

                pm.resolve('ok')
                return
            }

            //cbProcess
            if (isfun(cbProcess)) {
                let ds = size(buffer)
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

        })

        return pm
    }


    async function ftpUpload(fpLocal, fpRemote, cbProcess) {
        let errTemp = null

        //check
        if (Ftp === null) {
            return Promise.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
        }

        //fpRemote
        if (!isestr(fpRemote)) {
            return Promise.reject(`fpRemote[${fpRemote}] is not an effective string`)
        }

        //sepTreeFolders
        let sstf = sepTreeFolders(fpRemote)
        // console.log('sstf', sstf)

        //多層資料夾
        let fpRemoteNow = fpRemote
        if (size(sstf) >= 1) {

            //ftpMkdir
            await ftpMkdir(fpRemote)

            //fdNow
            let fdNow = last(sstf)
            // console.log('fdNow', fdNow)

            //ftpCwd fdNow
            await ftpCwd(fdNow)
            // console.log('ftpCwd fdNow', fdNow, cd)

            //fpRemoteNow
            fpRemoteNow = '.' + fpRemote.replace(fdNow, '')
            // console.log('fpRemoteNow', fpRemoteNow)

        }
        // console.log('fpRemoteNow', fpRemoteNow)

        //ftpUploadCore
        let r = await ftpUploadCore(fpLocal, fpRemoteNow, cbProcess)
            .catch((err) => {
                errTemp = err
            })

        //ftpCwd reset
        if (size(sstf) >= 1) {

            //ftpCwd, 初始目錄為/而不是./
            await ftpCwd('/')
            // console.log('ftpCwd reset', cr)

        }

        //check
        if (errTemp !== null) {
            return Promise.reject(errTemp)
        }

        return r
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
