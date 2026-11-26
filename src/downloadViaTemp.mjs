import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import genPm from 'wsemi/src/genPm.mjs'
import genID from 'wsemi/src/genID.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import delay from 'wsemi/src/delay.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'


//fdTempDefault, 下載暫存區之預設資料夾(相對於建構WFtp時之cwd)
let fdTempDefault = './_wftpDownloadTemp'

//nReserve, 保留暫存檔名之嘗試次數, 同名檔已存在(EEXIST)時換名重試
let nReserve = 5

//nRename, msRename, 改名遇占用(Windows防毒掃描等)之有界重試: 最多嘗試nRename次, 第i次失敗後等待msRename*i毫秒(共約2秒, 比照wsemi fsDownloadFileVerify之改名重試)
let nRename = 5
let msRename = 200

//nStemBytes, 暫存檔名取自目標檔名之基底最多位元組數(UTF-8), 超過者以碼點為單位截短, 使加上.<行程id>.<隨機碼>.part後不超出檔名長度上限(多數檔案系統為255位元組)
let nStemBytes = 150

//msTimerMax, setTimeout可接受之最大毫秒(超過者Node會當作1毫秒而立即觸發), timeLimit超過時以此為上限(約24.8天)
let msTimerMax = 2147483647

//codesBusy, 視為占用而可重試之錯誤碼
let codesBusy = ['EPERM', 'EBUSY', 'EACCES']

//msStale, 暫存區內逾此時間(毫秒)未更新, 且為本套件命名格式之暫存檔才視為崩潰殘留而清除
let msStale = 24 * 60 * 60 * 1000

//msSweepGap, 同一行程對同一暫存區之殘留清理最短間隔(毫秒), 避免每次下載皆列舉暫存區
let msSweepGap = 60 * 60 * 1000

//reTemp, 本套件暫存檔名格式: <目標檔名>.<行程id>.<8碼隨機碼>.part
let reTemp = /^.+\.(\d+)\.[0-9A-Za-z]{8}\.part$/

//sweepAt, 各暫存區(絕對路徑)最近一次殘留清理時刻(毫秒)
let sweepAt = new Map()


//codeOf, 取Node錯誤之code(固定詞彙), 不取message(其內含路徑), 取不到回'UNKNOWN'
function codeOf(err) {
    try {
        let c = get(err, 'code', '')
        return isestr(c) ? c : 'UNKNOWN'
    }
    catch (e) {
        return 'UNKNOWN'
    }
}


//readKey, 讀opt之鍵, opt非物件或讀取拋錯(存取器、已撤銷之Proxy)皆視為未給
function readKey(opt, key) {
    try {
        if ((typeof opt === 'object' && opt !== null) || typeof opt === 'function') {
            return opt[key]
        }
    }
    catch (err) {}
    return undefined
}


//traceOf, 取單次呼叫opt之觀察回調(onTrace), 非函數或讀取拋錯時回傳null
function traceOf(optCall) {
    try {
        return getTrace({ onTrace: readKey(optCall, 'onTrace') })
    }
    catch (err) {
        return null
    }
}


/**
 * 解析下載暫存區資料夾, 為opt類參數: 不含NUL字元之非空字串才採用並轉絕對路徑(相對於當下cwd), 其餘(undefined、null、''、非字串、包裝物件、含NUL)視為未給而用def
 *
 * @param {*} v 輸入原值
 * @param {String} def 輸入預設資料夾字串(已為絕對路徑或相對路徑皆可)
 * @returns {String} 回傳資料夾絕對路徑字串
 */
function resolveFdTemp(v, def) {
    if (isestr(v) && v.indexOf('\0') < 0) {
        return path.resolve(v)
    }
    return path.resolve(def)
}


//tempStem, 取暫存檔名之基底(目標檔名): 不超過nStemBytes位元組者原樣使用, 否則以碼點為單位截短
function tempStem(name) {
    if (Buffer.byteLength(name, 'utf8') <= nStemBytes) {
        return name
    }
    let cs = Array.from(name)
    while (cs.length > 1 && Buffer.byteLength(cs.join(''), 'utf8') > nStemBytes) {
        cs.pop()
    }
    return cs.join('')
}


//isDir, 路徑是否為既有資料夾(不存在或無法判定回false)
function isDir(fp) {
    try {
        return fs.statSync(fp).isDirectory()
    }
    catch (err) {
        return false
    }
}


