import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { mock } from 'node:test'
import w from 'wsemi'
import downloadViaTemp from '../src/downloadViaTemp.mjs'
import { genBytes, listDir, recorder, settleWithin, signal, assertFile, deadPid, setTimeoutReal } from './lib/dlTestKit.mjs'


//下載共用流程(downloadViaTemp)之單元測試: 傳輸以替身函數取代(不連任何伺服器), 時間本身為規格者(逾時門檻、重試間隔)以假時鐘驗證, 事件同步以onTrace為準
//規格(使用端需求與主控裁定, 2026-11-26): 先寫暫存、確定完成(傳輸成功且大小相符)才移至目標、舊檔於此之前不動;
//  timeLimit自傳輸開始起計, 到時即reject、中止傳輸、先刪暫存檔名, 其後之背景傳輸結束只清不移; 移動遇占用有界重試; 暫存區之崩潰殘留只清逾24小時且為本套件命名格式者
describe('unit-download-via-temp', function() {

    //fdBase, 測試臨時資料夾(依測試規範放test/_tmp/<案名>/)
    let fdBase = './test/_tmp/unit-download-via-temp'
    let fdOut = `${fdBase}/out`

    //fdTemp, 各案專用之暫存區(同一行程對同一暫存區之殘留清理有最短間隔, 故每案各用一個)
    let fdTemp = ''
    let nSeq = 0

    //TL, 逾時門檻(假時鐘下不實際等待)
    let TL = 5000

    //OLD, 目標既有之舊檔內容
    let OLD = 'OLD-content-must-stay'

    //buf, 逐位元組相異之合成內容(筆數取不整除之數)
    let buf = genBytes(1234, 7)

    //flush, 讓出事件迴圈使已就緒之微任務與I/O回呼先執行(setImmediate不受假時鐘影響)
    let flush = async () => {
        for (let i = 0; i < 5; i++) {
            await new Promise((resolve) => setImmediate(resolve))
        }
    }

    //prepOut, 建立含舊檔之目標資料夾, 回傳目標檔路徑
    let prepOut = (name) => {
        let fd = `${fdOut}/${name}`
        w.fsCleanFolder(fd)
        fs.writeFileSync(`${fd}/t.bin`, OLD, 'utf8')
        return `${fd}/t.bin`
    }

    //run, 以替身傳輸呼叫downloadViaTemp
    let run = (fpLocal, transfer, o = {}) => {
        return downloadViaTemp({
            fpLocal,
            fileSize: buf.length,
            timeLimit: TL,
            fdTempInst: path.resolve(fdTemp),
            optCall: {},
            transfer,
            ...o,
        })
    }

    //writeAll, 傳輸替身: 將內容(預設buf)寫入暫存檔後結束
    let writeAll = (content = buf) => {
        return async (fpTemp) => {
            await fs.promises.writeFile(fpTemp, content)
        }
    }

    //rename之替身, 回傳{ calls }; 依序以errs指定各次呼叫之錯誤碼(null代表放行為真實rename), 超出者放行
    let mockRename = (errs, filter = () => true) => {
        let renameReal = fs.promises.rename
        let st = { calls: 0 }
        mock.method(fs.promises, 'rename', async (a, b) => {
            if (!filter(String(a), String(b))) {
                return renameReal(a, b)
            }
            let code = st.calls < errs.length ? errs[st.calls] : null
            st.calls++
            if (code !== null) {
                let e = new Error('mock')
                e.code = code
                throw e
            }
            return renameReal(a, b)
        })
        return st
    }

    before(function() {
        w.fsDeleteFolder(fdBase)
        w.fsCreateFolder(fdOut)
    })

    beforeEach(function() {
        nSeq++
        fdTemp = `${fdBase}/temp-${nSeq}`
        w.fsCleanFolder(fdTemp)
    })

    afterEach(function() {
        mock.timers.reset()
        mock.restoreAll()
    })

    after(function() {
        w.fsDeleteFolder(fdBase)
    })

    describe('resolveFdTemp', function() {

        it('不含NUL之非空字串轉絕對路徑; 其餘(undefined、null、空字串、非字串、包裝物件、含NUL)改用預設', function() {
            let def = './def-dir'
            assert.strict.deepEqual(downloadViaTemp.resolveFdTemp('./a/b', def), path.resolve('./a/b'))
            assert.strict.deepEqual(downloadViaTemp.fdTempDefault, './_wftpDownloadTemp') //規格(主控裁定1): 預設為cwd相對之./_wftpDownloadTemp
            for (let v of [undefined, null, '', 0, false, 123, [], {}, ['x'], new String('x'), 'a\0b']) { // eslint-disable-line no-new-wrappers
                assert.strict.ok(downloadViaTemp.resolveFdTemp(v, def) === path.resolve(def), `輸入[${typeof v}]須改用預設`)
            }
        })

    })

    describe('流程與移動', function() {

        it('成功: 內容由暫存區改名取代舊檔, 事件依序sweep,temp,transfer,verify,move', async function() {
            let fp = prepOut('u1')
            let rec = recorder()
            let r = await run(fp, writeAll(), { optCall: { onTrace: rec.onTrace } })
            assert.strict.deepEqual(r, 'ok')
            assertFile(fp, buf, '目標須為新內容')
            assert.strict.deepEqual(rec.evs.map((e) => e.type), ['sweep', 'temp', 'transfer', 'verify', 'move'])
            assert.strict.deepEqual(rec.evs.find((e) => e.type === 'verify'), { type: 'verify', ok: true, size: buf.length, sizeRemote: buf.length })
            assert.strict.deepEqual(listDir(fdTemp), [])
            assert.strict.deepEqual(listDir(path.dirname(fp)), ['t.bin'])
        })

        it('遠端為空檔(大小0): 成功, 目標為空檔', async function() {
            let fp = prepOut('u1e')
            let r = await run(fp, writeAll(Buffer.alloc(0)), { fileSize: 0 })
            assert.strict.deepEqual(r, 'ok')
            assertFile(fp, Buffer.alloc(0), '目標須為空檔')
        })

        it('傳輸中暫存檔存在於暫存區, 目標舊檔不動; 傳輸函數拋出同步錯誤或reject: 原錯誤reject, 暫存清除, 舊檔不動', async function() {
            let fp = prepOut('u2')
            let seen = null
            let r = await settleWithin(run(fp, async (fpTemp) => {
                seen = { temp: listDir(fdTemp).length, target: fs.readFileSync(fp, 'utf8') }
                throw new Error('boom')
            }), 5000)
            assert.strict.deepEqual(seen, { temp: 1, target: OLD }) //規格: 先寫暫存區, 舊檔不動
            assert.strict.ok(r.err instanceof Error && r.err.message === 'boom', '須以傳輸之原錯誤reject')
            assertFile(fp, OLD, '目標須為舊檔')
            assert.strict.deepEqual(listDir(fdTemp), [])
            let r2 = await settleWithin(run(fp, () => {
                throw new Error('sync boom')
            }), 5000)
            assert.strict.ok(r2.err instanceof Error && r2.err.message === 'sync boom', '同步拋錯亦須reject')
            assertFile(fp, OLD, '目標須為舊檔')
            assert.strict.deepEqual(listDir(fdTemp), [])
        })

        it('大小不符(少一位元組、多一位元組): reject寫明大小, 暫存清除, 舊檔不動', async function() {
            let fp = prepOut('u3')
            for (let content of [buf.subarray(0, buf.length - 1), Buffer.concat([buf, Buffer.from([1])])]) {
                let rec = recorder()
                let r = await settleWithin(run(fp, writeAll(content), { optCall: { onTrace: rec.onTrace } }), 5000)
                assert.strict.deepEqual(r.err, `ftpDownload: downloaded size[${content.length}] does not match remote size[${buf.length}], fpLocal is not changed`)
                assert.strict.deepEqual(rec.evs.some((e) => e.type === 'move'), false)
                assertFile(fp, OLD, '目標須為舊檔')
                assert.strict.deepEqual(listDir(fdTemp), [])
            }
        })

        it('暫存區無法建立(其路徑為既有檔案): reject, 不呼叫傳輸函數, 舊檔不動', async function() {
            let fp = prepOut('u4')
            let fdBad = `${fdBase}/bad-temp`
            fs.writeFileSync(fdBad, 'file', 'utf8')
            let nCall = 0
            let rec = recorder()
            let r = await settleWithin(run(fp, async () => {
                nCall++
            }, { fdTempInst: path.resolve(fdBad), optCall: { onTrace: rec.onTrace } }), 5000)
            assert.strict.ok(typeof r.err === 'string' && r.err.startsWith('ftpDownload: can not create a temporary file in fdDownloadTemp ('), `訊息不符: ${String(r.err)}`)
            assert.strict.deepEqual(nCall, 0)
            assert.strict.deepEqual(rec.evs.find((e) => e.type === 'temp'), { type: 'temp', act: 'create', ok: false })
            assertFile(fp, OLD, '目標須為舊檔')
            fs.unlinkSync(fdBad)
        })

        it('單次呼叫之opt為已撤銷之Proxy(讀取即拋錯): 視為未給, 不拋錯, 用實例層級暫存區', async function() {
            let fp = prepOut('u5')
            let p = new Proxy({}, {
                get: () => {
                    throw new Error('revoked')
                },
            })
            let r = await run(fp, writeAll(), { optCall: p })
            assert.strict.deepEqual(r, 'ok')
            assertFile(fp, buf, '目標須為新內容')
        })

        it('跨磁碟(rename回EXDEV): 先複製至目標同資料夾暫存名, 再改名遇占用(EBUSY)重試1次後成功; 兩處皆無殘檔', async function() {
            let fp = prepOut('u6')
            let st = mockRename(['EXDEV', 'EBUSY'])
            let rec = recorder()
            let r = await settleWithin(run(fp, writeAll(), { optCall: { onTrace: rec.onTrace } }), 5000)
            assert.strict.deepEqual(r.ok, true, String(r.err))
            assert.strict.deepEqual(st.calls, 3) //暫存區→目標(EXDEV), 同資料夾暫存名→目標(EBUSY, EBUSY後成功)
            assert.strict.deepEqual(rec.evs.filter((e) => e.type === 'retry'), [{ type: 'retry', n: 1, code: 'EBUSY' }])
            assert.strict.deepEqual(rec.evs.find((e) => e.type === 'move'), { type: 'move', mode: 'copy' })
            assertFile(fp, buf, '目標須為新內容')
            assert.strict.deepEqual(listDir(path.dirname(fp)), ['t.bin'])
            assert.strict.deepEqual(listDir(fdTemp), [])
        })

        it('跨磁碟且同資料夾改名遇非占用錯誤(ENOSPC): 不重試, 刪除目標同資料夾暫存名與暫存檔, reject, 舊檔不動', async function() {
            let fp = prepOut('u7')
            let st = mockRename(['EXDEV', 'ENOSPC'])
            let rec = recorder()
            let r = await settleWithin(run(fp, writeAll(), { optCall: { onTrace: rec.onTrace } }), 5000)
            assert.strict.deepEqual(r.err, 'ftpDownload: can not move the downloaded file to fpLocal (ENOSPC), fpLocal is not changed')
            assert.strict.deepEqual(st.calls, 2)
            assert.strict.deepEqual(rec.evs.some((e) => e.type === 'retry'), false)
            assertFile(fp, OLD, '目標須為舊檔')
            assert.strict.deepEqual(listDir(path.dirname(fp)), ['t.bin'])
            assert.strict.deepEqual(listDir(fdTemp), [])
        })

        it('改名重試之間隔為200毫秒乘嘗試次數(假時鐘): 第1次失敗後等200, 第2次失敗後等400; 用盡共5次嘗試後reject, 暫存清除, 舊檔不動', async function() {
            let fp = prepOut('u8')
            let st = mockRename(['EBUSY', 'EPERM', 'EBUSY', 'EACCES', 'EBUSY'])
            let rec = recorder()
            let sg = signal()
            mock.timers.enable({ apis: ['setTimeout'] })
            let p = run(fp, async (fpTemp) => {
                await fs.promises.writeFile(fpTemp, buf)
                sg.fire()
            }, { optCall: { onTrace: rec.onTrace } })
            let pr = settleWithin(p, 20000)
            await sg.wait()
            await rec.wait((e) => e.type === 'retry' && e.n === 1) //第1次失敗, 進入等待200
            assert.strict.deepEqual(st.calls, 1)
            mock.timers.tick(199)
            await flush()
            assert.strict.deepEqual(st.calls, 1, '未滿200毫秒不得再嘗試')
            mock.timers.tick(1)
            await rec.wait((e) => e.type === 'retry' && e.n === 2) //第2次失敗, 進入等待400
            assert.strict.deepEqual(st.calls, 2)
            mock.timers.tick(399)
            await flush()
            assert.strict.deepEqual(st.calls, 2, '未滿400毫秒不得再嘗試')
            mock.timers.tick(1)
            await rec.wait((e) => e.type === 'retry' && e.n === 3)
            mock.timers.tick(600)
            await rec.wait((e) => e.type === 'retry' && e.n === 4)
            mock.timers.tick(800) //第5次嘗試(最後一次)失敗即用盡
            let r = await pr
            assert.strict.deepEqual(r.err, 'ftpDownload: can not move the downloaded file to fpLocal (EBUSY), fpLocal is not changed')
            assert.strict.deepEqual(st.calls, 5) //規格(主控裁定8): 有界
            assert.strict.deepEqual(rec.evs.filter((e) => e.type === 'retry').map((e) => e.code), ['EBUSY', 'EPERM', 'EBUSY', 'EACCES'])
            assertFile(fp, OLD, '目標須為舊檔')
            assert.strict.deepEqual(listDir(fdTemp), [])
        })

        it('改名遇非占用錯誤(ENOENT): 不重試即reject', async function() {
            let fp = prepOut('u9')
            let st = mockRename(['ENOENT'])
            let rec = recorder()
            let r = await settleWithin(run(fp, writeAll(), { optCall: { onTrace: rec.onTrace } }), 5000)
            assert.strict.deepEqual(r.err, 'ftpDownload: can not move the downloaded file to fpLocal (ENOENT), fpLocal is not changed')
            assert.strict.deepEqual(st.calls, 1)
            assert.strict.deepEqual(rec.evs.some((e) => e.type === 'retry'), false)
            assertFile(fp, OLD, '目標須為舊檔')
        })

        it('目標為既有資料夾: 傳輸前即reject(不呼叫傳輸函數、不建立暫存檔), 資料夾不動', async function() {
            let fd = `${fdOut}/u10`
            w.fsCleanFolder(fd)
            w.fsCreateFolder(`${fd}/t.bin`)
            fs.writeFileSync(`${fd}/t.bin/keep.txt`, 'keep', 'utf8')
            let nCall = 0
            let rec = recorder()
            let r = await settleWithin(run(`${fd}/t.bin`, async () => {
                nCall++
            }, { optCall: { onTrace: rec.onTrace } }), 5000)
            assert.strict.deepEqual(r.err, 'ftpDownload: fpLocal is a directory, fpLocal is not changed')
            assert.strict.deepEqual(nCall, 0) //省去整檔傳輸
            assert.strict.deepEqual(rec.evs, [])
            assert.strict.deepEqual(fs.readFileSync(`${fd}/t.bin/keep.txt`, 'utf8'), 'keep')
            assert.strict.deepEqual(listDir(fdTemp), [])
        })

        it('傳輸期間目標變為資料夾: 移動時EISDIR, 不重試, 暫存清除, 該資料夾不動', async function() {
            let fp = prepOut('u11')
            let st = mockRename([])
            let rec = recorder()
            let r = await settleWithin(run(fp, async (fpTemp) => {
                await fs.promises.writeFile(fpTemp, buf)
                fs.unlinkSync(fp) //傳輸期間舊檔被換成同名資料夾
                fs.mkdirSync(fp)
                fs.writeFileSync(`${fp}/keep.txt`, 'keep', 'utf8')
            }, { optCall: { onTrace: rec.onTrace } }), 5000)
            assert.strict.deepEqual(r.err, 'ftpDownload: can not move the downloaded file to fpLocal (EISDIR), fpLocal is not changed')
            assert.strict.deepEqual(st.calls, 0)
            assert.strict.deepEqual(rec.evs.some((e) => e.type === 'retry'), false)
            assert.strict.deepEqual(fs.readFileSync(`${fp}/keep.txt`, 'utf8'), 'keep')
            assert.strict.deepEqual(listDir(fdTemp), [])
        })

        it('目標檔名很長(245字元, 暫存名不截短會超過255): 暫存名基底截短, 下載成功; 跨磁碟之目標同資料夾暫存名亦然', async function() {
            let fd = `${fdOut}/u12`
            w.fsCleanFolder(fd)
            let name = `${'長'.repeat(40)}${'a'.repeat(125)}.bin` //約245位元組以上之檔名之一(含中文, 以位元組計超過暫存名上限)
            let nameAscii = `${'b'.repeat(240)}.bin`
            let nameAstral = `aaa${'𠮷'.repeat(60)}.bin` //每字4位元組(代理對); 前綴3位元組使150位元組之界線落在代理對中間(以UTF-16單位截短即會切壞), 截短不得切到字元中間
            for (let nm of [name, nameAscii, nameAstral]) {
                let fp = `${fd}/${nm}`
                let names = []
                let rec = recorder()
                let r = await settleWithin(run(fp, async (fpTemp) => {
                    names.push(path.basename(fpTemp))
                    await fs.promises.writeFile(fpTemp, buf)
                }, { optCall: { onTrace: rec.onTrace } }), 5000)
                assert.strict.deepEqual(r.ok, true, `長檔名須可下載: ${String(r.err)}`) //暫存名過長會ENAMETOOLONG
                assert.strict.ok(names.length === 1 && Buffer.byteLength(names[0], 'utf8') <= 255 && /\.\d+\.[0-9A-Za-z]{8}\.part$/.test(names[0]), `暫存檔名不符: ${names}`)
                assert.strict.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(names[0]), '暫存檔名不得含孤立之代理字元(截短切到字元中間)')
                assertFile(fp, buf, '目標須為新內容')
            }

            //跨磁碟
            let fpX = `${fd}/${nameAscii}`
            let namesStage = []
            let renameReal = fs.promises.rename
            let n = 0
            mock.method(fs.promises, 'rename', async (a, b) => {
                n++
                if (n === 1) {
                    let e = new Error('mock')
                    e.code = 'EXDEV'
                    throw e
                }
                namesStage.push(path.basename(String(a)))
                return renameReal(a, b)
            })
            let r2 = await settleWithin(run(fpX, writeAll()), 5000)
            assert.strict.deepEqual(r2.ok, true, `跨磁碟長檔名須可下載: ${String(r2.err)}`)
            assert.strict.ok(namesStage.length === 1 && Buffer.byteLength(namesStage[0], 'utf8') <= 255, `目標同資料夾暫存名不符: ${namesStage}`)
        })

        it('保留暫存檔名失敗: 連續遇名稱已存在(EEXIST)至多嘗試5次即reject; 遇其他錯誤(EACCES)不重試; 皆不呼叫傳輸函數, 舊檔不動', async function() {
            let fp = prepOut('u13')
            let openReal = fs.openSync
            for (let [code, nExp] of [['EEXIST', 5], ['EACCES', 1]]) {
                let nTry = 0
                mock.method(fs, 'openSync', (p, flags, ...args) => {
                    if (flags === 'wx') {
                        nTry++
                        let e = new Error('mock')
                        e.code = code
                        throw e
                    }
                    return openReal(p, flags, ...args)
                })
                let nCall = 0
                let r = await settleWithin(run(fp, async () => {
                    nCall++
                }), 5000)
                mock.restoreAll()
                assert.strict.deepEqual(r.err, `ftpDownload: can not create a temporary file in fdDownloadTemp (${code}), fpLocal is not changed`)
                assert.strict.deepEqual(nTry, nExp, code) //EEXIST有界, 其他錯誤不重試
                assert.strict.deepEqual(nCall, 0)
                assertFile(fp, OLD, '目標須為舊檔')
            }
        })

        it('跨磁碟複製失敗: 非同名已存在(ENOSPC)時刪除複製殘檔; 同名已存在(EEXIST)時該檔非本次建立, 不刪; 皆reject且舊檔不動', async function() {
            let fp = prepOut('u14')
            let copyReal = fs.promises.copyFile
            let stagePath = ''
            mockRename(['EXDEV'])
            mock.method(fs.promises, 'copyFile', async (src, dest, flags) => {
                stagePath = String(dest)
                await copyReal(src, dest, flags) //已寫出部分內容之殘檔
                let e = new Error('mock')
                e.code = 'ENOSPC'
                throw e
            })
            let r = await settleWithin(run(fp, writeAll()), 5000)
            assert.strict.deepEqual(r.err, 'ftpDownload: can not move the downloaded file to fpLocal (ENOSPC), fpLocal is not changed')
            assert.strict.deepEqual(fs.existsSync(stagePath), false, '複製殘檔須刪除')
            assertFile(fp, OLD, '目標須為舊檔')
            assert.strict.deepEqual(listDir(fdTemp), [])
            mock.restoreAll()
            mockRename(['EXDEV'])
            mock.method(fs.promises, 'copyFile', async (src, dest) => {
                stagePath = String(dest)
                fs.writeFileSync(dest, 'foreign', 'utf8')
                let e = new Error('mock')
                e.code = 'EEXIST'
                throw e
            })
            let r2 = await settleWithin(run(fp, writeAll()), 5000)
            assert.strict.deepEqual(r2.err, 'ftpDownload: can not move the downloaded file to fpLocal (EEXIST), fpLocal is not changed')
            assert.strict.deepEqual(fs.readFileSync(stagePath, 'utf8'), 'foreign', '非本次建立之同名檔不得被刪')
            assertFile(fp, OLD, '目標須為舊檔')
            fs.unlinkSync(stagePath)
        })

    })

    describe('逾時(假時鐘)', function() {

        it('逾時門檻為timeLimit: 差1毫秒不逾時, 到時即reject、呼叫中止函數、先刪暫存檔名; 其後背景傳輸結束只清不移, 舊檔不動', async function() {
            let fp = prepOut('t1')
            let rec = recorder()
            let sg = signal()
            let ctlSaved = null
            let nAbort = 0
            let fnFinish = null
            mock.timers.enable({ apis: ['setTimeout'] })
            let state = { settled: false }
            let p = run(fp, (fpTemp, ctl) => {
                ctlSaved = ctl
                ctl.setAbort(() => {
                    nAbort++
                })
                sg.fire()
                return new Promise((resolve) => {
                    fnFinish = async () => {
                        await fs.promises.writeFile(fpTemp, buf) //逾時後才寫入(重建暫存檔名), 模擬背景傳輸續行
                        resolve()
                    }
                })
            }, { optCall: { onTrace: rec.onTrace } })
            p.then(() => {
                state.settled = true
            }, () => {
                state.settled = true
            })
            await sg.wait()
            assert.strict.deepEqual(ctlSaved.active(), true)
            assert.strict.deepEqual(listDir(fdTemp).length, 1)
            mock.timers.tick(TL - 1)
            await flush()
            assert.strict.deepEqual(state.settled, false, '差1毫秒不得逾時')
            assert.strict.deepEqual(rec.evs.some((e) => e.type === 'timeout'), false)
            mock.timers.tick(1)
            let r = await settleWithin(p, 5000)
            assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`) //規格: 逾時訊息沿用
            assert.strict.deepEqual(rec.evs.filter((e) => e.type === 'timeout'), [{ type: 'timeout', timeLimit: TL, stage: 'transfer' }])
            assert.strict.deepEqual(nAbort, 1) //規格: 逾時中止傳輸(FTP銷毀數據socket)
            assert.strict.deepEqual(ctlSaved.active(), false) //逾時後進度回呼不再通知之依據
            assert.strict.deepEqual(listDir(fdTemp), []) //逾時當下即刪除暫存檔名
            assertFile(fp, OLD, '目標須為舊檔')

            //背景傳輸其後完成: 只清不移
            await fnFinish()
            await rec.wait((e) => e.type === 'transfer' && e.late === true)
            await rec.wait((e) => e.type === 'temp' && e.act === 'remove')
            assert.strict.deepEqual(rec.evs.some((e) => e.type === 'move'), false) //規格: 逾時後之背景傳輸不得移至目標
            assert.strict.deepEqual(listDir(fdTemp), [])
            assertFile(fp, OLD, '目標須為舊檔')
        })

        it('傳輸於時限內結束: 計時器即清除(其後再久亦無逾時事件), 中止函數不被呼叫', async function() {
            let fp = prepOut('t2')
            let rec = recorder()
            let nAbort = 0
            mock.timers.enable({ apis: ['setTimeout'] })
            let r = await run(fp, async (fpTemp, ctl) => {
                ctl.setAbort(() => {
                    nAbort++
                })
                await fs.promises.writeFile(fpTemp, buf)
            }, { optCall: { onTrace: rec.onTrace } })
            assert.strict.deepEqual(r, 'ok')
            mock.timers.tick(TL * 3)
            await flush()
            assert.strict.deepEqual(rec.evs.some((e) => e.type === 'timeout'), false) //規格: 計時器於傳輸結束時清除
            assert.strict.deepEqual(nAbort, 0)
            assertFile(fp, buf, '目標須為新內容')
        })

        it('timeLimit超過計時器上限(Node會把過大之延遲當作1毫秒而立即觸發): 以上限為準, 不立即逾時, 傳輸與階段計時於時限內結束皆成功', async function() {
            let fp = prepOut('t4')
            let rec = recorder()
            let r = await settleWithin(run(fp, async (fpTemp) => {
                await new Promise((resolve) => setTimeoutReal(resolve, 30)) //真實計時器: 若逾時計時器被當作1毫秒, 必先於此觸發
                await fs.promises.writeFile(fpTemp, buf)
            }, { timeLimit: 1e12, optCall: { onTrace: rec.onTrace } }), 5000)
            assert.strict.deepEqual(r.ok, true, `不得立即逾時: ${String(r.err)}`)
            assert.strict.deepEqual(rec.evs.some((e) => e.type === 'timeout'), false)
            assertFile(fp, buf, '目標須為新內容')
            let v = await settleWithin(downloadViaTemp.withTimeLimit({
                run: async () => {
                    await new Promise((resolve) => setTimeoutReal(resolve, 30))
                    return 'v2'
                },
                timeLimit: 1e12,
                stage: 'stat',
            }), 5000)
            assert.strict.deepEqual(v.value, 'v2')
        })

        it('中止函數拋錯不影響逾時結果', async function() {
            let fp = prepOut('t3')
            let sg = signal()
            mock.timers.enable({ apis: ['setTimeout'] })
            let p = run(fp, (fpTemp, ctl) => {
                ctl.setAbort(() => {
                    throw new Error('abort fails')
                })
                sg.fire()
                return new Promise(() => {})
            })
            await sg.wait()
            mock.timers.tick(TL)
            let r = await settleWithin(p, 5000)
            assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`)
            assert.strict.deepEqual(listDir(fdTemp), [])
        })

        it('withTimeLimit(階段計時): 時限內結束則清除計時器並傳回結果; 逾時即reject且其後之結果不採用; 階段拋錯照傳', async function() {
            let rec = recorder()
            mock.timers.enable({ apis: ['setTimeout'] })

            //時限內結束
            let v = await downloadViaTemp.withTimeLimit({ run: async () => 'v1', timeLimit: TL, stage: 'stat', optCall: { onTrace: rec.onTrace } })
            assert.strict.deepEqual(v, 'v1')
            mock.timers.tick(TL * 2)
            await flush()
            assert.strict.deepEqual(rec.evs, []) //計時器已清除, 無逾時事件

            //逾時
            let nFinish = null
            let state = { settled: false }
            let p = downloadViaTemp.withTimeLimit({
                run: () => new Promise((resolve) => {
                    nFinish = resolve
                }),
                timeLimit: TL,
                stage: 'stat',
                optCall: { onTrace: rec.onTrace },
            })
            p.then(() => {
                state.settled = true
            }, () => {
                state.settled = true
            })
            await flush()
            mock.timers.tick(TL - 1)
            await flush()
            assert.strict.deepEqual(state.settled, false, '差1毫秒不得逾時')
            mock.timers.tick(1)
            let r = await settleWithin(p, 5000)
            assert.strict.deepEqual(r.err, `ftpDownload timeout[${TL}]`)
            assert.strict.deepEqual(rec.evs, [{ type: 'timeout', timeLimit: TL, stage: 'stat' }])
            nFinish('late') //逾時後才結束: 不影響已reject之結果, 無未處理之rejection
            await flush()

            //階段拋錯(同步與非同步)照傳
            let e1 = await settleWithin(downloadViaTemp.withTimeLimit({
                run: async () => {
                    throw new Error('e-async')
                },
                timeLimit: TL,
                stage: 'stat',
            }), 5000)
            assert.strict.ok(e1.err instanceof Error && e1.err.message === 'e-async')
            let e2 = await settleWithin(downloadViaTemp.withTimeLimit({
                run: () => {
                    throw new Error('e-sync')
                },
                timeLimit: TL,
                stage: 'stat',
            }), 5000)
            assert.strict.ok(e2.err instanceof Error && e2.err.message === 'e-sync')
        })

    })

    describe('崩潰殘留之清理', function() {

        //mk, 於暫存區建立本套件命名格式之殘檔, 回傳路徑; ageH為距今小時數
        let mk = (name, ageH) => {
            let fp = `${fdTemp}/${name}`
            fs.writeFileSync(fp, name, 'utf8')
            let t = new Date(Date.now() - ageH * 3600 * 1000)
            fs.utimesSync(fp, t, t)
            return fp
        }

        it('只清逾24小時、本套件命名格式、行程已不存在之檔: 23小時內、非格式、行程仍存在(以本行程之id代表)、資料夾皆不動', async function() {
            let fp = prepOut('s1')
            let pidDead = deadPid()
            let nmStale = `a.bin.${pidDead}.AbCdEfGh.part`
            let nmStale2 = `b.c.d.${pidDead}.12345678.part` //檔名含多個點
            let nmFresh = `fresh.bin.${pidDead}.AbCdEfGh.part`
            let nmOther1 = 'plain.txt'
            let nmOther2 = `short.bin.${pidDead}.AbCdEfG.part` //隨機碼7碼, 非本套件格式
            let nmOther3 = `x.bin.${pidDead}.AbCdEfGh.part.bak` //非.part結尾
            let nmOwn = `own.bin.${process.pid}.AbCdEfGh.part`
            mk(nmStale, 25)
            mk(nmStale2, 48)
            mk(nmFresh, 23)
            mk(nmOther1, 100)
            mk(nmOther2, 100)
            mk(nmOther3, 100)
            mk(nmOwn, 100)
            let nmDir = `d.bin.${pidDead}.AbCdEfGh.part`
            fs.mkdirSync(`${fdTemp}/${nmDir}`)
            let t = new Date(Date.now() - 100 * 3600 * 1000)
            fs.utimesSync(`${fdTemp}/${nmDir}`, t, t)
            let rec = recorder()
            let r = await run(fp, writeAll(), { optCall: { onTrace: rec.onTrace } })
            assert.strict.deepEqual(r, 'ok')
            assert.strict.deepEqual(rec.evs[0], { type: 'sweep', removed: 2 })
            assert.strict.deepEqual(listDir(fdTemp), [nmDir, nmFresh, nmOther1, nmOther2, nmOther3, nmOwn].sort())
        })

        it('同一行程對同一暫存區最短相隔1小時才清一次(假Date.now): 1小時內第2次不清, 滿1小時後再清', async function() {
            let fp = prepOut('s2')
            let pidDead = deadPid()
            let dateReal = Date.now
            let tNow = dateReal.call(Date)
            let rec1 = recorder()
            await run(fp, writeAll(), { optCall: { onTrace: rec1.onTrace } })
            assert.strict.deepEqual(rec1.evs[0], { type: 'sweep', removed: 0 })

            //1小時內: 不再清理(即使有殘檔)
            let nm = `late.bin.${pidDead}.AbCdEfGh.part`
            let fpStale = `${fdTemp}/${nm}`
            fs.writeFileSync(fpStale, 'x', 'utf8')
            let tOld = new Date(tNow - 30 * 3600 * 1000)
            fs.utimesSync(fpStale, tOld, tOld)
            mock.method(Date, 'now', () => tNow + 59 * 60 * 1000)
            let rec2 = recorder()
            await run(fp, writeAll(), { optCall: { onTrace: rec2.onTrace } })
            assert.strict.deepEqual(rec2.evs.some((e) => e.type === 'sweep'), false)
            assert.strict.deepEqual(listDir(fdTemp), [nm])

            //滿1小時: 再清
            mock.restoreAll()
            mock.method(Date, 'now', () => tNow + 61 * 60 * 1000)
            let rec3 = recorder()
            await run(fp, writeAll(), { optCall: { onTrace: rec3.onTrace } })
            assert.strict.deepEqual(rec3.evs[0], { type: 'sweep', removed: 1 })
            assert.strict.deepEqual(listDir(fdTemp), [])
        })

        it('暫存區不存在時不拋錯: sweep回報0, 其後建立暫存區並完成下載', async function() {
            let fp = prepOut('s3')
            let fdNew = path.resolve(`${fdBase}/temp-new-${w.genID(6)}`)
            let rec = recorder()
            let r = await run(fp, writeAll(), { fdTempInst: fdNew, optCall: { onTrace: rec.onTrace } })
            assert.strict.deepEqual(r, 'ok')
            assert.strict.deepEqual(rec.evs[0], { type: 'sweep', removed: 0 })
            assert.strict.deepEqual(fs.existsSync(fdNew), true)
            assert.strict.deepEqual(listDir(fdNew), [])
        })

    })

})
