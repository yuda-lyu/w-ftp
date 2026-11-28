import fs from 'fs'
import get from 'lodash-es/get.js'
import genPm from 'wsemi/src/genPm.mjs'
import genID from 'wsemi/src/genID.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import downloadViaTemp from './downloadViaTemp.mjs'


//msCleanMax, 失敗或逾時後之清理(含必要之重新連線、還原舊檔)每一步之時間上限毫秒, 實際上限為min(timeLimit, msCleanMax), 免清理使已逾時之上傳再久等
let msCleanMax = 10000

//sfxResidue, 遠端暫存檔刪不掉時之固定訊息後綴
let sfxResidue = `, can not remove the remote temporary file`

//msgKept, 舊檔仍以暫存名留於遠端(未能改回fpRemote)時之固定訊息; msgMayKept為無法確認時
let msgKept = `the old file of fpRemote is kept under a temporary name in the same folder`
let msgMayKept = `the old file of fpRemote may be kept under a temporary name in the same folder`


//codeOfRemote, 取遠端或Node錯誤之code(FTP回應碼與SFTP狀態碼為數字, 其餘為字串), 不取message(其內含路徑或伺服器原文), 取不到回'UNKNOWN'
function codeOfRemote(err) {
    try {
        let c = get(err, 'code')
        if (isestr(c) || (typeof c === 'number' && isnum(c))) {
            return String(c)
        }
        return 'UNKNOWN'
    }
    catch (e) {
        return 'UNKNOWN'
    }
}


//isReply, 錯誤是否為伺服器之回應(code為數字: FTP回應碼或SFTP狀態碼), 否則視為連線層級之錯誤(結果不明)
function isReply(err) {
    try {
        return typeof get(err, 'code') === 'number'
    }
    catch (e) {
        return false
    }
}


/**
 * 取得遠端同資料夾之暫存名: `<資料夾部分><檔名>.<行程id>.<8碼隨機碼>.<ext>`, 資料夾部分照原樣保留, 檔名過長時基底以碼點截短(同下載暫存檔)
 *
 * @param {String} fpRemote 輸入遠端檔案路徑字串
 * @param {String} ext 輸入副檔名字串
 * @returns {String|null} 回傳暫存名路徑; fpRemote之檔名部分為空、'.'或'..'(非檔案路徑)時回null
 */
function remoteSibling(fpRemote, ext) {
    let i = fpRemote.lastIndexOf('/')
    let name = fpRemote.slice(i + 1)
    if (name === '' || name === '.' || name === '..') {
        return null
    }
    return `${fpRemote.slice(0, i + 1)}${downloadViaTemp.tempStem(name)}.${process.pid}.${genID(8)}.${ext}`
}


//sizeOfLocal, 取本機檔大小, 取不到回-1
function sizeOfLocal(fp) {
    try {
        return fs.statSync(fp).size
    }
    catch (err) {
        return -1
    }
}