//reserveTemp, 於fdTemp以排他方式(wx)建立本次專用之暫存檔, 檔名含行程id與隨機碼, 同一暫存區由多個實例或多個行程共用、或遠端檔名相同時皆不相撞
function reserveTemp(fdTemp, fpLocal) {
    fs.mkdirSync(fdTemp, { recursive: true })
    let name = tempStem(path.basename(fpLocal))
    let errLast = null
    for (let i = 0; i < nReserve; i++) {
        let fp = path.join(fdTemp, `${name}.${process.pid}.${genID(8)}.part`)
        try {
            let fd = fs.openSync(fp, 'wx')
            fs.closeSync(fd)
            return fp
        }
        catch (err) {
            errLast = err
            if (codeOf(err) !== 'EEXIST') {
                break
            }
        }
    }
    throw errLast
}


//removeTemp, 刪除暫存檔, 已不存在視為成功, 回傳是否成功
async function removeTemp(fp) {
    try {
        await fs.promises.unlink(fp)
        return true
    }
    catch (err) {
        return codeOf(err) === 'ENOENT'
    }
}


//isAlive, 行程id是否仍存在(無法判定時視為存在, 取不清除之安全側)
function isAlive(pid) {
    if (!(pid > 0)) {
        return true
    }
    try {
        process.kill(pid, 0)
        return true
    }
    catch (err) {
        return codeOf(err) !== 'ESRCH'
    }
}


//sweepStale, 清除暫存區內崩潰殘留之暫存檔: 只清本套件命名格式、逾msStale未更新、其行程id對應之行程已不存在者(本行程與他行程仍存在者皆不清), 故不會清到他行程正在寫入之檔;
//  同一行程對同一暫存區最短相隔msSweepGap才清一次; 暫存區不存在或任何一檔處理失敗皆略過, 不影響下載
async function sweepStale(fdTemp, trace) {
    let now = Date.now()
    let last = sweepAt.get(fdTemp)
    if (last !== undefined && now - last < msSweepGap) {
        return
    }
    sweepAt.set(fdTemp, now)
    let removed = 0
    let names = []
    try {
        names = await fs.promises.readdir(fdTemp)
    }
    catch (err) {}
    for (let name of names) {
        let m = reTemp.exec(name)
        if (m === null) {
            continue
        }
        let pid = Number(m[1])
        let fp = path.join(fdTemp, name)
        try {
            let st = await fs.promises.stat(fp)
            if (!st.isFile() || now - st.mtimeMs < msStale || isAlive(pid)) {
                continue
            }
            await fs.promises.unlink(fp)
            removed++
        }
        catch (err) {}
    }
    if (trace) {
        trace('sweep', { removed })
    }
}


//renameRetry, 改名並於遇占用(EPERM、EBUSY、EACCES)時有界重試, 其餘錯誤(含EXDEV)或重試用盡即拋出最後之錯誤
async function renameRetry(fpFrom, fpTo, trace) {
    for (let i = 1; i <= nRename; i++) {
        try {
            await fs.promises.rename(fpFrom, fpTo)
            return
        }
        catch (err) {
            let code = codeOf(err)
            if (codesBusy.indexOf(code) < 0 || i >= nRename) {
                throw err
            }
            if (trace) {
                trace('retry', { n: i, code })
            }
            await delay(msRename * i)
        }
    }
}


//moveToTarget, 將已核對之暫存檔移至fpLocal(覆蓋舊檔), 回傳'rename'或'copy'
//  同一磁碟: rename一步取代舊檔, 失敗時舊檔不動; 遇占用有界重試
//  跨磁碟(EXDEV): 先複製至fpLocal同資料夾之暫存名(`<目標檔名>.<pid>.<隨機碼>.part`, 與wsemi fsDownloadFileVerify同格式; 檔名過長時基底截短), 再於同資料夾內rename取代舊檔(同樣有界重試);
//    任一步失敗即刪除該暫存名並拋錯, 舊檔不動; 暫存區之檔由呼叫端刪除
//  fpLocal為資料夾時直接拋EISDIR, 不重試
async function moveToTarget(fpTemp, fpLocal, trace) {
    if (isDir(fpLocal)) {
        let err = new Error('fpLocal is a directory')
        err.code = 'EISDIR'
        throw err
    }
    try {
        await renameRetry(fpTemp, fpLocal, trace)
        return 'rename'
    }
    catch (err) {
        if (codeOf(err) !== 'EXDEV') {
            throw err
        }
    }
    let fpStage = path.join(path.dirname(fpLocal), `${tempStem(path.basename(fpLocal))}.${process.pid}.${genID(8)}.part`)
    let staged = false
    try {
        await fs.promises.copyFile(fpTemp, fpStage, fs.constants.COPYFILE_EXCL)
        staged = true
        await renameRetry(fpStage, fpLocal, trace)
    }
    catch (err) {
        if (staged || codeOf(err) !== 'EEXIST') { //複製時即因同名已存在(EEXIST)失敗者, 該檔非本次建立, 不刪
            await removeTemp(fpStage)
        }
        throw err
    }
    return 'copy'
}


