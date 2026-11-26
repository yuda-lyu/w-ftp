import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import { mock } from 'node:test'
import w from 'wsemi'
import WFtp from '../src/WFtp.mjs'
import fakeSftpServer from './lib/fakeSftpServer.mjs'
import { genBytes, listDir, recorder, settleWithin, gate, signal, assertFile, catchUnhandled, deadPid } from './lib/dlTestKit.mjs'


//SFTP下載先寫入暫存區, 確定完成(傳輸成功且本地大小等於遠端大小)才移至目標(真實WFtp經假SFTP伺服器, 不替身fastGet)
//規格(使用端需求, 2026-11-26): 下載各檔應先存放到暫存區, 確定完成後才移動至目標區內; 暫存路徑可由外部指定;
//  中斷、逾時、大小不符時刪除暫存殘檔並reject, 目標不得出現殘檔, 目標之舊檔不動; 跨磁碟須可行; timeLimit須生效, 逾時後背景傳輸不得移至目標且暫存最終被清除;
//  逾時或斷線後同一實例可quit再conn重用, 重試同一檔不與背景傳輸相撞
describe('api-sftp-download-temp', function() {

    //fdBase, 測試臨時資料夾(依測試規範放test/_tmp/<案名>/)
    let fdBase = './test/_tmp/sftp-download-temp'
    let fdSrv = `${fdBase}/srv`
    let fdOut = `${fdBase}/out`

    //big, 10塊32768位元組加123位元組, 使fastGet並行讀取多塊
    let nBig = 10 * 32768 + 123
    let bufBig = genBytes(nBig, 1)
    let offLast = 10 * 32768 //最後一塊之位移

    //sameA, sameB, 同檔名(same.bin)不同內容
    let bufSameA = genBytes(5000, 2)
    let bufSameB = genBytes(7000, 3)

    //old, 目標既有之舊檔內容
    let OLD = 'OLD-content-must-stay'

    //TL, 逾時案之timeLimit; 逾時後同一實例之重試(正常下載)亦受此限, 故不取過小之值以免負載下誤判
    let TL = 2000

    let servers = []
    let clients = []

    //newUn, 建立未處理rejection收集器並登記, 案末(afterEach)一律停止, 斷言失敗時亦不使監聽器殘留
    let uns = []
    let newUn = () => {
        let u = catchUnhandled()
        uns.push(u)
        return u
    }

    //newSrv, 每案各自起伺服器(各自之攔截), 案末關閉
    let newSrv = async (hooks) => {
        let srv = await fakeSftpServer({ fdRoot: fdSrv, hooks })
        servers.push(srv)
        return srv
    }

    //newFtp
    let newFtp = async (srv, o = {}) => {
        let ftp = WFtp({
            transportation: 'SFTP',
            hostname: '127.0.0.1',
            port: srv.port,
            username: 'u1',
            password: 'p1',
            timeLimit: 15000,
            ...o,
        })
        clients.push(ftp)
        await ftp.conn()
        return ftp
    }

    //prepOut, 建立含舊檔之目標
    let prepOut = (name) => {
        let fd = `${fdOut}/${name}`
        w.fsCleanFolder(fd)
        fs.writeFileSync(`${fd}/big.bin`, OLD, 'utf8')
        return fd
    }

    before(function() {
        w.fsDeleteFolder(fdBase)
        w.fsCreateFolder(`${fdSrv}/a`)
        w.fsCreateFolder(`${fdSrv}/b`)
        w.fsCreateFolder(`${fdSrv}/sub`)
        fs.writeFileSync(`${fdSrv}/big.bin`, bufBig)
        fs.writeFileSync(`${fdSrv}/a/same.bin`, bufSameA)
        fs.writeFileSync(`${fdSrv}/b/same.bin`, bufSameB)
        fs.writeFileSync(`${fdSrv}/top.txt`, 'top-1', 'utf8')
        fs.writeFileSync(`${fdSrv}/sub/deep.txt`, 'deep-22', 'utf8')
    })

    afterEach(async function() {
        mock.restoreAll()
        for (let u of uns) {
            u.stop()
        }
        uns = []
        for (let ftp of clients) {
            await ftp.quit()
                .catch(() => {})
        }
        clients = []
        for (let srv of servers) {
            await srv.close()
        }
        servers = []
    })

    after(function() {
        w.fsDeleteFolder(fdBase)
    })

    it('正常下載: 內容逐位元組相同, 經暫存區改名移至目標(取代舊檔), 暫存區無殘檔', async function() {
        let fd = prepOut('n1')
        let fdTemp = `${fdBase}/temp-n1`
        let rec = recorder()
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace })
        assert.strict.deepEqual(r, 'ok')
        assertFile(`${fd}/big.bin`, bufBig, '目標內容須與遠端逐位元組相同') //規格: 確定完成後才移動至目標
        assert.strict.deepEqual(listDir(fdTemp), []) //規格: 暫存區不留殘檔
        assert.strict.deepEqual(listDir(fd), ['big.bin']) //規格: 目標資料夾不出現暫存名
        assert.strict.deepEqual(rec.evs.map((e) => e.type), ['sweep', 'temp', 'transfer', 'verify', 'move']) //規格: 先寫暫存、核對大小後才移動(sweep為首次使用該暫存區之殘留清理)
        assert.strict.deepEqual(rec.evs[3], { type: 'verify', ok: true, size: nBig, sizeRemote: nBig })
        assert.strict.deepEqual(rec.evs[4], { type: 'move', mode: 'rename' }) //同一磁碟以改名一步取代
    })

    it('指定暫存路徑生效: 傳輸中之內容只在暫存區(專用暫存檔), 目標之舊檔不動, 完成後才取代', async function() {
        let fd = prepOut('n2')
        let fdTemp = `${fdBase}/temp-n2`
        let g = gate()
        let sgRead = signal()
        let srv = await newSrv({
            READ: (ctx) => {
                sgRead.fire()
                g.wait().then(ctx.respond)
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let p = ftp.download('./big.bin', `${fd}/big.bin`)
        await sgRead.wait() //伺服器已收到READ, 客戶端已開啟本地檔
        let lsTemp = listDir(fdTemp)
        assert.strict.deepEqual(lsTemp.length, 1) //規格: 先存放到暫存區(由外部指定之路徑)
        assert.strict.ok(/^big\.bin\.\d+\.[0-9A-Za-z]{8}\.part$/.test(lsTemp[0]), `暫存檔名格式不符: ${lsTemp[0]}`)
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔') //規格: 移動前目標之舊檔保持不動
        g.open()
        let r = await settleWithin(p, 15000)
        assert.strict.deepEqual(r.settled && r.ok, true, `download須完成: ${String(r.err)}`)
        assertFile(`${fd}/big.bin`, bufBig, '完成後目標須為新內容')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('傳輸中途斷線(只回最後兩塊後斷線, 原版會留下大小相同而前段為0之殘檔): reject, 目標之舊檔不動, 暫存區無殘檔; 之後同一實例quit不卡住, 再conn可重用', async function() {
        let fd = prepOut('n3')
        let fdTemp = `${fdBase}/temp-n3`
        let nConn = 0
        let un = newUn()
        let srv = await newSrv({
            READ: (ctx) => {
                if (ctx.client.__n === undefined) {
                    nConn++
                    ctx.client.__n = nConn
                }
                if (ctx.client.__n > 1) {
                    ctx.respond() //第2次連線起正常
                    return
                }
                //fastGet依檔案大小並行10塊(位移0至9塊), 第10塊於前塊完成後才請求;
                //只回第9塊與第10塊(最後一塊)後斷線, 其前之塊未寫入
                if (ctx.offset >= 9 * 32768) {
                    ctx.respond()
                }
                if (ctx.offset === offLast) {
                    setImmediate(() => {
                        ctx.client.end()
                    })
                }
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.settled, true, 'download須結束')
        assert.strict.deepEqual(r.ok, false, '中途斷線須reject') //規格: 中斷時reject
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔') //規格: 目標不得出現殘檔, 舊檔不動
        assert.strict.deepEqual(listDir(fd), ['big.bin'])
        assert.strict.deepEqual(listDir(fdTemp), []) //規格: 刪除暫存殘檔

        //quit不卡住, 再conn重用同一實例
        let rq = await settleWithin(ftp.quit(), 5000)
        assert.strict.deepEqual(rq.settled, true, '斷線後quit須結束')
        await ftp.conn()
        let r2 = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r2.settled && r2.ok, true, `重新conn後須可下載: ${String(r2.err)}`)
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        assert.strict.deepEqual(listDir(fdTemp), [])
        un.stop()
        assert.strict.deepEqual(un.list, [], '不得有未處理之rejection')
    })

    it('遠端回報大小與實際傳輸大小不符: reject並寫明大小不符, 目標之舊檔不動, 暫存區無殘檔', async function() {
        let fd = prepOut('n4')
        let fdTemp = `${fdBase}/temp-n4`
        let srv = await newSrv({
            statSize: (size, p) => {
                return p.indexOf('big.bin') >= 0 ? size + 10 : size //STAT多報10位元組, 實際傳輸(依FSTAT)為原大小
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.settled, true)
        assert.strict.deepEqual(r.ok, false, '大小不符須reject') //規格: 確定完成須含本地大小等於遠端大小
        assert.strict.deepEqual(r.err, `ftpDownload: downloaded size[${nBig}] does not match remote size[${nBig + 10}], fpLocal is not changed`)
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('timeLimit生效: 停滯時依timeLimit逾時reject; 其後背景傳輸結束時只清暫存檔, 不移至目標', async function() {
        let fd = prepOut('n5')
        let fdTemp = `${fdBase}/temp-n5`
        let g = gate()
        let srv = await newSrv({
            READ: (ctx) => {
                g.wait().then(ctx.respond)
            },
        })
        let rec = recorder()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: TL })
        let t0 = Date.now()
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), TL + 10000)
        let dt = Date.now() - t0
        assert.strict.deepEqual(r.settled, true, '停滯時須依timeLimit逾時結束(原版clearTimeout立即清除, 永不逾時)') //規格: timeLimit須生效
        assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`)
        assert.strict.ok(dt >= TL - 10, `逾時不得早於timeLimit: ${dt}`) //只斷言下界
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔') //逾時時舊檔不動

        //放行伺服器, 背景傳輸完成後, 須只清暫存檔、不移至目標
        g.open()
        await rec.wait((e) => e.type === 'transfer' && e.late === true)
        await rec.wait((e) => e.type === 'temp' && e.act === 'remove')
        assert.strict.deepEqual(rec.evs.some((e) => e.type === 'move'), false) //規格: 逾時後之背景傳輸不得移至目標
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), []) //規格: 暫存最終被清除
    })

    it('逾時發生於開啟本地檔之前(伺服器停滯於OPEN): 其後背景傳輸重建暫存檔並傳完, 仍不移至目標且暫存被清', async function() {
        let fd = prepOut('n5b')
        let fdTemp = `${fdBase}/temp-n5b`
        let g = gate()
        let srv = await newSrv({
            OPEN: (ctx) => {
                g.wait().then(ctx.respond)
            },
        })
        let rec = recorder()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: TL })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), TL + 10000)
        assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`)
        assert.strict.deepEqual(listDir(fdTemp), []) //逾時當下先刪暫存檔名

        //放行OPEN, fastGet於逾時後才以'w'開啟本地暫存檔(重建)並傳完, 須只清暫存檔、不移至目標
        g.open()
        await rec.wait((e) => e.type === 'transfer' && e.late === true)
        await rec.wait((e) => e.type === 'temp' && e.act === 'remove')
        assert.strict.deepEqual(rec.evs.some((e) => e.type === 'move'), false) //規格: 逾時後之背景傳輸不得移至目標
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), []) //規格: 暫存最終被清除
    })

    it('逾時後背景仍在傳輸時重試同一檔: 不與背景相撞, 重試結果為新內容, 背景結束後不覆蓋且暫存清除', async function() {
        let fd = prepOut('n6')
        let fdTemp = `${fdBase}/temp-n6`
        let g = gate()
        let hFirst = null
        let srv = await newSrv({
            READ: (ctx) => {
                if (hFirst === null) {
                    hFirst = ctx.handle
                }
                if (ctx.handle === hFirst) {
                    g.wait().then(ctx.respond) //只停滯第1次開啟之讀取
                    return
                }
                ctx.respond()
            },
        })
        let rec1 = recorder()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: TL })
        let r1 = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec1.onTrace }), TL + 10000)
        assert.strict.deepEqual(r1.err, `ftpDownload timeout[${TL}]`)

        //同一實例、同一連線重試同一檔(第1次仍於背景停滯)
        let r2 = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), TL + 10000)
        assert.strict.deepEqual(r2.settled && r2.ok, true, `重試須成功: ${String(r2.err)}`)
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')

        //放行第1次, 其結束後不得覆蓋目標
        fs.writeFileSync(`${fd}/marker.txt`, 'm', 'utf8')
        g.open()
        await rec1.wait((e) => e.type === 'temp' && e.act === 'remove')
        assertFile(`${fd}/big.bin`, bufBig, '背景傳輸不得覆蓋重試之結果')
        assert.strict.deepEqual(listDir(fdTemp), [])
        assert.strict.deepEqual(listDir(fd), ['big.bin', 'marker.txt'])
    })

    it('逾時後quit不卡住: 暫存檔名於逾時時即已刪除, quit後仍無殘檔且未移至目標; 同一實例再conn可下載', async function() {
        let fd = prepOut('n7')
        let fdTemp = `${fdBase}/temp-n7`
        let g = gate()
        let hFirst = null
        let cFirst = null
        let un = newUn()
        let srv = await newSrv({
            READ: (ctx) => {
                if (hFirst === null) {
                    hFirst = ctx.handle
                    cFirst = ctx.client
                }
                if (ctx.handle === hFirst && ctx.client === cFirst) { //開啟代號於每次連線重新編號, 故併同連線判定
                    g.wait().then(() => {
                        try {
                            ctx.respond()
                        }
                        catch (err) {}
                    })
                    return
                }
                ctx.respond()
            },
        })
        let rec = recorder()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: TL })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), TL + 10000)
        assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`)
        assert.strict.deepEqual(listDir(fdTemp), []) //逾時當下即刪除暫存檔名(檔案開啟中亦可)
        let rq = await settleWithin(ftp.quit(), 5000)
        assert.strict.deepEqual(rq.settled, true, '逾時後quit須結束')
        //quit斷線後, ssh2之fastGet對停滯中之請求可能永不回呼(實測15秒內未結束), 故不等待'transfer'事件, 只斷言檔案狀態
        assert.strict.deepEqual(listDir(fdTemp), [])
        assert.strict.deepEqual(rec.evs.some((e) => e.type === 'move'), false)
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        await ftp.conn()
        let r2 = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), TL + 10000)
        assert.strict.deepEqual(r2.settled && r2.ok, true, `再conn後須可下載: ${String(r2.err)}`)
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        g.open()
        un.stop()
        assert.strict.deepEqual(un.list, [], '不得有未處理之rejection')
    })

    it('跨磁碟(rename回EXDEV, 以替換fs.promises.rename模擬): 先複製至目標同資料夾之暫存名再改名, 目標為新內容, 兩處皆無殘檔', async function() {
        let fd = prepOut('n8')
        let fdTemp = `${fdBase}/temp-n8`
        let fdTempAbs = path.resolve(fdTemp)
        let renameReal = fs.promises.rename
        let calls = []
        mock.method(fs.promises, 'rename', async (a, b) => {
            calls.push([path.basename(String(a)), path.basename(String(b))])
            if (path.resolve(String(a)).startsWith(fdTempAbs)) {
                let e = new Error('cross-device link not permitted')
                e.code = 'EXDEV'
                throw e
            }
            return renameReal(a, b)
        })
        let rec = recorder()
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace })
        assert.strict.deepEqual(r, 'ok')
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        assert.strict.deepEqual(rec.evs.find((e) => e.type === 'move'), { type: 'move', mode: 'copy' }) //規格: 跨磁碟時改名失敗須有可行作法
        assert.strict.deepEqual(calls.length, 2) //暫存區→目標(EXDEV), 目標同資料夾暫存名→目標
        assert.strict.ok(/^big\.bin\.\d+\.[0-9A-Za-z]{8}\.part$/.test(calls[1][0]), `目標同資料夾暫存名格式不符: ${calls[1][0]}`)
        assert.strict.deepEqual(calls[1][1], 'big.bin')
        assert.strict.deepEqual(listDir(fd), ['big.bin'])
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('跨磁碟且目標同資料夾改名失敗: reject寫明無法移動, 目標之舊檔不動, 目標同資料夾與暫存區皆無殘檔', async function() {
        let fd = prepOut('n9')
        let fdTemp = `${fdBase}/temp-n9`
        let n = 0
        mock.method(fs.promises, 'rename', async () => {
            n++
            let e = new Error('mock')
            e.code = n === 1 ? 'EXDEV' : 'EPERM'
            throw e
        })
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.err, 'ftpDownload: can not move the downloaded file to fpLocal (EPERM), fpLocal is not changed') //規格: 移動失敗時舊檔仍在且有明確之錯誤訊息
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fd), ['big.bin'])
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('移動持續失敗(rename一律回EPERM, 如目標被占用): 有界重試(共5次嘗試)用盡後reject寫明無法移動, 目標之舊檔不動, 暫存區無殘檔', async function() {
        let fd = prepOut('n10')
        let fdTemp = `${fdBase}/temp-n10`
        let nCall = 0
        mock.method(fs.promises, 'rename', async () => {
            nCall++
            let e = new Error('mock')
            e.code = 'EPERM'
            throw e
        })
        let rec = recorder()
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), 15000)
        assert.strict.deepEqual(r.err, 'ftpDownload: can not move the downloaded file to fpLocal (EPERM), fpLocal is not changed')
        assert.strict.deepEqual(nCall, 5) //規格(主控裁定8): 有界, 不無限重試
        assert.strict.deepEqual(rec.evs.filter((e) => e.type === 'retry').map((e) => e.n), [1, 2, 3, 4])
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('目標為資料夾(真實失敗, 不替身): 傳輸前即reject(不下載、不建立暫存檔), 該資料夾不動, 暫存區無殘檔', async function() {
        let fd = `${fdOut}/n11`
        w.fsCleanFolder(fd)
        w.fsCreateFolder(`${fd}/big.bin`)
        fs.writeFileSync(`${fd}/big.bin/keep.txt`, 'keep', 'utf8')
        let fdTemp = `${fdBase}/temp-n11`
        let rec = recorder()
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), 15000)
        assert.strict.deepEqual(r.settled, true)
        assert.strict.deepEqual(r.err, 'ftpDownload: fpLocal is a directory, fpLocal is not changed')
        assert.strict.deepEqual(rec.evs, []) //未進入暫存與傳輸(原版亦於開啟本地檔時即失敗, 不先傳完整檔)
        assert.strict.deepEqual(fs.readFileSync(`${fd}/big.bin/keep.txt`, 'utf8'), 'keep')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('移動遇占用(rename先回EBUSY再成功, 以替換fs.promises.rename模擬): 有界重試後成功, 目標為新內容, 暫存區無殘檔; 重試事件依序為n=1,2', async function() {
        let fd = prepOut('n10b')
        let fdTemp = `${fdBase}/temp-n10b`
        let renameReal = fs.promises.rename
        let nBusy = 0
        mock.method(fs.promises, 'rename', async (a, b) => {
            if (path.resolve(String(a)).startsWith(path.resolve(fdTemp)) && nBusy < 2) {
                nBusy++
                let e = new Error('mock busy')
                e.code = 'EBUSY'
                throw e
            }
            return renameReal(a, b)
        })
        let rec = recorder()
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), 15000)
        mock.restoreAll()
        assert.strict.deepEqual(r.settled && r.ok, true, `重試後須成功: ${String(r.err)}`) //規格(主控裁定8): 移動遇占用做有界重試
        assert.strict.deepEqual(rec.evs.filter((e) => e.type === 'retry'), [{ type: 'retry', n: 1, code: 'EBUSY' }, { type: 'retry', n: 2, code: 'EBUSY' }])
        assert.strict.deepEqual(rec.evs.find((e) => e.type === 'move'), { type: 'move', mode: 'rename' })
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('實際跨磁碟(暫存區於作業系統暫存夾且與cwd不同磁碟時才執行): 經複製後改名, 內容相同, 兩處皆無殘檔', async function() {
        let rootTmp = path.parse(os.tmpdir()).root.toLowerCase()
        let rootCwd = path.parse(process.cwd()).root.toLowerCase()
        if (rootTmp === rootCwd) {
            this.skip() //同一磁碟, 無法以實機驗證跨磁碟
        }
        let fd = prepOut('n12')
        let fdTemp = path.join(os.tmpdir(), `w-ftp-test-xdev-${process.pid}-${w.genID(6)}`)
        try {
            let rec = recorder()
            let srv = await newSrv()
            let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
            let r = await ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace })
            assert.strict.deepEqual(r, 'ok')
            assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
            assert.strict.deepEqual(rec.evs.find((e) => e.type === 'move'), { type: 'move', mode: 'copy' })
            assert.strict.deepEqual(listDir(fd), ['big.bin'])
            assert.strict.deepEqual(listDir(fdTemp), [])
        }
        finally {
            fs.rmSync(fdTemp, { recursive: true, force: true })
        }
    })

    it('同名併發(兩個遠端同檔名之檔同時下載, 共用暫存區): 暫存檔名互不相同, 兩目標各為其來源之內容', async function() {
        let fd = `${fdOut}/n13`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-n13`
        let g = gate()
        let hs = new Set()
        let sgBoth = signal()
        let srv = await newSrv({
            READ: (ctx) => {
                hs.add(ctx.handle)
                if (hs.size >= 2) {
                    sgBoth.fire()
                }
                g.wait().then(ctx.respond)
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let pA = ftp.download('./a/same.bin', `${fd}/a/same.bin`)
        let pB = ftp.download('./b/same.bin', `${fd}/b/same.bin`)
        await sgBoth.wait() //兩者皆已開始傳輸
        let ls = listDir(fdTemp)
        assert.strict.deepEqual(ls.length, 2) //規格: 同一暫存區多檔同名不互相覆蓋
        assert.strict.ok(ls.every((v) => v.startsWith('same.bin.')), `暫存檔名不符: ${ls}`)
        g.open()
        let rA = await settleWithin(pA, 15000)
        let rB = await settleWithin(pB, 15000)
        assert.strict.deepEqual(rA.ok && rB.ok, true, `兩者皆須完成: ${String(rA.err)} ${String(rB.err)}`)
        assertFile(`${fd}/a/same.bin`, bufSameA, '目標a須為a之內容')
        assertFile(`${fd}/b/same.bin`, bufSameB, '目標b須為b之內容')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('暫存檔名已存在(EEXIST, 以替換fs.openSync模擬): 換名重試後成功, 不覆寫既有之同名檔', async function() {
        let fd = `${fdOut}/n14`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-n14`
        let openReal = fs.openSync
        let tried = []
        mock.method(fs, 'openSync', (fp, flags, ...args) => {
            if (flags === 'wx') {
                tried.push(path.basename(String(fp)))
                if (tried.length === 1) {
                    let e = new Error('mock exists')
                    e.code = 'EEXIST'
                    throw e
                }
            }
            return openReal(fp, flags, ...args)
        })
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await ftp.download('./big.bin', `${fd}/big.bin`)
        mock.restoreAll()
        assert.strict.deepEqual(r, 'ok')
        assert.strict.deepEqual(tried.length, 2)
        assert.strict.notDeepEqual(tried[0], tried[1]) //換名
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('fdDownloadTemp之層級: 單次呼叫優先, 單次呼叫之非預期輸入(含假值)改用實例層級, 實例層級之非預期輸入改用預設./_wftpDownloadTemp', async function() {
        let fd = `${fdOut}/n15`
        w.fsCleanFolder(fd)
        let fdInst = path.resolve(`${fdBase}/temp-n15-inst`)
        let fdCall = path.resolve(`${fdBase}/temp-n15-call`)
        let fdDef = path.resolve('./_wftpDownloadTemp')
        let bDefExisted = fs.existsSync(fdDef)
        let snap = null
        let take = (e) => {
            if (e.type === 'temp' && e.act === 'create') {
                snap = { inst: listDir(fdInst).length, call: listDir(fdCall).length, def: listDir(fdDef).length }
            }
        }
        let srv = await newSrv()
        try {

            //單次呼叫優先
            let ftp = await newFtp(srv, { fdDownloadTemp: fdInst })
            await ftp.download('./top.txt', `${fd}/top.txt`, null, { fdDownloadTemp: fdCall, onTrace: take })
            assert.strict.deepEqual(snap, { inst: 0, call: 1, def: 0 })

            //單次呼叫之非預期輸入, 改用實例層級
            for (let v of [undefined, null, '', 0, false, 123, [], {}, new String('x'), `${fdCall}\0x`]) { // eslint-disable-line no-new-wrappers
                snap = null
                await ftp.download('./top.txt', `${fd}/top.txt`, null, { fdDownloadTemp: v, onTrace: take })
                assert.strict.deepEqual(snap, { inst: 1, call: 0, def: 0 }, `fdDownloadTemp=${typeof v}`)
            }

            //opt本身非物件, 改用實例層級
            for (let o of [null, 'abc', 1]) {
                let r = await ftp.download('./top.txt', `${fd}/top.txt`, null, o)
                assert.strict.deepEqual(r, 'ok')
            }

            //實例層級之非預期輸入, 改用預設
            let ftpDef = await newFtp(srv, { fdDownloadTemp: 123 })
            snap = null
            await ftpDef.download('./top.txt', `${fd}/top.txt`, null, { onTrace: take })
            assert.strict.deepEqual(snap, { inst: 0, call: 0, def: 1 })
            assert.strict.deepEqual(fs.readFileSync(`${fd}/top.txt`, 'utf8'), 'top-1')
            assert.strict.deepEqual(listDir(fdInst), [])
            assert.strict.deepEqual(listDir(fdCall), [])
            assert.strict.deepEqual(listDir(fdDef).filter((v) => v.startsWith('top.txt.')), [])
        }
        finally {
            if (!bDefExisted) {
                fs.rmSync(fdDef, { recursive: true, force: true })
            }
        }
    })

    it('onTrace之五種回調(未傳, 紀錄器, 拋錯, 回傳rejection, 非函數): 結果與內容皆相同, 無未處理之rejection', async function() {
        let fd = `${fdOut}/n16`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-n16`
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let un = newUn()
        let rec = recorder()
        let variants = [
            undefined,
            rec.onTrace,
            () => {
                throw new Error('cb throws')
            },
            () => Promise.reject(new Error('cb rejects')),
            123,
        ]
        for (let i = 0; i < variants.length; i++) {
            let r = await ftp.download('./big.bin', `${fd}/big${i}.bin`, null, { onTrace: variants[i] })
            assert.strict.deepEqual(r, 'ok', `variant ${i}`)
            assertFile(`${fd}/big${i}.bin`, bufBig, `variant ${i}`)
        }
        await new Promise((resolve) => setImmediate(resolve))
        un.stop()
        assert.strict.deepEqual(un.list, [])
        assert.strict.ok(rec.evs.every((e) => Object.isFrozen(e)), '事件須凍結')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('syncToLocal: 轉交opt(levelLimit與單次呼叫之fdDownloadTemp皆生效), 各檔經暫存區', async function() {
        let fd = `${fdOut}/n17`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-n17`
        let nInTemp = 0
        let rec = recorder((e) => {
            if (e.type === 'temp' && e.act === 'create') {
                nInTemp += listDir(fdTemp).length //建立當下暫存檔確在單次呼叫指定之暫存區
            }
        })
        let srv = await newSrv()
        let ftp = await newFtp(srv)
        let r = await ftp.syncToLocal('.', fd, null, { levelLimit: 1, fdDownloadTemp: fdTemp, onTrace: rec.onTrace })
        assert.strict.deepEqual(r.num, 2) //第1層: big.bin, top.txt(原版未轉交opt, levelLimit被忽略而下載各層)
        assert.strict.deepEqual(listDir(fd), ['big.bin', 'top.txt'])
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        assert.strict.deepEqual(rec.evs.filter((e) => e.type === 'move').length, 2) //各檔皆經暫存區移入
        assert.strict.deepEqual(nInTemp, 2) //兩檔各於指定之暫存區建立暫存檔
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('syncToLocal: 某檔大小不符即reject, 該檔之舊檔不動, 暫存區無殘檔', async function() {
        let fd = prepOut('n18')
        let fdTemp = `${fdBase}/temp-n18`
        let srv = await newSrv({
            statSize: (size, p) => {
                return p.indexOf('big.bin') >= 0 ? size + 10 : size
            },
        })
        let ftp = await newFtp(srv)
        let r = await settleWithin(ftp.syncToLocal('.', fd, null, { levelLimit: 1, fdDownloadTemp: fdTemp, forceOverwriteWhenSync: true }), 15000)
        assert.strict.deepEqual(r.settled, true)
        assert.strict.deepEqual(r.ok, false)
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('syncToLocal: forceOverwriteWhenSync轉交生效(與遠端同大小而內容相異之檔: 未給不重新下載, 給true才重新下載)', async function() {
        let fd = `${fdOut}/n20`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-n20`
        fs.writeFileSync(`${fd}/top.txt`, 'top-X', 'utf8') //與遠端top.txt(top-1)同為5位元組
        let srv = await newSrv()
        let ftp = await newFtp(srv)
        let r1 = await ftp.syncToLocal('.', fd, null, { levelLimit: 1, fdDownloadTemp: fdTemp })
        assert.strict.deepEqual(r1.num, 1) //只下載本地不存在之big.bin
        assert.strict.ok(r1.files.length === 1 && /big\.bin$/.test(r1.files[0].path), `下載清單不符: ${JSON.stringify(r1.files)}`)
        assert.strict.deepEqual(fs.readFileSync(`${fd}/top.txt`, 'utf8'), 'top-X') //大小相同, 未重新下載
        let r2 = await ftp.syncToLocal('.', fd, null, { levelLimit: 1, fdDownloadTemp: fdTemp, forceOverwriteWhenSync: true })
        assert.strict.deepEqual(r2.num, 2) //規格: SFTP之syncToLocal須轉交opt(原版忽略), 強制重新下載第1層全部
        assert.strict.deepEqual(fs.readFileSync(`${fd}/top.txt`, 'utf8'), 'top-1')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('timeLimit對查詢遠端檔案資訊(stat)階段亦生效: 伺服器於STAT停滯時依timeLimit逾時reject, 目標之舊檔不動, 不建立暫存檔; 其後quit不卡住, 再conn可下載', async function() {
        let fd = prepOut('n19')
        let fdTemp = `${fdBase}/temp-n19`
        let g = gate()
        let nStat = 0
        let srv = await newSrv({
            STAT: (ctx) => {
                nStat++
                if (nStat === 1) {
                    g.wait().then(() => {
                        try {
                            ctx.respond()
                        }
                        catch (err) {}
                    })
                    return
                }
                ctx.respond()
            },
        })
        let rec = recorder()
        let un = newUn()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: TL })
        let t0 = Date.now()
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), TL + 10000)
        let dt = Date.now() - t0
        assert.strict.deepEqual(r.settled, true, '停滯於STAT時須依timeLimit逾時結束(原版stat階段無計時)') //規格(主控裁定3): SFTP之stat階段亦加計時
        assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`)
        assert.strict.ok(dt >= TL - 10, `逾時不得早於timeLimit: ${dt}`) //只斷言下界
        assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'stat' }]) //尚未進入傳輸: 無暫存事件
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])

        //quit不卡住, 再conn重用同一實例
        let rq = await settleWithin(ftp.quit(), 5000)
        assert.strict.deepEqual(rq.settled, true, 'stat逾時後quit須結束')
        await ftp.conn()
        let r2 = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), TL + 10000)
        assert.strict.deepEqual(r2.settled && r2.ok, true, `再conn後須可下載: ${String(r2.err)}`)
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        g.open()
        un.stop()
        assert.strict.deepEqual(un.list, [], '不得有未處理之rejection')
    })

    it('逾時後之進度回呼不再通知(對照: 正常下載有進度回呼): 放行後背景傳輸結束, 逾時後cbProcess零次', async function() {
        let fd = prepOut('n21')
        let fdTemp = `${fdBase}/temp-n21`
        let g = gate()
        let bStall = false
        let srv = await newSrv({
            READ: (ctx) => {
                if (bStall) {
                    g.wait().then(() => {
                        try {
                            ctx.respond()
                        }
                        catch (err) {}
                    })
                    return
                }
                ctx.respond()
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: TL })

        //對照: 正常下載有進度回呼
        let nOk = 0
        await ftp.download('./big.bin', `${fd}/big.bin`, () => {
            nOk++
        })
        assert.strict.ok(nOk > 0, '正常下載須有進度回呼(對照)')

        //停滯至逾時, 其後放行
        bStall = true
        let nLate = 0
        let rec = recorder()
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, () => {
            nLate++
        }, { onTrace: rec.onTrace }), TL + 10000)
        assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`)
        g.open()
        await rec.wait((e) => e.type === 'transfer' && e.late === true)
        await rec.wait((e) => e.type === 'temp' && e.act === 'remove')
        assert.strict.deepEqual(nLate, 0) //規格: 逾時後之進度回呼不再通知
        assertFile(`${fd}/big.bin`, bufBig, '目標維持前一次正常下載之內容(逾時之背景傳輸不覆蓋)')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('崩潰殘留之清理(接線): 暫存區內逾24小時、本套件命名格式、行程已不存在之殘檔於首次使用時被清, 其餘(新近、非格式、行程仍存在(以本行程之id代表))不動', async function() {
        let fd = `${fdOut}/n22`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-n22`
        w.fsCleanFolder(fdTemp)
        let pidDead = deadPid()
        let nm = {
            stale: `old.bin.${pidDead}.ABCDEFGH.part`,
            fresh: `fresh.bin.${pidDead}.ABCDEFGH.part`,
            other: 'notes.txt',
            own: `own.bin.${process.pid}.ABCDEFGH.part`,
        }
        for (let k of Object.keys(nm)) {
            fs.writeFileSync(`${fdTemp}/${nm[k]}`, k, 'utf8')
        }
        let tOld = new Date(Date.now() - 25 * 3600 * 1000)
        for (let k of ['stale', 'other', 'own']) {
            fs.utimesSync(`${fdTemp}/${nm[k]}`, tOld, tOld)
        }
        let rec = recorder()
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await ftp.download('./top.txt', `${fd}/top.txt`, null, { onTrace: rec.onTrace })
        assert.strict.deepEqual(r, 'ok')
        assert.strict.deepEqual(rec.evs[0], { type: 'sweep', removed: 1 }) //規格(主控裁定7): 只清逾24小時且為本套件命名格式者
        assert.strict.deepEqual(listDir(fdTemp), [nm.fresh, nm.other, nm.own].sort())
    })

    it('遠端為空檔(大小0): 下載成功, 目標之舊內容被取代為空檔, 暫存區無殘檔', async function() {
        let fd = prepOut('n24')
        let fdTemp = `${fdBase}/temp-n24`
        fs.writeFileSync(`${fdSrv}/empty-case.bin`, '')
        try {
            let srv = await newSrv()
            let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
            let rec = recorder()
            let r = await settleWithin(ftp.download('./empty-case.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), 15000)
            assert.strict.deepEqual(r.settled && r.ok, true, `空檔須可下載: ${String(r.err)}`)
            assert.strict.deepEqual(rec.evs.find((e) => e.type === 'verify'), { type: 'verify', ok: true, size: 0, sizeRemote: 0 })
            assertFile(`${fd}/big.bin`, Buffer.alloc(0), '目標須為空檔')
            assert.strict.deepEqual(listDir(fdTemp), [])
        }
        finally {
            fs.rmSync(`${fdSrv}/empty-case.bin`, { force: true })
        }
    })

    it('timeLimit為0或負數: 視為未給而用預設(setTimeout會把它當作1毫秒, SFTP下載自本版起受timeLimit約束, 不得因此立即逾時), 下載成功', async function() {
        let fd = `${fdOut}/n26`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-n26`
        let srv = await newSrv()
        for (let tl of [0, -5]) {
            let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: tl })
            let r = await settleWithin(ftp.download('./big.bin', `${fd}/big${tl}.bin`), 15000)
            assert.strict.deepEqual(r.settled && r.ok, true, `timeLimit=${tl}須可下載: ${String(r.err)}`)
            assertFile(`${fd}/big${tl}.bin`, bufBig, `timeLimit=${tl}`)
        }
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('syncToLocal之opt為null或非物件: 視為未給, 不拋錯, 依預設行為同步', async function() {
        let fd = `${fdOut}/n25`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-n25`
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.syncToLocal('.', fd, null, null), 15000)
        assert.strict.deepEqual(r.settled && r.ok, true, String(r.err))
        assert.strict.deepEqual(r.value.num, 5) //預設不限層數: big.bin、top.txt、a/same.bin、b/same.bin、sub/deep.txt
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('timeLimit預設為60000毫秒(假時鐘, 規格主控裁定2): 未給timeLimit時, 伺服器停滯於STAT, 差1毫秒不逾時, 到60000毫秒即逾時', async function() {
        let fd = prepOut('n23')
        let fdTemp = `${fdBase}/temp-n23`
        let g = gate()
        let srv = await newSrv({
            STAT: (ctx) => {
                g.wait().then(() => {
                    try {
                        ctx.respond()
                    }
                    catch (err) {}
                })
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: undefined })
        let state = { settled: false }
        try {
            mock.timers.enable({ apis: ['setTimeout'] })
            let p = ftp.download('./big.bin', `${fd}/big.bin`)
            p.then(() => {
                state.settled = true
            }, () => {
                state.settled = true
            })
            await new Promise((resolve) => setImmediate(resolve)) //讓出使download內之計時器建立
            await new Promise((resolve) => setImmediate(resolve))
            mock.timers.tick(59999)
            await new Promise((resolve) => setImmediate(resolve))
            assert.strict.deepEqual(state.settled, false, '差1毫秒不得逾時')
            mock.timers.tick(1)
            let r = await settleWithin(p, 5000)
            assert.strict.deepEqual(r.err, 'ftpDownload timeout[60000]')
        }
        finally {
            mock.timers.reset()
            g.open()
        }
    })

})
