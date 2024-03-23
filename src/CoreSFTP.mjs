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
        timeLimit = 1 * 60 * 1000 //1hr
    }
    timeLimit = cint(timeLimit)


    async function ftpConn() {

        //sftp
        Ftp = new SFTPClient()
        // console.log('Ftp', Ftp)

        //connect
        await Ftp.connect({
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
            // retries: 2, // integer. Number of times to retry connecting
            // retry_factor: 2, // integer. Time factor used to calculate time between retries
            // retry_minTimeout: 2000, // integer. Minimum timeout between attempts
        })
        // console.log('Ftp(connect)', Ftp)

        return 'ok'
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

        //check
        if (fsIsFile(fpLocal)) {
            fs.unlinkSync(fpLocal)
        }
        // console.log('fpLocal', fpLocal)

        //timeLimit
        let t = setTimeout(() => {
            pm.reject(`ftpDownload timeout[${timeLimit}]`)
        }, timeLimit)

        //fastGet
        Ftp.fastGet(fpRemote, fpLocal, {
            step: (total_transferred, chunk, total) => {
                // console.log(total_transferred, chunk, total)
                // 32768 32768 1384928
                // 65536 32768 1384928
                // ...
                // 1376256 32768 1384928
                // 1384928 8672 1384928

                //cbProcess
                if (isfun(cbProcess)) {
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
            .then(() => {
                pm.resolve('ok')
            })
            .catch((err) => {
                pm.reject(err)
            })
            .finally(() => {

                //clearTimeout
                clearTimeout(t)

            })

        //clearTimeout
        clearTimeout(t)

        return pm
    }


    async function ftpUpload(fpLocal, fpRemote, cbProcess) {

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

        //ftpMkdir
        await ftpMkdir(fpRemote)

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

        // //bufferLocal
        // let bufferLocal = fs.readFileSync(fpLocal)

        // //createReadStream
        // let reader = fs.createReadStream(fpLocal)

        //timeLimit
        let t = setTimeout(() => {
            pm.reject(`ftpUploadCore timeout[${timeLimit}]`)
        }, timeLimit)

        //fastPut
        Ftp.fastPut(fpLocal, fpRemote, {
            step: (total_transferred, chunk, total) => {
                // console.log(total_transferred, chunk, total)
                // 32768 32768 1384928
                // 65536 32768 1384928
                // ...
                // 1376256 32768 1384928
                // 1384928 8672 1384928

                //cbProcess
                if (isfun(cbProcess)) {
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
            .then(() => {
                pm.resolve('ok')
            })
            .catch((err) => {
                pm.reject(err)
            })
            .finally(() => {

                //clearTimeout
                clearTimeout(t)

            })

        //clearTimeout
        clearTimeout(t)

        return pm
    }


    return {
        conn: ftpConn,
        quit: ftpQuit,
        ls: ftpLs,
        isFile: ftpIsFile,
        isFolder: ftpIsFolder,
        download: ftpDownload,
        upload: ftpUpload,
        syncToLocal: async (fdRemote, fdLocal, cbProcess) => {
            return ftpSyncToLocal(fdRemote, fdLocal, cbProcess, { ftpLs, ftpDownload })
        },
        syncToRemote: async (fdLocal, fdRemote, cbProcess) => {
            return ftpSyncToRemote(fdLocal, fdRemote, cbProcess, { ftpLs, ftpUpload })
        },
        stat: ftpStateTar,
        mkdir: ftpMkdir,
        cwd: ftpCwd,
        pwd: ftpPwd,
    }
}


export default CoreSFTP