/**
 * 為單一階段加上逾時: 到時即reject(`ftpDownload timeout[timeLimit]`), 階段先結束則清除計時器並照其結果結束; 逾時後該階段之結果不再採用
 *
 * 供下載流程中不經暫存檔之階段(如SFTP查詢遠端檔案資訊)使用, 使伺服器於該階段停滯時不致永不結束; 逾時發出觀察事件'timeout'({ timeLimit, stage })
 *
 * @param {Object} o 輸入設定物件
 * @param {Function} o.run 輸入執行該階段之函數, 回傳Promise或值
 * @param {Integer} o.timeLimit 輸入逾時毫秒
 * @param {String} o.stage 輸入階段名稱字串, 供觀察事件使用
 * @param {*} o.optCall 輸入單次呼叫之opt, 取onTrace
 * @returns {Promise} 回傳Promise, resolve該階段之結果, reject該階段之錯誤或逾時訊息
 */
function withTimeLimit(o) {
    let { run, timeLimit, stage, optCall } = o
    let trace = traceOf(optCall)
    let pm = genPm()
    let t = setTimeout(() => {
        if (trace) {
            trace('timeout', { timeLimit, stage })
        }
        pm.reject(`ftpDownload timeout[${timeLimit}]`)
    }, Math.min(timeLimit, msTimerMax))
    Promise.resolve()
        .then(run)
        .then(
            (v) => {
                clearTimeout(t)
                pm.resolve(v)
            },
            (err) => {
                clearTimeout(t)
                pm.reject(err)
            }
        )
    return pm
}


/**
 * 下載單一檔案之共用流程(SFTP與FTP共用, 單一擁有者): 先寫入暫存區之本次專用暫存檔, 傳輸成功結束且本地大小等於遠端大小才移至fpLocal; 失敗、逾時、大小不符皆刪除暫存檔並reject, fpLocal之舊檔不動
 *
 * 逾時: 自傳輸開始起計時timeLimit毫秒, 到時即reject(`ftpDownload timeout[timeLimit]`), 並呼叫傳輸端登記之中止函數(FTP為銷毀數據socket; SFTP無法中止, 傳輸可能於背景續行),
 * 其後傳輸結束時一律只刪暫存檔、不移至fpLocal; 暫存檔名每次唯一, 故逾時後重試同一檔不與背景傳輸相撞
 *
 * opt.onTrace事件(type): 'sweep'({ removed })、'temp'({ act: 'create'|'remove', ok })、'timeout'({ timeLimit, stage })、'transfer'({ ok, late })、'verify'({ ok, size, sizeRemote })、'retry'({ n, code })、'move'({ mode: 'rename'|'copy' });
 * 逾時後之'transfer'(late為true)與'temp'(act為'remove')於promise已reject後才發生, 供得知背景傳輸已結束且暫存檔已清
 *
 * @param {Object} o 輸入設定物件
 * @param {String} o.fpLocal 輸入本機目標檔案路徑字串
 * @param {Integer} o.fileSize 輸入遠端檔案大小(位元組)
 * @param {Integer} o.timeLimit 輸入逾時毫秒
 * @param {String} o.fdTempInst 輸入實例層級之暫存區資料夾絕對路徑字串
 * @param {*} o.optCall 輸入單次呼叫之opt, 取fdDownloadTemp與onTrace
 * @param {Function} o.transfer 輸入傳輸函數(fpTemp, ctl), 回傳Promise, 傳輸成功結束才resolve; ctl.setAbort(fn)登記逾時時呼叫之中止函數, ctl.active()於逾時後回傳false
 * @returns {Promise} 回傳Promise, resolve回傳'ok', reject回傳錯誤
 */