/**
 * 上傳單一檔案之共用流程(SFTP與FTP共用, 單一擁有者): 先寫入遠端同資料夾之本次專用暫存名, 傳輸成功結束且遠端暫存大小等於本機大小(本機大小亦未改變)才改名為fpRemote;
 * 任何失敗皆刪除遠端暫存(盡力而為, 刪不掉者記入reject訊息與onTrace), fpRemote之舊檔不動
 *
 * 改名: 傳輸端提供posixRename者先用之(原子覆蓋); 不支援或伺服器拒絕時改用rename; 仍被拒且fpRemote為既有檔案時(伺服器之rename不覆蓋), 依序把舊檔改為暫存名(`<檔名>.<行程id>.<隨機碼>.old`)、暫存改為fpRemote、刪除舊檔暫名(此退路非原子, 兩次改名之間fpRemote不存在);
 * 交換中途失敗(含連線錯誤、逾時)之還原見restoreStep: fpRemote不存在即把舊檔改回; 連線層級之錯誤不退回其他改名方式(結果不明)
 *
 * 逾時: 各階段(prepare: 建立遠端資料夾; transfer: 傳輸; verify: 查詢暫存大小; rename: 改名)各自以timeLimit計時, 到時呼叫adapter.abort()中止(銷毀該連線), 重新連線後清理, 再reject; 清理、還原與重新連線各步以min(timeLimit, 10000)為限;
 * 任何失敗於reject前確認連線可用(必要時重新連線)
 *
 * opt.onTrace事件(type): 'timeout'({ timeLimit, stage: 'prepare'|'transfer'|'verify'|'rename'|'clean'|'reconnect' })、'transfer'({ ok, late })、'verify'({ ok, size, sizeLocal })、'temp'({ act: 'remove', ok, kind: 'part'|'old' })、'move'({ mode: 'posix'|'rename'|'swap' })、'reconnect'({ ok })由adapter發出;
 * 逾時後之'transfer'(late為true)可能於promise已reject後才發生
 *
 * @param {Object} o 輸入設定物件
 * @param {String} o.fpLocal 輸入本機檔案路徑字串
 * @param {String} o.fpRemote 輸入遠端目標檔案路徑字串
 * @param {Integer} o.fileSize 輸入本機檔案大小(位元組)
 * @param {Integer} o.timeLimit 輸入逾時毫秒
 * @param {*} o.optCall 輸入單次呼叫之opt, 取onTrace
 * @param {Function} o.genAdapter 輸入產生傳輸端操作物件之函數(emit), 操作物件含 prepare(active)、put(fpTemp, active)、size(fp)、isFile(fp)、posixRename(from, to)(選用, 不支援回false)、rename(from, to)、remove(fp)、isAbsent(fp, err)、abort()、reconnect()
 * @returns {Promise} 回傳Promise，resolve回傳'ok'，reject回傳錯誤
 */
