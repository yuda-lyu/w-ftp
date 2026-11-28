import get from 'lodash-es/get.js'
import CoreFTP from './CoreFTP.mjs'
import CoreSFTP from './CoreSFTP.mjs'


/**
 * 連線至FPT伺服器
 *
 * 連線可用(FTP為收到伺服器歡迎訊息220，SFTP為完成連線並開啟SFTP通道)才resolve，並以WFtp之opt.timeLimit計時；連不上時以固定訊息reject(`ftpConn: can not connect to the server (<code>)`，逾時為`ftpConn timeout[timeLimit]`)，不會造成未捕捉例外，<code>為Node錯誤碼、FTP回應碼或'AUTHENTICATION'、'HANDSHAKE_TIMEOUT'、'CLOSED'、'UNKNOWN'。conn尚未完成即呼叫之操作會等待其完成；conn失敗後實例視為未連線(quit仍可呼叫)。
 * 連線建立後之中斷與重新連線見README之Connection behavior。conn會重設以cwd切換之工作資料夾。
 *
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到凍結之事件物件{ type, ... }，type為'connect'({ ok, code })、'timeout'({ timeLimit, stage: 'connect' })；回調之拋錯與rejection皆忽略，預設null
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
async function conn(opt = {}) {
    return null
}


/**
 * 關閉與伺服器連線
 *
 * 已中斷之連線僅清理並resolve'ok'(不另建連線)；FTP送出QUIT並回傳伺服器回應，SFTP待連線關閉後resolve'ok'；伺服器未於WFtp之opt.timeLimit內回覆或關閉時硬關閉連線並reject(`ftpQuit timeout[timeLimit]`)。進行中之重新連線一併取消。
 *
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到'timeout'({ timeLimit, stage: 'quit' })事件，預設null
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
async function quit(opt = {}) {
    return null
}


/**
 * 遍歷伺服器上指定資料夾內檔案清單資訊
 *
 * 以WFtp之opt.timeLimit計時，到時reject(`ftpLs timeout[timeLimit]`)並銷毀本次所用之連線；控制連線於回覆前中斷即reject(`ftpLs: the connection to the server is closed (<code>)`)。下一個操作自動重新連線(SFTP限由本套件銷毀者)。
 *
 * @param {String} opt.fdRemote 輸入伺服器上指定資料夾字串
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到'reconnect'({ ok })與'timeout'({ timeLimit, stage: 'ls' })事件，預設null
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
async function ls(fdRemote = '.', opt = {}) {
    return null
}


/**
 * 確認伺服器指定檔案是否存在
 *
 * 伺服器回應查無資料時resolve false；連線中斷與逾時(WFtp之opt.timeLimit)則reject(逾時訊息見stat)，並銷毀本次所用之連線。
 *
 * @param {String} opt.fpRemote 輸入伺服器上指定檔案字串
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到'reconnect'({ ok })與'timeout'({ timeLimit, stage: 'stat' })事件，預設null
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
async function isFile(fpRemote, opt = {}) {
    return null
}


/**
 * 確認伺服器指定資料夾是否存在
 *
 * 伺服器回應查無資料時resolve false；連線中斷與逾時(WFtp之opt.timeLimit)則reject(逾時訊息見stat)，並銷毀本次所用之連線。
 *
 * @param {String} opt.fpRemote 輸入伺服器上指定資料夾字串
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到'reconnect'({ ok })與'timeout'({ timeLimit, stage: 'stat' })事件，預設null
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
async function isFolder(fpRemote, opt = {}) {
    return null
}


/**
 * 下載伺服器指定檔案至本機
 *
 * 先寫入下載暫存區(opt.fdDownloadTemp)內本次專用之暫存檔(`<檔名>.<行程id>.<隨機碼>.part`，以排他方式建立，同一暫存區由多個實例共用或遠端檔名相同皆不相撞)，
 * 傳輸成功結束且本地大小等於遠端大小才移至fpLocal(取代舊檔)；與fpLocal同一磁碟時以改名一步取代，跨磁碟時先複製至fpLocal同資料夾之暫存名(`<檔名>.<行程id>.<隨機碼>.part`)再於同資料夾內改名；檔名超過150位元組者，暫存名中之檔名基底以碼點截短(使暫存名不超過255位元組)；
 * 遠端大小無法取得(FTP之SIZE指令失敗)時無從核對是否下載完整，直接reject(`can not get the size of file[fpRemote]`)而不傳輸；fpLocal為既有資料夾時於傳輸前即reject(`ftpDownload: fpLocal is a directory, fpLocal is not changed`)；改名遇占用(EPERM、EBUSY、EACCES，Windows下常為防毒掃描)時最多嘗試5次(每次失敗後等待200毫秒乘嘗試次數)，用盡仍失敗即刪除暫存檔並reject。
 * 暫存區內逾24小時未更新、符合上述暫存檔名格式、行程id對應之行程已不存在者(本行程與他行程仍存在者皆不清)，視為崩潰殘留，由本行程於首次使用該暫存區時清除(之後同一行程最多每小時清一次)；不符格式之檔不動。
 * 傳輸失敗(含連線中斷)、逾時、大小不符或無法移動時，刪除暫存檔並reject，fpLocal之舊檔不動(不存在者仍不存在)。
 * 逾時自傳輸開始起計(WFtp之opt.timeLimit，預設60000毫秒，SFTP亦受其約束，大檔須自行給較大值)，到時即reject(訊息`ftpDownload timeout[timeLimit]`)並刪除暫存檔名；查詢遠端檔案資訊之階段另受同一timeLimit約束，伺服器於該階段停滯時同樣逾時。逾時時銷毀本次所用之連線(FTP含數據socket；SFTP以此中止fastGet)，同一連線上同時進行之其他操作一併失敗；下一個操作自動重新連線，故逾時後可直接重試同一檔(暫存檔名每次唯一)。
 *
 * @param {String} opt.fpRemote 輸入伺服器上指定檔案字串
 * @param {String} opt.fpLocal 輸入本機指定檔案字串
 * @param {Function} [opt.cbProcess=null] 輸入回調進度函數
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {String} [opt.opt.fdDownloadTemp] 輸入本次下載之暫存區資料夾字串，不含NUL字元之非空字串才採用，未給或非預期之輸入(非字串、空字串、含NUL等)視為未給而用WFtp之opt.fdDownloadTemp
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到凍結之事件物件{ type, ... }，type為'reconnect'({ ok })、'sweep'({ removed })、'temp'({ act: 'create'或'remove', ok })、'timeout'({ timeLimit, stage: 'stat'或'transfer' })、'transfer'({ ok, late })、'verify'({ ok, size, sizeRemote })、'retry'({ n, code })、'move'({ mode: 'rename'或'copy' })；逾時後之'transfer'(late為true)與'temp'(act為'remove')於reject之後才發生；回調之拋錯與rejection皆忽略，預設null
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
async function download(fpRemote, fpLocal, cbProcess = null, opt = {}) {
    return null
}


/**
 * 上傳本機指定檔案至伺服器
 *
 * 先寫入遠端目標同一資料夾之本次專用暫存名(`<檔名>.<行程id>.<8碼隨機碼>.part`，檔名超過150位元組者基底以碼點截短)，傳輸成功結束且遠端暫存大小等於本機大小(本機大小於傳輸期間亦未改變)才改名為fpRemote；
 * 傳輸失敗(含連線中斷)、逾時、大小不符、本機檔改變或改名失敗時，刪除遠端暫存並reject，fpRemote之舊檔不動。FTP以串流讀本機檔(不整檔讀入記憶體)，不改變工作目錄；多層資料夾自動建立。
 *
 * 改名：SFTP用posix-rename@openssh.com擴充覆蓋(原子)，伺服器未支援或拒絕時改用一般rename；FTP用RNFR/RNTO。伺服器之rename不覆蓋既有檔時(部分FTP伺服器、無該擴充之SFTP伺服器)，改依序「舊檔改為暫存名(`<檔名>.<行程id>.<隨機碼>.old`)、暫存改為fpRemote、刪除舊檔暫名」，此時非原子(兩次改名之間fpRemote不存在)，中途失敗會嘗試把舊檔改回。
 * 伺服器須允許改名與刪除；不允許改名者reject(`ftpUpload: can not rename the temporary file to fpRemote (<code>), fpRemote is not changed`)，新內容已就位但舊檔暫名刪不掉者reject(`ftpUpload: fpRemote is updated, but can not remove the old file kept under a temporary name in the same folder`)。
 *
 * 失敗訊息(固定詞彙，不含路徑與伺服器訊息)：傳輸本身之錯誤且暫存已清除時沿用原錯誤；暫存刪不掉者訊息後綴`, can not remove the remote temporary file`(傳輸錯誤改為`ftpUpload: transfer failed (<code>), ...`)；大小不符`ftpUpload: uploaded size[N] does not match local size[M], fpRemote is not changed`；本機檔改變`ftpUpload: fpLocal was changed during upload, fpRemote is not changed`；查不到暫存大小`ftpUpload: can not get the size of the uploaded temporary file (<code>), fpRemote is not changed`(FTP伺服器不支援SIZE者上傳一律如此)；交換退路中舊檔仍(或可能仍)以暫名保留者訊息含`the old file of fpRemote is kept under a temporary name in the same folder`(或`may be kept`)。
 *
 * 逾時：建立資料夾、傳輸、核對大小、改名各階段分別以WFtp之opt.timeLimit計時(傳輸自開始起計，大檔須自行給較大值)，到時中止(銷毀本次所用之連線，FTP含數據socket，不再送出資料)、以同一設定重新連線(FTP重放曾成功之cwd)、刪除暫存後reject(`ftpUploadCore timeout[timeLimit]`；改名階段為`ftpUploadCore timeout[timeLimit] while renaming, fpRemote may or may not be updated`)；清理、還原與重新連線各步以min(timeLimit, 10000)毫秒為限。
 * 中止會一併中斷同一實例上同時進行之其他操作(如併發之下載)；使用者已quit者不重新連線。控制連線於上傳開始前已中斷者，FTP先重新連線並重放cwd(失敗訊息見README之Connection behavior)；SFTP由伺服器斷線者沿用上傳之失敗處置(本次reject，其後實例重新連線)。行程崩潰或連線無法恢復而殘留之遠端暫存名不會自動清除。目標既有檔之權限與擁有者不保留(新檔依伺服器預設)；目標為符號連結者改由新檔取代該連結。
 *
 * @param {String} opt.fpLocal 輸入本機指定檔案字串
 * @param {String} opt.fpRemote 輸入伺服器上指定檔案字串
 * @param {Function} [opt.cbProcess=null] 輸入回調進度函數，收到{ progress, name, fpRemote, fpLocal }，progress為已送出位元組之百分比；逾時後不再通知，回調拋錯忽略
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到凍結之事件物件{ type, ... }，type為'timeout'({ timeLimit, stage: 'prepare'、'transfer'、'verify'、'rename'、'clean'或'reconnect' })、'transfer'({ ok, late })、'verify'({ ok, size, sizeLocal })、'temp'({ act: 'remove', ok, kind: 'part'或'old' })、'move'({ mode: 'posix'、'rename'或'swap' })、'reconnect'({ ok })；逾時後之'transfer'(late為true)可能於reject之後才發生；回調之拋錯與rejection皆忽略，預設null
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
async function upload(fpLocal, fpRemote, cbProcess = null, opt = {}) {
    return null
}


/**
 * 同步伺服器上指定資料夾內檔案至本機
 *
 * 各檔依序以download下載(先寫入暫存區，完成才移至本機資料夾)，某檔失敗即reject，其後之檔不再下載，已下載者保留，失敗之檔維持舊檔
 *
 * @param {String} opt.fdRemote 輸入伺服器上指定資料夾字串
 * @param {String} opt.fdLocal 輸入本機指定資料夾字串
 * @param {Function} [opt.cbProcess=null] 輸入回調進度函數
 * @param {Object} [opt.opt={}] 輸入設定物件，預設{}
 * @param {Integer} [opt.opt.levelLimit=null] 輸入同步之資料夾層數正整數，非正整數視為不限層數，預設null
 * @param {Boolean} [opt.opt.forceOverwriteWhenSync=false] 輸入是否不論大小一律重新下載布林值，預設false
 * @param {String} [opt.opt.fdDownloadTemp] 輸入下載暫存區資料夾字串，轉交download，見download
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，轉交列舉遠端資料夾與各檔之download(列舉階段之事件見ls)，預設null
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
async function syncToLocal(fdRemote, fdLocal, cbProcess, opt = {}) {
    return null
}


/**
 * 同步本機指定資料夾內檔案至伺服器
 *
 * 各檔依序以upload上傳(先寫入遠端暫存名，完成且大小相符才改名)，某檔失敗即reject，其後之檔不再上傳，已上傳者保留，失敗之檔維持舊檔
 *
 * @param {String} opt.fdLocal 輸入本機指定資料夾字串
 * @param {String} opt.fdRemote 輸入伺服器上指定資料夾字串
 * @param {Function} [opt.cbProcess=null] 輸入回調進度函數
 * @param {Object} [opt.opt={}] 輸入設定物件，預設{}
 * @param {Integer} [opt.opt.levelLimit=null] 輸入同步之資料夾層數正整數，非正整數視為不限層數，預設null
 * @param {Boolean} [opt.opt.forceOverwriteWhenSync=false] 輸入是否不論大小一律重新上傳布林值，預設false
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，轉交列舉遠端資料夾與各檔之upload(列舉階段之事件見ls)，預設null
 * @return {Promise} 回傳Promise，resolve回傳成功訊息{ num, files }，reject回傳錯誤訊息
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
async function syncToRemote(fdLocal, fdRemote, cbProcess, opt = {}) {
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
async function stat(fpRemote, opt = {}) {
    return null
}


/**
 * 伺服器創建資料夾
 *
 * 輸入為檔案路徑：建立其逐層父資料夾(最後一段視為檔名，不建立)；絕對路徑建於該絕對位置，'..'與'.'起首之名稱原樣使用，相對路徑以目前工作資料夾為準。各指令以WFtp之opt.timeLimit計時，到時reject(FTP為`ftpRaw[<指令>] timeout[timeLimit]`，SFTP為`ftpMkdir timeout[timeLimit]`)並銷毀本次所用之連線。
 *
 * @param {String} opt.fpRemote 輸入伺服器上檔案路徑字串，建立其父資料夾
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到'reconnect'({ ok })與'timeout'({ timeLimit, stage: 'mkdir' })事件，預設null
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
 *     r = await ftp.mkdir('./_test_upload_client/DECL_20210805055044.csv') //建立資料夾_test_upload_client
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
async function mkdir(fpRemote, opt = {}) {
    return null
}


/**
 * 伺服器變更工作路徑資料夾
 *
 * FTP送出CWD指令並回傳伺服器回應，成功之cwd於重新連線時依序重放，無法重放時reject(須重新conn)。
 * SFTP協定無工作資料夾，由本套件保存：目標存在且為資料夾時resolve其絕對路徑字串，其後各操作之相對路徑以其解析；目標不存在或非資料夾時reject(`ftpCwd: can not change the working directory, fpRemote is not a folder`)。conn重設工作資料夾。
 * 以WFtp之opt.timeLimit計時，到時reject並銷毀本次所用之連線。
 *
 * @param {String} opt.fpRemote 輸入伺服器上欲指定之工作路徑資料夾字串
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到'reconnect'({ ok })與'timeout'({ timeLimit, stage: 'cwd' })事件，預設null
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
async function cwd(fpRemote, opt = {}) {
    return null
}


/**
 * 取得伺服器工作路徑資料夾
 *
 * FTP送出PWD指令並resolve伺服器回應物件；SFTP resolve目前工作資料夾絕對路徑字串(未曾cwd者為登入資料夾)。以WFtp之opt.timeLimit計時，到時reject並銷毀本次所用之連線。
 *
 * @param {Object} [opt.opt={}] 輸入單次呼叫之設定物件，預設{}
 * @param {Function} [opt.opt.onTrace=null] 輸入觀察回調函數，收到'reconnect'({ ok })與'timeout'({ timeLimit, stage: 'pwd' })事件，預設null
 * @return {Promise} 回傳Promise，resolve回傳工作路徑資料夾(FTP為伺服器回應物件，SFTP為字串)，reject回傳錯誤訊息
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
async function pwd(opt = {}) {
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
 * @param {Integer} [opt.timeLimit=60000] 輸入各操作(含conn、quit、ls、stat、isFile、isFolder、mkdir、cwd、pwd與重新連線)之逾時毫秒數字，到時reject並銷毀本次所用之連線；下載為每檔自傳輸開始起計(查詢遠端檔案資訊之階段另計)，上傳為建立資料夾、傳輸、核對大小、改名各階段分別計時(見upload)，大檔須自行給較大值；0與負數視為未給，改用預設；超過2147483647(約24.8天)者以其為上限，預設60000
 * @param {String} [opt.fdDownloadTemp='./_wftpDownloadTemp'] 輸入下載暫存區資料夾字串，下載中之檔先寫入此處，完成才移至目標，於建構時轉為絕對路徑(相對路徑以當時之cwd為準)，不存在時自動建立；非預期之輸入(非字串、空字串、含NUL等)視為未給而用預設；勿設於syncToLocal之本機資料夾內，預設'./_wftpDownloadTemp'
 * @returns {Object} 回傳FTP操作物件，包含conn、ls、stat、isFile、isFolder、download、syncToLocal、syncToRemote、upload、mkdir、cwd、pwd、quit。
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
