import path from 'path'
import fs from 'fs'
import get from 'lodash/get'
import size from 'lodash/size'
import filter from 'lodash/filter'
import find from 'lodash/find'
import map from 'lodash/map'
import genPm from 'wsemi/src/genPm.mjs'
import cint from 'wsemi/src/cint.mjs'
import cstr from 'wsemi/src/cstr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import getFileName from 'wsemi/src/getFileName.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
// import Jsftp from 'jsftp'
import Jsftp from './jsftp.js'
console.log('Jsftp', Jsftp)


/**
 * 指定FTP伺服器資料夾內檔案並自動同步至本機，只能用於Windows作業系統
 *
 * @param {String} fp 輸入檔案路徑字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.ver='4.8'] 輸入調用windows程序之Net Framework版本字串，可有'4.5'、'4.6'、'4.7.2'與'4.8'，預設'4.8'
 * @returns {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *
 *     //fp
 *     let fp = './g.mseed'
 *
 *     //WFtp
 *     let r = await WFtp(fp)
 *     console.log(r)
 *     // [
 *     //   {
 *     //     name: 'SE.RST01.00.HNE.D.2020-09-17T013552.000000.csv',
 *     //     path: null,
 *     //     data: { heads: [Object], records: [Array] }
 *     //   },
 *     //   {
 *     //     name: 'SE.RST01.00.HNN.D.2020-09-17T013552.000000.csv',
 *     //     path: null,
 *     //     data: { heads: [Object], records: [Array] }
 *     //   },
 *     //   {
 *     //     name: 'SE.RST01.00.HNZ.D.2020-09-17T013552.000000.csv',
 *     //     path: null,
 *     //     data: { heads: [Object], records: [Array] }
 *     //   }
 *     // ]
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log('catch', err)
 *     })
 *
 */