async function uploadViaTemp(o) {
    let { fpLocal, fpRemote, fileSize, timeLimit, optCall, genAdapter } = o

    //trace, opt.onTrace非函數或讀取拋錯時為null
    let trace = downloadViaTemp.traceOf(optCall)
    let emit = (type, data) => {
        if (trace) {
            trace(type, data)
        }
    }

    //fpTemp
    let fpTemp = remoteSibling(fpRemote, 'part')
    if (fpTemp === null) {
        return Promise.reject(`ftpUpload: fpRemote is not a file path, fpRemote is not changed`)
    }

    //adapter
    let adapter = genAdapter(emit)

    //msClean
    let msClean = Math.min(timeLimit, msCleanMax)

    //isTimeout
    let mkTimeout = () => {
        return { wftpTimeout: true }
    }
    let isTimeout = (e) => {
        return get(e, 'wftpTimeout') === true
    }

    //msgTimeout
    let msgTimeout = `ftpUploadCore timeout[${timeLimit}]`

    //stage, 以ms計時執行fn(active); 到時呼叫adapter.abort()中止並reject; 逾時後fn之結果不再採用, active()回false供多步驟者停止後續指令
    let stage = (name, ms, fn) => {
        let pm = genPm()
        let alive = true
        let t = setTimeout(() => {
            alive = false
            emit('timeout', { timeLimit: ms, stage: name })
            try {
                adapter.abort()
            }
            catch (err) {}
            pm.reject(mkTimeout())
        }, Math.min(ms, downloadViaTemp.msTimerMax))
        let settle = (ok, v) => {
            clearTimeout(t)
            if (name === 'transfer') {
                emit('transfer', { ok, late: !alive })
            }
            if (!alive) {
                return
            }
            if (ok) {
                pm.resolve(v)
            }
            else {
                pm.reject(v)
            }
        }
        new Promise((resolve) => {
            resolve(fn(() => alive))
        })
            .then((v) => settle(true, v), (err) => settle(false, err))
            .catch((err) => {
                pm.reject(err) //settle本身不拋錯, 此處僅防非預期使promise永不結束
            })
        return pm
    }

    //recover, 連線已中止者重新連線(未中止者reconnect不做事), 失敗忽略
    let recover = async () => {
        await stage('reconnect', msClean, () => adapter.reconnect())
            .catch(() => {})
    }

    //removeRemote, 刪除遠端檔, 已不存在視為成功; 遇連線層級之錯誤時重新連線後再試一次
    let removeRemote = async (fp, active) => {
        await adapter.reconnect()
        try {
            await adapter.remove(fp)
            return true
        }
        catch (err) {
            if (!active()) {
                return false
            }
            if (isReply(err)) {
                return adapter.isAbsent(fp, err)
            }
        }
        adapter.abort()
        await adapter.reconnect()
        try {
            await adapter.remove(fp)
            return true
        }
        catch (err) {
            if (!active() || !isReply(err)) {
                return false //重新連線後仍為連線層級之錯誤, 不再於該連線查詢
            }
            return adapter.isAbsent(fp, err)
        }
    }

    //cleanup, 於msClean內刪除遠端暫存, 回傳是否已清除
    let cleanup = async (fp, kind) => {
        let ok = false
        try {
            ok = await stage('clean', msClean, (active) => removeRemote(fp, active)) === true
        }
        catch (err) {
            if (isTimeout(err)) {
                await recover()
            }
        }
        emit('temp', { act: 'remove', ok, kind })
        return ok
    }

    //failWithCleanup, 刪除遠端暫存後以msg(刪不掉者加後綴)reject
    let failWithCleanup = async (msg) => {
        let ok = await cleanup(fpTemp, 'part')
        return Promise.reject(`${msg}${ok ? '' : sfxResidue}`)
    }

    //st, 交換退路之進度: 'none'、'moving'(舊檔改暫名中)、'moved'(舊檔已改暫名)、'replaced'(fpRemote已是新內容)
    let st = { swap: 'none', fpOld: null }

    //replace, 把暫存改名為fpRemote, 回傳所用之方式; 逾時後(active()為false)不再送出後續指令
    let replace = async (active) => {
        let check = () => {
            if (!active()) {
                throw mkTimeout()
            }
        }
        if (adapter.posixRename) {
            try {
                if (await adapter.posixRename(fpTemp, fpRemote)) {
                    return 'posix'
                }
            }
            catch (err) {
                if (!isReply(err)) {
                    throw err
                }
            }
            check()
        }
        let errRename = null
        try {
            await adapter.rename(fpTemp, fpRemote)
            return 'rename'
        }
        catch (err) {
            if (!isReply(err)) {
                throw err
            }
            errRename = err
        }
        check()
        if (!await adapter.isFile(fpRemote)) {
            throw errRename //目標不存在或非檔案(如資料夾), 不可搬走
        }
        check()
        st.fpOld = remoteSibling(fpRemote, 'old')
        st.swap = 'moving'
        await adapter.rename(fpRemote, st.fpOld)
        st.swap = 'moved'
        check()
        await adapter.rename(fpTemp, fpRemote)
        st.swap = 'replaced'
        return 'swap'
    }

    //restoreStep, 交換中途失敗後之一次處置, 回傳'ok'(fpRemote有檔且無舊檔暫名遺留)或'kept'(舊檔仍以暫名保留):
    //  fpRemote不存在即把舊檔改回; 存在且有舊檔暫名者, 僅在舊檔已搬走、錯誤非伺服器回應且fpRemote大小等於本次上傳(本次改名實已完成)時刪除舊檔暫名, 其餘一律保留舊檔
    let restoreStep = async (active, errSwap) => {
        await adapter.reconnect()
        if (!await adapter.isFile(fpRemote)) {
            if (!active()) {
                return 'kept'
            }
            await adapter.rename(st.fpOld, fpRemote)
            return 'ok'
        }
        if (!await adapter.isFile(st.fpOld)) {
            return 'ok'
        }
        if (st.swap !== 'moved' || isReply(errSwap) || await adapter.size(fpRemote) !== fileSize || !active()) {
            return 'kept'
        }
        let ok = await removeRemote(st.fpOld, active)
        emit('temp', { act: 'remove', ok, kind: 'old' })
        return ok ? 'ok' : 'kept'
    }

    //restoreSwap, 交換中途失敗或逾時之還原, 連線層級之錯誤或逾時者重新連線後再試一次, 回傳'ok'、'kept'或'unknown'
    let restoreSwap = async (errSwap) => {
        for (let i = 0; i < 2; i++) {
            try {
                return await stage('clean', msClean, (active) => restoreStep(active, errSwap))
            }
            catch (err) {
                if (isReply(err)) {
                    return 'kept'
                }
                if (!isTimeout(err)) {
                    adapter.abort()
                }
                await recover()
            }
        }
        return 'unknown'
    }

    //failRename, 改名階段失敗: 交換中者先還原, 再刪除暫存並以固定訊息reject
    let failRename = async (err) => {
        //舊檔已改暫名, 或改暫名之結果不明(逾時、連線錯誤; 伺服器回應拒絕者舊檔未動)時須還原
        let bUnsure = st.swap === 'moving' && !isReply(err)
        let r = st.swap === 'moved' || bUnsure ? await restoreSwap(err) : 'ok'
        let note = ''
        if (r === 'kept') {
            note = msgKept
        }
        else if (r === 'unknown' || bUnsure) { //改暫名之指令可能於稍後才被伺服器執行
            note = msgMayKept
        }
        let msg = ''
        if (isTimeout(err)) {
            msg = `${msgTimeout} while renaming, fpRemote may or may not be updated`
        }
        else {
            msg = `ftpUpload: can not rename the temporary file to fpRemote (${codeOfRemote(err)})`
            if (!isReply(err)) {
                msg = `${msg}, fpRemote may or may not be updated`
            }
            else if (note === '') {
                msg = `${msg}, fpRemote is not changed`
            }
        }
        return failWithCleanup(note === '' ? msg : `${msg}, ${note}`)
    }

    //core, 各階段
    let core = async () => {

        //prepare, 建立遠端資料夾, 此時尚無暫存檔
        try {
            await stage('prepare', timeLimit, (active) => adapter.prepare(active))
        }
        catch (err) {
            if (isTimeout(err)) {
                return Promise.reject(msgTimeout)
            }
            throw err
        }

        //transfer
        try {
            await stage('transfer', timeLimit, (active) => adapter.put(fpTemp, active))
        }
        catch (err) {
            if (isTimeout(err)) {
                return failWithCleanup(msgTimeout)
            }
            let ok = await cleanup(fpTemp, 'part')
            if (ok) {
                throw err //只有傳輸本身失敗且暫存已清除時, 沿用原錯誤
            }
            return Promise.reject(`ftpUpload: transfer failed (${codeOfRemote(err)}), fpRemote is not changed${sfxResidue}`)
        }

        //verify, 遠端暫存大小須等於本機大小, 且本機大小於傳輸期間未改變
        let sizeRemote = -1
        try {
            sizeRemote = await stage('verify', timeLimit, () => adapter.size(fpTemp))
        }
        catch (err) {
            if (isTimeout(err)) {
                return failWithCleanup(msgTimeout)
            }
            return failWithCleanup(`ftpUpload: can not get the size of the uploaded temporary file (${codeOfRemote(err)}), fpRemote is not changed`)
        }
        let sizeLocal = sizeOfLocal(fpLocal)
        let bSize = sizeRemote === fileSize && sizeLocal === fileSize
        emit('verify', { ok: bSize, size: sizeRemote, sizeLocal })
        if (sizeLocal !== fileSize) {
            return failWithCleanup(`ftpUpload: fpLocal was changed during upload, fpRemote is not changed`)
        }
        if (!bSize) {
            return failWithCleanup(`ftpUpload: uploaded size[${sizeRemote}] does not match local size[${fileSize}], fpRemote is not changed`)
        }

        //rename
        let mode = ''
        try {
            mode = await stage('rename', timeLimit, replace)
        }
        catch (err) {
            return failRename(err)
        }

        //交換退路: 改名完成後刪除舊檔暫名, 刪不掉即reject(不靜默留下暫存名)
        if (mode === 'swap') {
            let ok = await cleanup(st.fpOld, 'old')
            if (!ok) {
                return Promise.reject(`ftpUpload: fpRemote is updated, but can not remove the old file kept under a temporary name in the same folder`)
            }
        }
        emit('move', { mode })

        return 'ok'
    }

    try {
        return await core()
    }
    catch (err) {
        await recover() //連線已中止或不可用者重新連線, 使同一實例其後可用
        throw err
    }
}


export default uploadViaTemp
