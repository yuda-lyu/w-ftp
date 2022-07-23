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
import Jsftp from './jsftp.js'


/**
 * 連線至FPT伺服器
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} opt.hostname='' 輸入hostname字串
 * @param {Number} opt.port='' 輸入port正整數
 * @param {String} opt.username='' 輸入帳號字串
 * @param {String} opt.password='' 輸入密碼字串
 * @return {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     //actions
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function ftpConn(opt = {}) {
    return null
}


/**
 * 遍歷伺服器上指定資料夾內檔案清單資訊
 *
 * @param {String} opt.fdRemote 輸入伺服器上指定資料夾字串
 * @return {Promise} 回傳Promise，resolve回傳檔案清單資訊，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     let fps = await ftp.ls('.')
 *     console.log('ftp.ls', fps[0], fps.length)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 *
 */
async function ftpLs(fdRemote = '.') {
    return null
}


/**
 * 關閉與伺服器連線
 *
 * @return {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     //actions
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 */
async function ftpQuit() {
    return null
}


/**
 * 取得伺服器指定檔案資訊
 *
 * @param {String} opt.fpRemote 輸入伺服器上指定檔案字串
 * @return {Promise} 回傳Promise，resolve回傳檔案資訊，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     r = await ftp.stateFile('./_test_upload_client/DECL_20210805055044.csv')
 *     console.log('ftp.stateFile', r)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 */
async function ftpStateFile(fpRemote) {
    return null
}


/**
 * 確認伺服器指定檔案是否存在
 *
 * @param {String} opt.fpRemote 輸入伺服器上指定檔案字串
 * @return {Promise} 回傳Promise，resolve回傳指定檔案是否存在布林值，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     r = await ftp.checkFile('./_test_upload_client/DECL_20210805055044.csv')
 *     console.log('ftp.checkFile', r)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 */
async function ftpCheckFile(fpRemote) {
    return null
}


/**
 * 下載伺服器指定檔案至本機
 *
 * @param {String} opt.fpRemote 輸入伺服器上指定檔案字串
 * @param {String} opt.fpLocal 輸入本機指定檔案字串
 * @param {Function} [opt.cbProcess=null] 輸入回調進度函數
 * @return {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     r = await ftp.download('./DECL_20210805055044.csv', './_test_download_client/DECL_20210805055044.csv', (p) => {
 *         console.log('ftp.download p', p.name, p.progress)
 *     })
 *     console.log('ftp.download', r)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 */
async function ftpDownload(fpRemote, fpLocal, cbProcess = null) {
    return null
}


/**
 * 上傳本機指定檔案至伺服器
 *
 * @param {String} opt.fpLocal 輸入本機指定檔案字串
 * @param {String} opt.fpRemote 輸入伺服器上指定檔案字串
 * @param {Function} [opt.cbProcess=null] 輸入回調進度函數
 * @return {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     r = await ftp.upload('./_test_upload_client/DECL_20210805055044.csv', './DECL_20210805055044.csv', (p) => {
 *         console.log('ftp.upload p', p.name, p.progress)
 *     })
 *     console.log('ftp.upload', r)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 */
async function ftpUpload(fpLocal, fpRemote, cbProcess) {
    return null
}


/**
 * 同步伺服器上指定資料夾內檔案至本機
 *
 * @param {String} opt.fdRemote 輸入伺服器上指定資料夾字串
 * @param {String} opt.fdLocal 輸入本機指定資料夾字串
 * @param {Function} [opt.cbProcess=null] 輸入回調進度函數
 * @return {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     r = await ftp.syncToLocal('.', './_test_download_client', (p) => {
 *         console.log('ftp.syncToLocal p', p.name, p.progress)
 *     })
 *     console.log('ftp.syncToLocal', r)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 */
async function ftpSyncToLocal(fdRemote, fdLocal, cbProcess) {
    return null
}


/**
 * 同步本機指定資料夾內檔案至伺服器
 *
 * @param {String} opt.fdLocal 輸入本機指定資料夾字串
 * @param {String} opt.fdRemote 輸入伺服器上指定資料夾字串
 * @param {Function} [opt.cbProcess=null] 輸入回調進度函數
 * @return {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: st.up.hostname,
 *         port: st.up.port,
 *         username: st.up.username,
 *         password: st.up.password,
 *     })
 *
 *     r = await ftp.syncToRemote('./_test_upload_client', '.', (p) => {
 *         console.log('ftp.syncToRemote p', p.name, p.progress)
 *     })
 *     console.log('ftp.syncToRemote', r)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 */
async function ftpSyncToRemote(fdLocal, fdRemote, cbProcess) {
    return null
}