async function downloadViaTemp(o) {
    let { fpLocal, fileSize, timeLimit, fdTempInst, optCall, transfer } = o

    //pm
    let pm = genPm()

    //trace, opt.onTrace非函數或讀取拋錯時為null
    let trace = traceOf(optCall)

    //fdTemp, 單次呼叫之opt.fdDownloadTemp優先, 否則用實例層級
    let fdTemp = resolveFdTemp(readKey(optCall, 'fdDownloadTemp'), fdTempInst)

    //fpLocalAbs, 於任何await前固定絕對路徑, 避免等待期間cwd被改動
    let fpLocalAbs = path.resolve(fpLocal)

    //check, fpLocal為既有資料夾者不可能移入, 傳輸前即失敗(省去整檔傳輸)
    if (isDir(fpLocalAbs)) {
        pm.reject(`ftpDownload: fpLocal is a directory, fpLocal is not changed`)
        return pm
    }

    //sweepStale, 清除崩潰殘留(不拋錯)
    await sweepStale(fdTemp, trace)

    //reserveTemp
    let fpTemp = null
    try {
        fpTemp = reserveTemp(fdTemp, fpLocalAbs)
    }
    catch (err) {
        if (trace) {
            trace('temp', { act: 'create', ok: false })
        }
        pm.reject(`ftpDownload: can not create a temporary file in fdDownloadTemp (${codeOf(err)}), fpLocal is not changed`)
        return pm
    }
    if (trace) {
        trace('temp', { act: 'create', ok: true })
    }

    //state
    let timedOut = false
    let abort = null

    //clean, 刪除暫存檔並發出事件
    let clean = async () => {
        let ok = await removeTemp(fpTemp)
        if (trace) {
            trace('temp', { act: 'remove', ok })
        }
    }

    //timeLimit, 到時即reject; 不刪除之後才寫入之內容, 由傳輸結束時之清理負責
    let t = setTimeout(() => {
        timedOut = true
        if (trace) {
            trace('timeout', { timeLimit, stage: 'transfer' })
        }
        if (isfun(abort)) {
            try {
                abort()
            }
            catch (err) {}
        }
        try {
            fs.unlinkSync(fpTemp) //先行刪除(檔案開啟中亦可), 背景傳輸結束時再確認刪除
        }
        catch (err) {}
        pm.reject(`ftpDownload timeout[${timeLimit}]`)
    }, Math.min(timeLimit, msTimerMax))

    //ctl
    let ctl = {
        setAbort: (fn) => {
            abort = fn
        },
        active: () => {
            return !timedOut
        },
    }

    //onSettle, 傳輸結束(成功或失敗)後之處置
    let onSettle = async (ok, errTransfer) => {
        clearTimeout(t)
        if (trace) {
            trace('transfer', { ok, late: timedOut })
        }

        //已逾時: 只清暫存檔, 不移至fpLocal(promise已reject)
        if (timedOut) {
            await clean()
            return
        }

        //傳輸失敗
        if (!ok) {
            await clean()
            pm.reject(errTransfer)
            return
        }

        //verify, 本地大小須等於遠端大小
        let size = -1
        try {
            size = fs.statSync(fpTemp).size
        }
        catch (err) {}
        let bSize = size === fileSize
        if (trace) {
            trace('verify', { ok: bSize, size, sizeRemote: fileSize })
        }
        if (!bSize) {
            await clean()
            pm.reject(`ftpDownload: downloaded size[${size}] does not match remote size[${fileSize}], fpLocal is not changed`)
            return
        }

        //moveToTarget
        let mode = ''
        try {
            mode = await moveToTarget(fpTemp, fpLocalAbs, trace)
        }
        catch (err) {
            await clean()
            pm.reject(`ftpDownload: can not move the downloaded file to fpLocal (${codeOf(err)}), fpLocal is not changed`)
            return
        }
        if (trace) {
            trace('move', { mode })
        }

        //copy時暫存區仍有原檔, 須刪除
        if (mode === 'copy') {
            await clean()
        }

        pm.resolve('ok')
    }

    //transfer, 同步拋錯亦轉為失敗
    let p
    try {
        p = Promise.resolve(transfer(fpTemp, ctl))
    }
    catch (err) {
        p = Promise.reject(err)
    }
    p.then(
        () => onSettle(true, null),
        (err) => onSettle(false, err),
    )
        .catch((err) => {
            pm.reject(err) //onSettle內已處理全部路徑, 此處僅防非預期之拋錯使promise永不結束
        })

    return pm
}


downloadViaTemp.fdTempDefault = fdTempDefault
downloadViaTemp.resolveFdTemp = resolveFdTemp
downloadViaTemp.withTimeLimit = withTimeLimit


export default downloadViaTemp
