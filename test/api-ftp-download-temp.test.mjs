import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { Writable } from 'stream'
import { mock } from 'node:test'
import w from 'wsemi'
import WFtp from '../src/WFtp.mjs'
import fakeFtpServer from './lib/fakeFtpServer.mjs'
import { genBytes, listDir, recorder, settleWithin, gate, signal, assertFile, deadPid } from './lib/dlTestKit.mjs'


//FTP下載先寫入暫存區, 確定完成(數據連線結束且本地大小等於遠端大小)才移至目標(真實WFtp經假FTP伺服器, 不替身jsftp)
//規格(使用端需求, 2026-11-26): 同api-sftp-download-temp; FTP另有: 數據連線中途正常關閉而不送錯誤時(jsftp不回報), 須以大小核對判定未完成;
//  取得數據socket即失敗(425)、遠端非檔案時, 目標之舊檔不動(原版於下載前即刪除舊檔)
describe('api-ftp-download-temp', function() {

    //fdBase, 測試臨時資料夾(依測試規範放test/_tmp/<案名>/)
    let fdBase = './test/_tmp/ftp-download-temp'
    let fdSrv = `${fdBase}/srv`
    let fdOut = `${fdBase}/out`

    //big, 逐位元組相異之合成內容
    let nBig = 200000 + 77
    let bufBig = genBytes(nBig, 5)

    //old, 目標既有之舊檔內容
    let OLD = 'OLD-content-must-stay'

    //TL, 逾時案之timeLimit; 逾時後同一實例之重試(正常下載)亦受此限, 故不取過小之值以免負載下誤判
    let TL = 2000

    let servers = []
    let clients = []

    //newSrv, 每案各自起伺服器(各自之攔截), 案末關閉
    let newSrv = async (hooks) => {
        let srv = await fakeFtpServer({ fdRoot: fdSrv, hooks })
        servers.push(srv)
        return srv
    }

    //newFtp
    let newFtp = async (srv, o = {}) => {
        let ftp = WFtp({
            transportation: 'FTP',
            hostname: '127.0.0.1',
            port: srv.port,
            username: 'u1',
            password: 'p1',
            timeLimit: 10000,
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
        w.fsCreateFolder(`${fdSrv}/sub`)
        fs.writeFileSync(`${fdSrv}/big.bin`, bufBig)
        fs.writeFileSync(`${fdSrv}/top.txt`, 'top-1', 'utf8')
        fs.writeFileSync(`${fdSrv}/sub/deep.txt`, 'deep-22', 'utf8')
    })

    afterEach(async function() {
        mock.restoreAll()
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

    it('正常下載(單次呼叫指定暫存區): 內容逐位元組相同, 經暫存區改名移至目標, 暫存區無殘檔', async function() {
        let fd = prepOut('f1')
        let fdTemp = `${fdBase}/temp-f1`
        let rec = recorder()
        let srv = await newSrv()
        let ftp = await newFtp(srv)
        let r = await ftp.download('./big.bin', `${fd}/big.bin`, null, { fdDownloadTemp: fdTemp, onTrace: rec.onTrace })
        assert.strict.deepEqual(r, 'ok')
        assertFile(`${fd}/big.bin`, bufBig, '目標內容須與遠端逐位元組相同')
        assert.strict.deepEqual(listDir(fdTemp), [])
        assert.strict.deepEqual(listDir(fd), ['big.bin'])
        assert.strict.deepEqual(rec.evs.map((e) => e.type), ['sweep', 'temp', 'transfer', 'verify', 'move']) //規格: 先寫暫存、核對大小後才移動(sweep為首次使用該暫存區之殘留清理)
        assert.strict.deepEqual(rec.evs[4], { type: 'move', mode: 'rename' })
    })

    it('數據連線傳一半即正常關閉且無錯誤(jsftp不回報): 以大小核對判定未完成而reject, 目標之舊檔不動, 暫存區無殘檔', async function() {
        let fd = prepOut('f2')
        let fdTemp = `${fdBase}/temp-f2`
        let srv = await newSrv({
            RETR: async (ctx) => {
                ctx.reply('150 opening data connection')
                let ds = await ctx.waitDs()
                ds.once('close', () => {
                    ctx.reply('226 transfer complete') //照常回完成, 不送任何錯誤
                    ctx.closeDsrv()
                })
                ds.end(ctx.data.subarray(0, 70001)) //只送前段即正常關閉
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.settled, true)
        assert.strict.deepEqual(r.ok, false, '傳一半即關閉須reject(原版回ok並留下半截檔)') //規格: 確定完成須含大小核對
        assert.strict.deepEqual(r.err, `ftpDownload: downloaded size[70001] does not match remote size[${nBig}], fpLocal is not changed`)
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fd), ['big.bin'])
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('數據連線傳一半即被重置(RST): reject, 目標之舊檔不動, 暫存區無殘檔', async function() {
        let fd = prepOut('f3')
        let fdTemp = `${fdBase}/temp-f3`
        let srv = await newSrv({
            RETR: async (ctx) => {
                ctx.reply('150 opening data connection')
                let ds = await ctx.waitDs()
                ds.once('close', () => {
                    ctx.reply('426 connection closed; transfer aborted')
                    ctx.closeDsrv()
                })
                ds.write(ctx.data.subarray(0, 50000), () => {
                    ds.resetAndDestroy()
                })
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.settled, true)
        assert.strict.deepEqual(r.ok, false, '連線被重置須reject')
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('timeLimit生效(每檔自傳輸開始起計): 數據停滯時逾時reject並中止傳輸, 暫存清除, 目標之舊檔不動; 之後quit不卡住, 再conn可下載', async function() {
        let fd = prepOut('f4')
        let fdTemp = `${fdBase}/temp-f4`
        let g = gate()
        let nRetr = 0
        let srv = await newSrv({
            RETR: async (ctx) => {
                nRetr++
                ctx.reply('150 opening data connection')
                let ds = await ctx.waitDs()
                if (nRetr === 1) {
                    await g.wait() //第1次停滯, 不送數據
                    if (!ds.destroyed) {
                        ds.end(ctx.data)
                    }
                    ctx.closeDsrv()
                    return
                }
                ds.once('close', () => {
                    ctx.reply('226 transfer complete')
                    ctx.closeDsrv()
                })
                ds.end(ctx.data)
            },
        })
        let rec = recorder()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: TL })
        let t0 = Date.now()
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), TL + 10000)
        let dt = Date.now() - t0
        assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`) //規格: timeLimit須生效
        assert.strict.ok(dt >= TL - 10, `逾時不得早於timeLimit: ${dt}`)
        await rec.wait((e) => e.type === 'temp' && e.act === 'remove') //中止傳輸後暫存檔被清
        assert.strict.deepEqual(rec.evs.some((e) => e.type === 'move'), false)
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔') //規格: 目標不得出現殘檔, 舊檔不動
        assert.strict.deepEqual(listDir(fdTemp), [])

        //quit不卡住(控制連線可能仍在等待前一指令, 至多依timeLimit逾時結束), 再conn重用同一實例
        let rq = await settleWithin(ftp.quit(), TL + 5000)
        assert.strict.deepEqual(rq.settled, true, '逾時後quit須結束')
        await ftp.conn()
        let r2 = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), TL + 10000)
        assert.strict.deepEqual(r2.settled && r2.ok, true, `再conn後須可下載: ${String(r2.err)}`)
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        assert.strict.deepEqual(listDir(fdTemp), [])
        g.open()
    })

    it('寫入暫存檔失敗(如磁碟已滿, 以替換fs.createWriteStream模擬): 以該錯誤reject, 目標之舊檔不動, 暫存區無殘檔', async function() {
        let fd = prepOut('f8')
        let fdTemp = path.resolve(`${fdBase}/temp-f8`)
        let createReal = fs.createWriteStream
        mock.method(fs, 'createWriteStream', (fp, ...args) => {
            if (!path.resolve(String(fp)).startsWith(fdTemp)) {
                return createReal(fp, ...args)
            }
            return new Writable({
                write: (chunk, enc, cb) => {
                    let e = new Error('mock no space')
                    e.code = 'ENOSPC'
                    cb(e)
                },
            })
        })
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.settled, true)
        assert.strict.ok(r.err instanceof Error && r.err.code === 'ENOSPC', `須以寫入錯誤reject: ${String(r.err)}`) //寫入失敗即失敗, 不以大小不符掩蓋原因
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('取得數據socket即失敗(425): reject, 目標之舊檔不動(原版於下載前即刪除), 暫存區無殘檔', async function() {
        let fd = prepOut('f5')
        let fdTemp = `${fdBase}/temp-f5`
        let srv = await newSrv({
            RETR: async (ctx) => {
                ctx.reply('425 can not open data connection')
                ctx.closeDsrv()
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.settled, true)
        assert.strict.deepEqual(r.ok, false)
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔') //規格: 移動前目標之舊檔保持不動(不要先刪)
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('遠端非檔案(不存在): reject, 目標之舊檔不動(原版於查詢遠端前即刪除)', async function() {
        let fd = prepOut('f6')
        let fdTemp = `${fdBase}/temp-f6`
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./nonexist.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.err, 'fpRemote[./nonexist.bin] is not a file')
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('syncToLocal: 轉交單次呼叫之fdDownloadTemp與onTrace, 各檔經暫存區, 內容正確', async function() {
        let fd = `${fdOut}/f7`
        w.fsCleanFolder(fd)
        let fdTemp = path.resolve(`${fdBase}/temp-f7`)
        let nCreate = 0
        let rec = recorder((e) => {
            if (e.type === 'temp' && e.act === 'create') {
                nCreate += listDir(fdTemp).length //建立當下暫存檔確在指定之暫存區
            }
        })
        let srv = await newSrv()
        let ftp = await newFtp(srv)
        let r = await ftp.syncToLocal('.', fd, null, { fdDownloadTemp: fdTemp, onTrace: rec.onTrace })
        assert.strict.deepEqual(r.num, 3)
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        assert.strict.deepEqual(fs.readFileSync(`${fd}/sub/deep.txt`, 'utf8'), 'deep-22')
        assert.strict.deepEqual(nCreate, 3)
        assert.strict.deepEqual(rec.evs.filter((e) => e.type === 'move').length, 3)
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('timeLimit為0或負數: 視為未給而用預設(setTimeout會把它當作1毫秒而使操作立即逾時), 下載成功', async function() {
        let fd = `${fdOut}/f17`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-f17`
        let srv = await newSrv()
        for (let tl of [0, -5]) {
            let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: tl })
            let r = await settleWithin(ftp.download('./big.bin', `${fd}/big${tl}.bin`), 15000)
            assert.strict.deepEqual(r.settled && r.ok, true, `timeLimit=${tl}須可下載: ${String(r.err)}`)
            assertFile(`${fd}/big${tl}.bin`, bufBig, `timeLimit=${tl}`)
        }
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('syncToLocal之opt為null: 視為未給, 不拋錯, 依預設行為同步(不限層數)', async function() {
        let fd = `${fdOut}/f16`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-f16`
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.syncToLocal('.', fd, null, null), 15000)
        assert.strict.deepEqual(r.settled && r.ok, true, String(r.err))
        assert.strict.deepEqual(r.value.num, 3) //big.bin、top.txt、sub/deep.txt
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('遠端為空檔(大小0): 下載成功, 目標之舊內容被取代為空檔, 暫存區無殘檔', async function() {
        let fd = prepOut('f14')
        let fdTemp = `${fdBase}/temp-f14`
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

    it('取不到遠端大小(伺服器之SIZE指令失敗): 無從核對是否下載完整, 預設拒絕reject, 不下載, 目標之舊檔不動', async function() {
        let fd = prepOut('f15')
        let fdTemp = `${fdBase}/temp-f15`
        let nRetr = 0
        let srv = await newSrv({
            SIZE: (ctx) => {
                ctx.reply('550 size not available')
            },
            RETR: async (ctx) => {
                nRetr++
                ctx.reply('425 can not open data connection')
                ctx.closeDsrv()
            },
        })
        let rec = recorder()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), 15000)
        assert.strict.deepEqual(r.err, 'can not get the size of file[./big.bin]')
        assert.strict.deepEqual(nRetr, 0) //未進入傳輸
        assert.strict.deepEqual(rec.evs, [])
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('實例層級之fdDownloadTemp(接線): 傳輸進行中暫存檔(專用檔名)在實例指定之暫存區, 目標之舊檔不動; 完成後才取代', async function() {
        let fd = prepOut('f13')
        let fdTemp = `${fdBase}/temp-f13`
        let snap = null
        let srv = await newSrv({
            RETR: async (ctx) => {
                snap = { temp: listDir(fdTemp), target: fs.readFileSync(`${fd}/big.bin`, 'utf8') } //傳輸進行中(伺服器已收到RETR)
                ctx.reply('150 opening data connection')
                let ds = await ctx.waitDs()
                ds.once('close', () => {
                    ctx.reply('226 transfer complete')
                    ctx.closeDsrv()
                })
                ds.end(ctx.data)
            },
        })
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`), 15000)
        assert.strict.deepEqual(r.settled && r.ok, true, String(r.err))
        assert.strict.deepEqual(snap.temp.length, 1) //規格: 先存放到暫存區
        assert.strict.ok(/^big\.bin\.\d+\.[0-9A-Za-z]{8}\.part$/.test(snap.temp[0]), `暫存檔名格式不符: ${snap.temp[0]}`)
        assert.strict.deepEqual(snap.target, OLD) //規格: 移動前目標之舊檔保持不動
        assertFile(`${fd}/big.bin`, bufBig, '完成後目標須為新內容')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('逾時後才取得數據socket(伺服器延後回150): 直接銷毀不寫入, 背景結束只清不移, 目標之舊檔不動', async function() {
        let fd = prepOut('f12')
        let fdTemp = `${fdBase}/temp-f12`
        let g = gate()
        let srv = await newSrv({
            RETR: async (ctx) => {
                await g.wait() //延後至逾時之後才回150
                ctx.reply('150 opening data connection')
                let ds = await ctx.waitDs()
                ds.once('close', () => {
                    ctx.reply('226 transfer complete')
                    ctx.closeDsrv()
                })
                ds.end(ctx.data)
            },
        })
        let rec = recorder()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp, timeLimit: TL })
        let r = await settleWithin(ftp.download('./big.bin', `${fd}/big.bin`, null, { onTrace: rec.onTrace }), TL + 10000)
        assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`)
        g.open()
        let [evTransfer] = await rec.wait((e) => e.type === 'transfer' && e.late === true)
        assert.strict.deepEqual(evTransfer.ok, false) //已逾時才取得之socket不寫入, 傳輸以失敗結束(原寫入則為成功)
        await rec.wait((e) => e.type === 'temp' && e.act === 'remove')
        assert.strict.deepEqual(rec.evs.some((e) => e.type === 'move'), false)
        assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('移動遇占用(rename先回EBUSY再成功, 以替換fs.promises.rename模擬): 有界重試後成功, 目標為新內容, 暫存區無殘檔', async function() {
        let fd = prepOut('f9')
        let fdTemp = `${fdBase}/temp-f9`
        let renameReal = fs.promises.rename
        let nBusy = 0
        mock.method(fs.promises, 'rename', async (a, b) => {
            if (path.resolve(String(a)).startsWith(path.resolve(fdTemp)) && nBusy < 1) {
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
        assert.strict.deepEqual(rec.evs.filter((e) => e.type === 'retry'), [{ type: 'retry', n: 1, code: 'EBUSY' }])
        assertFile(`${fd}/big.bin`, bufBig, '目標須為新內容')
        assert.strict.deepEqual(listDir(fdTemp), [])
    })

    it('崩潰殘留之清理(接線): 暫存區內逾24小時、本套件命名格式、行程已不存在之殘檔於首次使用時被清, 其餘不動', async function() {
        let fd = `${fdOut}/f10`
        w.fsCleanFolder(fd)
        let fdTemp = `${fdBase}/temp-f10`
        w.fsCleanFolder(fdTemp)
        let pidDead = deadPid()
        let nmStale = `old.bin.${pidDead}.ABCDEFGH.part`
        let nmFresh = `fresh.bin.${pidDead}.ABCDEFGH.part`
        let nmOther = 'notes.txt'
        for (let nm of [nmStale, nmFresh, nmOther]) {
            fs.writeFileSync(`${fdTemp}/${nm}`, nm, 'utf8')
        }
        let tOld = new Date(Date.now() - 25 * 3600 * 1000)
        for (let nm of [nmStale, nmOther]) {
            fs.utimesSync(`${fdTemp}/${nm}`, tOld, tOld)
        }
        let rec = recorder()
        let srv = await newSrv()
        let ftp = await newFtp(srv, { fdDownloadTemp: fdTemp })
        let r = await ftp.download('./top.txt', `${fd}/top.txt`, null, { onTrace: rec.onTrace })
        assert.strict.deepEqual(r, 'ok')
        assert.strict.deepEqual(rec.evs[0], { type: 'sweep', removed: 1 }) //規格(主控裁定7)
        assert.strict.deepEqual(listDir(fdTemp), [nmFresh, nmOther].sort())
    })

    it('timeLimit預設為60000毫秒(假時鐘, 規格主控裁定2): 未給timeLimit時, 伺服器停滯於RETR, 差1毫秒不逾時, 到60000毫秒即逾時', async function() {
        let fd = prepOut('f11')
        let fdTemp = `${fdBase}/temp-f11`
        let g = gate()
        let sgStart = signal()
        let srv = await newSrv({
            RETR: async (ctx) => {
                sgStart.fire()
                await g.wait() //不回覆RETR, 使傳輸階段停滯; 放行後回426使控制連線不再等待(否則其後之quit須等到逾時)
                ctx.reply('426 transfer aborted')
                ctx.closeDsrv()
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
            await sgStart.wait() //伺服器已收到RETR, 傳輸階段之計時器已建立
            mock.timers.tick(59999)
            await new Promise((resolve) => setImmediate(resolve))
            assert.strict.deepEqual(state.settled, false, '差1毫秒不得逾時')
            mock.timers.tick(1)
            let r = await settleWithin(p, 5000)
            assert.strict.deepEqual(r.err, 'ftpDownload timeout[60000]')
            assertFile(`${fd}/big.bin`, OLD, '目標須為舊檔')
        }
        finally {
            mock.timers.reset()
            g.open()
        }
    })

})