/**
 * 操作FTP，包含連線、下載、資料夾內檔案同步下載、上傳、資料夾內檔案同步上傳等功能
 *
 * @returns {Object} 回傳FTP操作物件，包含conn、ls、stateFile、checkFile、download、syncToLocal、syncToRemote、upload、quit。
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test_up() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: `{hostname}`,
 *         port: `{port}`,
 *         username: `{username}`,
 *         password: `{password}`,
 *     })
 *
 *     let fps = await ftp.ls('.')
 *     console.log('ftp.ls', fps[0], fps.length)
 *
 *     r = await ftp.upload('./_test_upload_client/DECL_20210805055044.csv', './DECL_20210805055044.csv', (p) => {
 *         console.log('ftp.upload p', p.name, p.progress)
 *     })
 *     console.log('ftp.upload', r)
 *
 *     r = await ftp.syncToRemote('./_test_upload_client', '.', (p) => {
 *         console.log('ftp.syncToRemote p', p.name, p.progress)
 *     })
 *     console.log('ftp.syncToRemote', r)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test_up()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 * // ftp.ls {
 * //   name: 'DECL_202108.csv',
 * //   type: 0,
 * //   time: 1658366760000,
 * //   size: '218690',
 * //   owner: 'ftp',
 * //   group: 'ftp',
 * //   userPermissions: { read: true, write: true, exec: false },
 * //   groupPermissions: { read: true, write: true, exec: false },
 * //   otherPermissions: { read: true, write: true, exec: false }
 * // } 73
 * // ftp.upload p DECL_20210805055044.csv 75.71339448693362
 * // drain
 * // ftp.upload p DECL_20210805055044.csv 100
 * // ftp.upload ok
 * // ftp.syncToRemote { num: 0, files: [] }
 * // ftp.quit { code: 221, text: '221 Goodbye.', isMark: false, isError: false }
 *
 * async function test_dw() {
 *     let r
 *
 *     let ftp = WFtp()
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn({
 *         hostname: `{hostname}`,
 *         port: `{port}`,
 *         username: `{username}`,
 *         password: `{password}`,
 *     })
 *
 *     let fps = await ftp.ls('.')
 *     console.log('ftp.ls', fps[0], fps.length)
 *
 *     r = await ftp.download('./DECL_20210805055044.csv', './_test_download_client/DECL_20210805055044.csv', (p) => {
 *         console.log('ftp.download p', p.name, p.progress)
 *     })
 *     console.log('ftp.download', r)
 *
 *     r = await ftp.syncToLocal('.', './_test_download_client', (p) => {
 *         console.log('ftp.syncToLocal p', p.name, p.progress)
 *     })
 *     console.log('ftp.syncToLocal', r)
 *
 *     r = await ftp.quit()
 *     console.log('ftp.quit', r)
 *
 * }
 * test_dw()
 *     .catch((err) => {
 *         console.log(err)
 *     })
 * // ftp.ls {
 * //   name: 'DECL_202108.csv',
 * //   type: 0,
 * //   time: 1658302140000,
 * //   size: '218690',
 * //   owner: 'ftp',
 * //   group: 'ftp',
 * //   userPermissions: { read: true, write: true, exec: false },
 * //   groupPermissions: { read: true, write: true, exec: false },
 * //   otherPermissions: { read: true, write: true, exec: false }
 * // } 74
 * // ftp.download p DECL_20210805055044.csv 4.7320871554333515
 * // ftp.download p DECL_20210805055044.csv 9.464174310866703
 * // ftp.download p DECL_20210805055044.csv 14.196261466300053
 * // ftp.download p DECL_20210805055044.csv 18.928348621733406
 * // ftp.download p DECL_20210805055044.csv 23.660435777166754
 * // ftp.download p DECL_20210805055044.csv 28.392522932600105
 * // ftp.download p DECL_20210805055044.csv 33.12461008803346
 * // ftp.download p DECL_20210805055044.csv 37.85669724346681
 * // ftp.download p DECL_20210805055044.csv 42.58878439890016
 * // ftp.download p DECL_20210805055044.csv 47.32087155433351
 * // ftp.download p DECL_20210805055044.csv 52.05295870976686
 * // ftp.download p DECL_20210805055044.csv 56.78504586520021
 * // ftp.download p DECL_20210805055044.csv 61.517133020633565
 * // ftp.download p DECL_20210805055044.csv 66.24922017606691
 * // ftp.download p DECL_20210805055044.csv 70.98130733150026
 * // ftp.download p DECL_20210805055044.csv 75.71339448693362
 * // ftp.download p DECL_20210805055044.csv 80.44548164236697
 * // ftp.download p DECL_20210805055044.csv 85.17756879780032
 * // ftp.download p DECL_20210805055044.csv 89.90965595323367
 * // ftp.download p DECL_20210805055044.csv 94.64174310866701
 * // ftp.download p DECL_20210805055044.csv 99.37383026410038
 * // ftp.download p DECL_20210805055044.csv 100
 * // ftp.download ok
 * // ftp.syncToLocal { num: 0, files: [] }
 * // ftp.quit { code: 221, text: '221 Goodbye.', isMark: false, isError: false }
 *
 */
function WFtp() {
    let t = this
    t._ = {
        doc_ftpConn: ftpConn,
        doc_ftpLs: ftpLs,
        doc_ftpQuit: ftpQuit,
        doc_ftpStateFile: ftpStateFile,
        doc_ftpCheckFile: ftpCheckFile,
        doc_ftpDownload: ftpDownload,
        doc_ftpUpload: ftpUpload,
        doc_ftpSyncToLocal: ftpSyncToLocal,
        doc_ftpSyncToRemote: ftpSyncToRemote,
    }

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
                    host: hostname, //hostname or ip
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


        async function ftpLs(fdRemote = '.') {

            //pm
            let pm = genPm()

            //check
            if (Ftp === null) {
                pm.reject(`FTP has not been initialized. please use 'conn' to construct FTP`)
                return pm
            }

            Ftp.ls(fdRemote, (err, res) => {
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