function WFtp() {

    function WFtpCore() {
        let Ftp = null


        async function ftpConn(opt = {}) {

            //pm
            let pm = genPm()

            //hostname
            let hostname = get(opt, 'hostname')
            if (!isestr(hostname)) {
                pm.reject(`hostname[${hostname}] is not a effective string`)
                return pm
            }

            //port
            let port = get(opt, 'port')
            if (!ispint(port)) {
                pm.reject(`port[${port}] is not a positive integer`)
                return pm
            }
            port = cint(port)

            //username
            let username = get(opt, 'username')
            if (!isestr(username)) {
                pm.reject(`username[${username}] is not a effective string`)
                return pm
            }

            //password
            let password = get(opt, 'password')
            if (!isestr(password)) {
                pm.reject(`password[${password}] is not a effective string`)
                return pm
            }

            try {
                Ftp = new Jsftp({
                    host: hostname,
                    port, // defaults to 21
                    user: username, // defaults to "anonymous"
                    pass: password, // defaults to "@anonymous"
                })
                pm.resolve('ok')
            }
            catch (err) {
                pm.reject(err)
            }

            return pm
        }


        async function ftpLs(remoteFd = '.') {

            //pm
            let pm = genPm()

            //check
            if (Ftp === null) {
                pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
                return pm
            }

            Ftp.ls(remoteFd, (err, res) => {
                if (err) {
                    pm.reject(err)
                }
                else {
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

            Ftp.raw('quit', (err, res) => {
                if (err) {
                    pm.reject(err)
                }
                else {
                    pm.resolve(res)
                }
            })

            return pm
        }


        async function ftpStateFile(fpRemote) {

            //ftpLs
            let file = null
            await ftpLs(fpRemote)
                .then((res) => {
                    file = res
                })
                .catch(() => {
                    file = null
                })

            //get
            file = get(file, 0, null)
            // console.log('file', file)

            return file
        }


        async function ftpCheckFile(fpRemote) {

            //ftpStateFile
            let file = await ftpStateFile(fpRemote)

            //b
            let b = iseobj(file)

            return b
        }


        async function ftpDownload(fpRemote, fpLocal, cbProcess) {

            //pm
            let pm = genPm()

            //check
            if (Ftp === null) {
                pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
                return pm
            }

            //fpRemote
            if (!isestr(fpRemote)) {
                pm.reject(`fpRemote[${fpRemote}] is not a effective string`)
                return pm
            }

            //fpLocal
            if (!isestr(fpLocal)) {
                pm.reject(`fpLocal[${fpLocal}] is not a effective string`)
                return pm
            }

            //fdLocal
            let fdLocal = path.basename(path.dirname(fpLocal))

            //check fdLocal
            if (!fsIsFolder(fdLocal)) {
                fsCreateFolder(fdLocal)
            }

            //ftpStateFile
            let file = await ftpStateFile(fpRemote)
            // console.log('file', file)

            //fileSize
            let fileSize = get(file, 'size')

            //check
            if (!isnum(fileSize)) {
                pm.reject(`can not get the size of file[${fpRemote}]`)
                return pm
            }
            fileSize = cint(fileSize)
            // console.log('fileSize', fileSize)

            Ftp.get(fpRemote, (err, socket) => {

                //check
                if (err) {
                    pm.reject(err)
                }

                //check
                if (fsIsFile(fpLocal)) {
                    fs.unlinkSync(fpLocal)
                }

                //createWriteStream
                let writer = fs.createWriteStream(fpLocal)

                //on data
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

                //on close
                socket.on('close', (err) => {
                    if (err) {
                        pm.reject(err)
                    }
                    else {
                        pm.resolve('ok')
                    }
                })

                //resume
                socket.resume()

            })

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
                pm.reject(`fpRemote[${fpRemote}] is not a effective string`)
                return pm
            }

            //fpLocal
            if (!isestr(fpLocal)) {
                pm.reject(`fpLocal[${fpLocal}] is not a effective string`)
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
            let fileSize = get(stat, 'size')

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

            let dss = 0
            Ftp.put(bufferLocal, fpRemote, (err, buffer) => {
                // console.log('Ftp.put', err, buffer)

                //check
                if (err) {
                    pm.reject(err)
                    return
                }

                //check
                if (size(buffer) === 0) {
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


        async function ftpSyncToLocal(fdRemote, fdLocal, cbProcess) {

            //check
            if (Ftp === null) {
                return Promise.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
            }

            //ftpLs
            let fsRemote = await ftpLs(fdRemote)
            // fsRemote = map(fsRemote, (v) => {
            //     let d = dayjs(v.time)
            //     v.stat = d.format('YYYY-MM-DDTHH:mm:ss')
            //     return v
            // })
            // console.log('fsRemote', fsRemote)

            //check fdLocal
            if (!fsIsFolder(fdLocal)) {
                fsCreateFolder(fdLocal)
            }

            //fsTreeFolder
            let fsLocal = fsTreeFolder(fdLocal)
            fsLocal = filter(fsLocal, (v) => {
                return !v.isFolder
            })
            fsLocal = map(fsLocal, (v) => {
                let stat = fs.statSync(v.path)
                v.size = cstr(get(stat, 'size', ''))
                return v
            })
            // console.log('fsLocal', fsLocal)

            //pmSeries
            let n = 0
            let ss = []
            await pmSeries(fsRemote, async (fileRemote) => {

                //fileLocal
                let fileLocal = find(fsLocal, { name: fileRemote.name })
                // console.log('fileLocal', fileLocal)

                //fpRemote
                // let fpRemote = path.resolve(fdRemote, v.name)
                let fpRemote = fdRemote
                if (!strleft(fpRemote, 1) !== '/') {
                    fpRemote += '/'
                }
                fpRemote += get(fileRemote, 'name', '')
                // console.log('fpRemote', fpRemote)

                //fpLocal
                let fpLocal = path.resolve(fdLocal, get(fileRemote, 'name', ''))
                // console.log('fpLocal', fpLocal)

                //cb
                let cb = (msg) => {
                    if (isfun(cbProcess)) {
                        cbProcess(msg)
                    }
                }

                //ftpDownload
                if (!iseobj(fileLocal)) {
                //本地檔案不存在
                    await ftpDownload(fpRemote, fpLocal, cb)
                    n++
                    ss.push({
                        name: fileRemote.name,
                        reason: 'no local file',
                    })
                }
                else if (fileRemote.size !== fileLocal.size) {
                //本地檔案大小與遠端檔案大小不同
                    await ftpDownload(fpRemote, fpLocal, cb)
                    n++
                    ss.push({
                        name: fileRemote.name,
                        reason: `size[${fileLocal.size}] of local file != size[${fileRemote.size}] of remote file`,
                    })
                }

            })

            return {
                num: n,
                files: ss,
            }
        }


        async function ftpSyncToRemote(fdLocal, fdRemote, cbProcess) {

            //check
            if (Ftp === null) {
                return Promise.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
            }

            //ftpLs
            let fsRemote = await ftpLs(fdRemote)
            // fsRemote = map(fsRemote, (v) => {
            //     let d = dayjs(v.time)
            //     v.stat = d.format('YYYY-MM-DDTHH:mm:ss')
            //     return v
            // })
            // console.log('fsRemote', fsRemote)

            //check fdLocal
            if (!fsIsFolder(fdLocal)) {
                return Promise.reject(`fdLocal[${fdLocal}] is not a folder`)
            }

            //fsTreeFolder
            let fsLocal = fsTreeFolder(fdLocal)
            fsLocal = filter(fsLocal, (v) => {
                return !v.isFolder
            })
            fsLocal = map(fsLocal, (v) => {
                let stat = fs.statSync(v.path)
                v.size = cstr(get(stat, 'size', ''))
                return v
            })
            // console.log('fsLocal', fsLocal)

            //pmSeries
            let n = 0
            let ss = []
            await pmSeries(fsLocal, async (fileLocal) => {

                //fileRemote
                let fileRemote = find(fsRemote, { name: fileLocal.name })
                // console.log('fileRemote', fileRemote)

                //fpRemote
                // let fpRemote = path.resolve(fdRemote, v.name)
                let fpRemote = fdRemote
                if (!strleft(fpRemote, 1) !== '/') {
                    fpRemote += '/'
                }
                fpRemote += get(fileLocal, 'name', '')
                // console.log('fpRemote', fpRemote)

                //fpLocal
                let fpLocal = path.resolve(fdLocal, get(fileLocal, 'name', ''))
                // console.log('fpLocal', fpLocal)

                //cb
                let cb = (msg) => {
                    if (isfun(cbProcess)) {
                        cbProcess(msg)
                    }
                }

                //ftpUpload
                if (!iseobj(fileRemote)) {
                    //遠端檔案不存在
                    await ftpUpload(fpLocal, fpRemote, cb)
                    n++
                    ss.push({
                        name: fileLocal.name,
                        reason: 'no Remote file',
                    })
                }
                else if (fileLocal.size !== fileRemote.size) {
                    //遠端檔案大小與本機檔案大小不同
                    await ftpUpload(fpLocal, fpRemote, cb)
                    n++
                    ss.push({
                        name: fileLocal.name,
                        reason: `size[${fileRemote.size}] of remote file != size[${fileLocal.size}] of local file`,
                    })
                }

            })

            return {
                num: n,
                files: ss,
            }
        }


        return {
            conn: ftpConn,
            ls: ftpLs,
            stateFile: ftpStateFile,
            checkFile: ftpCheckFile,
            download: ftpDownload,
            syncToLocal: ftpSyncToLocal,
            syncToRemote: ftpSyncToRemote,
            upload: ftpUpload,
            quit: ftpQuit,
        }
    }

    return new WFtpCore()
}


export default WFtp
