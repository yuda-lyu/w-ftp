import get from 'lodash-es/get.js'
import CoreFTP from './CoreFTP.mjs'
import CoreSFTP from './CoreSFTP.mjs'


/**
 * 連線至FPT伺服器
 *
 * @return {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
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
async function conn() {
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
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
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
async function quit() {
    return null
}


/**
 * 遍歷伺服器上指定資料夾內檔案清單資訊
 *
 * @param {String} opt.fdRemote 輸入伺服器上指定資料夾字串
 * @return {Promise} 回傳Promise，resolve回傳檔案清單陣列，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
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
async function ls(fdRemote = '.') {
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
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
 *
 *     r = await ftp.isFile('./_test_upload_client/DECL_20210805055044.csv')
 *     console.log('ftp.isFile', r)
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
async function isFile(fpRemote) {
    return null
}


/**
 * 確認伺服器指定資料夾是否存在
 *
 * @param {String} opt.fpRemote 輸入伺服器上指定資料夾字串
 * @return {Promise} 回傳Promise，resolve回傳指定資料夾是否存在布林值，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
 *
 *     r = await ftp.isFolder('./_test_upload_client')
 *     console.log('ftp.isFolder', r)
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
async function isFolder(fpRemote) {
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
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
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
async function download(fpRemote, fpLocal, cbProcess = null) {
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
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
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
async function upload(fpLocal, fpRemote, cbProcess) {
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
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
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
async function syncToLocal(fdRemote, fdLocal, cbProcess) {
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
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
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
async function syncToRemote(fdLocal, fdRemote, cbProcess) {
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
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
 *
 *     r = await ftp.stat('./_test_upload_client/DECL_20210805055044.csv')
 *     console.log('ftp.stat', r)
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
async function stat(fpRemote) {
    return null
}


/**
 * 伺服器創建資料夾
 *
 * @param {String} opt.fpRemote 輸入伺服器上待創建資料夾字串
 * @return {Promise} 回傳Promise，resolve回傳創建資訊，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
 *
 *     r = await ftp.mkdir('./_test_upload_client')
 *     console.log('ftp.mkdir', r)
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
async function mkdir(fpRemote) {
    return null
}


/**
 * 伺服器變更工作路徑資料夾
 *
 * @param {String} opt.fpRemote 輸入伺服器上欲指定之工作路徑資料夾字串
 * @return {Promise} 回傳Promise，resolve回傳變更資訊，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
 *
 *     r = await ftp.cwd('./_test_upload_client')
 *     console.log('ftp.cwd', r)
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
async function cwd(fpRemote) {
    return null
}


/**
 * 取得伺服器工作路徑資料夾
 *
 * @return {Promise} 回傳Promise，resolve回傳工作路徑資料夾字串，reject回傳錯誤訊息
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test() {
 *     let r
 *
 *     let ftp = WFtp({
 *         transportation: 'FTP', //'FTP', 'SFTP'
 *         hostname: st.hostname,
 *         port: st.port,
 *         username: st.username,
 *         password: st.password,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
 *
 *     r = await ftp.pwd()
 *     console.log('ftp.pwd', r)
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
async function pwd(fpRemote) {
    return null
}


/**
 * 操作FTP，包含連線、下載、資料夾內檔案同步下載、上傳、資料夾內檔案同步上傳等功能
 *
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.transportation='FTP'] 輸入傳輸協定字串，可選'FTP'、'SFTP'，預設'FTP'
 * @param {String} [opt.hostname=''] 輸入hostname字串，預設''
 * @param {Integer} [opt.port=21|22] 輸入port正整數，當transportation='FTP'預設21，當transportation='SFTP'預設22
 * @param {String} [opt.username=''] 輸入帳號字串，預設''
 * @param {String} [opt.password=''] 輸入密碼字串，預設''
 * @returns {Object} 回傳FTP操作物件，包含conn、ls、stat、isFile、download、syncToLocal、syncToRemote、upload、quit。
 * @example
 * import WFtp from './src/WFtp.mjs'
 *
 * async function test_dw() {
 *     let r
 *
 *     let ftp = WFtp({
 *         hostname: `{hostname}`,
 *         port: `{port}`,
 *         username: `{username}`,
 *         password: `{password}`,
 *     })
 *     // console.log('ftp', ftp)
 *
 *     await ftp.conn()
 *
 *     async function core() {
 *
 *         let fps = await ftp.ls('.')
 *         console.log('ftp.ls', fps[0], fps.length)
 *
 *         r = await ftp.download('./DECL_20210805055044.csv', './_test_download_client/DECL_20210805055044.csv', (p) => {
 *             console.log('ftp.download p', p.name, p.progress)
 *         })
 *         console.log('ftp.download', r)
 *
 *         r = await ftp.syncToLocal('.', './_test_download_client', (p) => {
 *             console.log('ftp.syncToLocal p', p.name, p.progress)
 *         })
 *         console.log('ftp.syncToLocal', r)
 *
 *     }
 *     await core()
 *         .catch((err) => {
 *             console.log(err)
 *         })
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
 *     async function core() {
 *
 *         let fps = await ftp.ls('.')
 *         console.log('ftp.ls', fps[0], fps.length)
 *
 *         r = await ftp.upload('./_test_upload_client/DECL_20210805055044.csv', './DECL_20210805055044.csv', (p) => {
 *             console.log('ftp.upload p', p.name, p.progress)
 *         })
 *         console.log('ftp.upload', r)
 *
 *         r = await ftp.syncToRemote('./_test_upload_client', '.', (p) => {
 *             console.log('ftp.syncToRemote p', p.name, p.progress)
 *         })
 *         console.log('ftp.syncToRemote', r)
 *
 *     }
 *     await core()
 *         .catch((err) => {
 *             console.log(err)
 *         })
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
 * // ftp.upload p DECL_20210805055044.csv 100
 * // ftp.upload ok
 * // ftp.syncToRemote { num: 0, files: [] }
 * // ftp.quit { code: 221, text: '221 Goodbye.', isMark: false, isError: false }
 *
 */
function WFtp(opt = {}) {

    //transportation
    let transportation = get(opt, 'transportation', 'FTP')
    if (transportation !== 'FTP' && transportation !== 'SFTP') {
        throw new Error(`transportation[${transportation}] is not FTP or SFTP`)
    }

    //ftp
    let ftp = null
    if (transportation === 'FTP') {
        ftp = new CoreFTP(opt)
    }
    else if (transportation === 'SFTP') {
        ftp = new CoreSFTP(opt)
    }
    // console.log('ftp', ftp)

    //add doc, 強制函數關聯至WFTP, 使能由外部虛擬函數自動產生doc
    let doc = {
        doc_conn: conn,
        doc_quit: quit,
        doc_ls: ls,
        doc_isFile: isFile,
        doc_isFolder: isFolder,
        doc_download: download,
        doc_upload: upload,
        doc_syncToLocal: syncToLocal,
        doc_syncToRemote: syncToRemote,
        doc_stat: stat,
        doc_mkdir: mkdir,
        doc_cwd: cwd,
        doc_pwd: pwd,
    }
    ftp.__doc___ = doc

    return ftp
}


export default WFtp
