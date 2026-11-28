import fs from 'fs'
import assert from 'assert'
import { mock } from 'node:test'
import w from 'wsemi'
import uploadViaTemp from '../src/uploadViaTemp.mjs'
import { signal, settleWithin, catchUnhandled } from './lib/dlTestKit.mjs'
import { recorder, rejected } from './lib/ulTestKit.mjs'


//上傳共用流程(uploadViaTemp)之單元測試: 傳輸端以替身(記錄呼叫順序), 逾時以假時鐘
//規格(使用端需求Gitea #214 §4第6項): 暫存名→傳輸→核對大小→改名; 失敗刪暫存、舊目標不變; 刪不掉記入訊息與onTrace; 各階段以timeLimit計時, 到時中止;
//改名覆蓋: posixRename優先, 退回rename與舊檔暫名交換(失敗還原); 不得靜默留暫存而回成功
describe('unit-upload-via-temp', function() {

    let fdBase = './test/_tmp/upload-unit'
    let fpLocal = `${fdBase}/up.bin`
    let N = 4321

    before(function() {
        w.fsDeleteFolder(fdBase)
        fs.mkdirSync(fdBase, { recursive: true })
        fs.writeFileSync(fpLocal, Buffer.alloc(N, 5))
    })

    afterEach(function() {
        mock.timers.reset()
        fs.writeFileSync(fpLocal, Buffer.alloc(N, 5))
    })

    after(function() {
        w.fsDeleteFolder(fdBase)
    })

    //reply, 伺服器回應之錯誤(code為數字)
    let reply = (code) => {
        let e = new Error('server says something secret')
        e.code = code
        return e
    }

    //lost, 連線層級之錯誤
    let lost = () => {
        let e = new Error('connection closed')
        e.code = 'ECONNRESET'
        return e
    }

    //never, 永不結束
    let never = () => new Promise(() => {})

    //mk, 傳輸端替身: over之鍵取代預設行為, calls記錄[名稱, ...引數]
    let mk = (over = {}) => {
        let calls = []
        let base = {
            prepare: async () => {},
            put: async () => {},
            size: async () => N,
            isFile: async () => true,
            rename: async () => {},
            remove: async () => {},
            isAbsent: async () => false,
            abort: () => {},
            reconnect: async () => {},
        }
        let all = { ...base, ...over }
        let adapter = {}
        for (let k of Object.keys(all)) {
            if (typeof all[k] !== 'function') {
                adapter[k] = all[k]
                continue
            }
            adapter[k] = (...args) => {
                calls.push([k, ...args.filter((a) => typeof a !== 'function')])
                return all[k](...args)
            }
        }
        return { adapter, calls }
    }

    //run, 以替身執行uploadViaTemp
    let run = (adapter, { timeLimit = 60000, fpRemote = './d/t.bin', onTrace } = {}) => {
        return uploadViaTemp({
            fpLocal,
            fpRemote,
            fileSize: N,
            timeLimit,
            optCall: { onTrace },
            genAdapter: () => adapter,
        })
    }

    //names, 呼叫名稱序列
    let names = (calls) => calls.map((c) => c[0])

    //flush, 讓出事件迴圈使進行中之非同步步驟推進
    let flush = async () => {
        for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setImmediate(resolve))
        }
    }

    //renames, rename與posixRename之呼叫(暫存名中之隨機部分以X代替)
    let renames = (calls) => calls.filter((c) => c[0] === 'rename' || c[0] === 'posixRename')
        .map((c) => c.join(' ').replace(/\.\d+\.[0-9A-Za-z]{8}\./g, '.X.'))

    it('成功: prepare→put(暫存名)→size→rename, 暫存名與目標同資料夾且每次不同', async function() {
        let seen = []
        for (let i = 0; i < 2; i++) {
            let { adapter, calls } = mk()
            assert.strict.deepEqual(await run(adapter), 'ok')
            assert.strict.deepEqual(names(calls), ['prepare', 'put', 'size', 'rename'])
            let t = calls[1][1]
            assert.ok(new RegExp(`^\\./d/t\\.bin\\.${process.pid}\\.[0-9A-Za-z]{8}\\.part$`).test(t), t)
            assert.strict.deepEqual(calls[2][1], t)
            assert.strict.deepEqual(calls[3], ['rename', t, './d/t.bin'])
            seen.push(t)
        }
        assert.ok(seen[0] !== seen[1], '每次嘗試不同之名')
    })

    it('暫存名之基底過長者以碼點截短, 無資料夾部分者不加資料夾; 尾斜線或.、..者拒絕且不呼叫傳輸端', async function() {
        let long = '測'.repeat(80) //240位元組
        let { adapter, calls } = mk()
        await run(adapter, { fpRemote: long })
        let t = calls[1][1]
        assert.ok(t.startsWith('測'.repeat(50) + '.') && !t.startsWith('測'.repeat(51)), '截至150位元組')
        assert.ok(Buffer.byteLength(t) <= 255)
        for (let bad of ['a/', './', 'a/.', '..', 'a/..']) {
            let m = mk()
            assert.strict.deepEqual(await rejected(run(m.adapter, { fpRemote: bad }), bad), 'ftpUpload: fpRemote is not a file path, fpRemote is not changed')
            assert.strict.deepEqual(m.calls, [])
        }
    })

    it('posixRename優先; 回false(不支援)或伺服器拒絕時改用rename; 連線層級錯誤不退回', async function() {
        let a = mk({ posixRename: async () => true })
        let rec = recorder()
        await run(a.adapter, { onTrace: rec.onTrace })
        assert.strict.deepEqual(names(a.calls).slice(2), ['size', 'posixRename'])
        assert.strict.deepEqual(rec.evs[rec.evs.length - 1], { type: 'move', mode: 'posix' })
        for (let p of [async () => false, async () => Promise.reject(reply(8))]) {
            let m = mk({ posixRename: p })
            let r = recorder()
            await run(m.adapter, { onTrace: r.onTrace })
            assert.strict.deepEqual(names(m.calls).slice(2), ['size', 'posixRename', 'rename'])
            assert.strict.deepEqual(r.evs[r.evs.length - 1], { type: 'move', mode: 'rename' })
        }
        let x = mk({ posixRename: async () => Promise.reject(lost()) })
        let e = await rejected(run(x.adapter), 'lost')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (ECONNRESET), fpRemote may or may not be updated')
        assert.ok(!names(x.calls).includes('rename'))
        assert.ok(names(x.calls).includes('remove'), '暫存仍清除')
    })

    it('直接改名遇連線層級錯誤(結果不明): 不查目標、不搬舊檔, 訊息「may or may not be updated」', async function() {
        let m = mk({ rename: async () => Promise.reject(lost()), isFile: async () => true })
        let e = await rejected(run(m.adapter), 'direct-lost')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (ECONNRESET), fpRemote may or may not be updated')
        assert.strict.deepEqual(renames(m.calls), ['rename ./d/t.bin.X.part ./d/t.bin'])
        assert.ok(!names(m.calls).includes('isFile'))
    })

    it('rename被拒且目標為檔案: 舊檔改暫名→暫存改目標→刪舊暫名; 回成功', async function() {
        let n = 0
        let m = mk({
            rename: async () => {
                if (++n === 1) {
                    throw reply(553) //直接覆蓋被拒
                }
            },
        })
        let rec = recorder()
        assert.strict.deepEqual(await run(m.adapter, { onTrace: rec.onTrace }), 'ok')
        assert.strict.deepEqual(renames(m.calls), [
            'rename ./d/t.bin.X.part ./d/t.bin',
            'rename ./d/t.bin ./d/t.bin.X.old',
            'rename ./d/t.bin.X.part ./d/t.bin',
        ])
        let removed = m.calls.filter((c) => c[0] === 'remove').map((c) => c[1])
        assert.strict.deepEqual(removed.length, 1)
        assert.ok(removed[0].endsWith('.old'))
        assert.strict.deepEqual(rec.evs.slice(-2), [{ type: 'temp', act: 'remove', ok: true, kind: 'old' }, { type: 'move', mode: 'swap' }])
    })

    it('rename被拒且目標不是檔案: 不搬走目標, reject帶code, 暫存清除', async function() {
        let m = mk({ rename: async () => Promise.reject(reply(550)), isFile: async () => false })
        let e = await rejected(run(m.adapter), 'dir')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (550), fpRemote is not changed')
        assert.strict.deepEqual(renames(m.calls).length, 1)
        assert.strict.deepEqual(m.calls.filter((c) => c[0] === 'remove').length, 1)
    })

    it('舊檔改暫名即被拒: 目標不變; 只清暫存, 不還原', async function() {
        let m = mk({ rename: async () => Promise.reject(reply(550)), isFile: async () => true })
        let e = await rejected(run(m.adapter), 'norename')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (550), fpRemote is not changed')
        assert.strict.deepEqual(m.calls.filter((c) => c[0] === 'remove').map((c) => c[1].endsWith('.part')), [true], '只刪暫存, 不刪舊檔')
        assert.strict.deepEqual(renames(m.calls).length, 2)
    })

    it('舊檔改暫名時連線錯誤(結果不明): 目標不存在即改回舊檔', async function() {
        let n = 0
        let m = mk({
            isFile: async () => n < 2,
            rename: async () => {
                n++
                if (n === 1) {
                    throw reply(553)
                }
                if (n === 2) {
                    throw lost()
                }
            },
        })
        let e = await rejected(run(m.adapter), 'movinglost')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (ECONNRESET), fpRemote may or may not be updated, the old file of fpRemote may be kept under a temporary name in the same folder')
        let rs = renames(m.calls)
        assert.strict.deepEqual(rs[rs.length - 1], 'rename ./d/t.bin.X.old ./d/t.bin')
    })

    it('舊檔改暫名時連線錯誤而目標仍在: 不刪任何舊檔暫名(指令可能稍後才執行), 訊息標示可能保留', async function() {
        let n = 0
        let m = mk({
            isFile: async () => true,
            rename: async () => {
                n++
                if (n === 1) {
                    throw reply(553)
                }
                if (n === 2) {
                    throw lost()
                }
            },
        })
        let e = await rejected(run(m.adapter), 'movingpresent')
        assert.ok(e.endsWith('the old file of fpRemote is kept under a temporary name in the same folder'), e)
        assert.ok(!m.calls.some((c) => c[0] === 'remove' && c[1].endsWith('.old')))
    })

    //movedErr, 交換中舊檔已改暫名後第二次改名失敗(errThird), 還原時目標已存在(可能為他人所寫)
    let movedPresent = (errThird, over = {}) => {
        let n = 0
        return {
            isFile: async () => true,
            rename: async () => {
                n++
                if (n === 1) {
                    throw reply(553)
                }
                if (n === 3) {
                    throw errThird()
                }
            },
            ...over,
        }
    }

    it('第二次改名遭伺服器回應拒絕而目標已存在: 保留舊檔暫名, 訊息明示', async function() {
        let m = mk(movedPresent(() => reply(550)))
        let e = await rejected(run(m.adapter), 'moved-reply')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (550), the old file of fpRemote is kept under a temporary name in the same folder')
        assert.ok(!m.calls.some((c) => c[0] === 'remove' && c[1].endsWith('.old')))
    })

    it('第二次改名連線錯誤而目標大小不同於本次上傳: 保留舊檔暫名', async function() {
        let nSize = 0
        let m = mk(movedPresent(() => lost(), { size: async () => (++nSize === 1 ? N : N + 5) }))
        let e = await rejected(run(m.adapter), 'moved-size')
        assert.ok(e.endsWith('the old file of fpRemote is kept under a temporary name in the same folder'), e)
        assert.ok(!m.calls.some((c) => c[0] === 'remove' && c[1].endsWith('.old')))
    })

    //restoreScript, 第二次改名連線錯誤, 目標不存在, 其後之還原改名依restores之順序
    let restoreScript = (restores) => {
        let n = 0
        let restored = false
        return {
            isFile: async (fp) => (fp === './d/t.bin' ? n < 2 || restored : false),
            rename: async () => {
                n++
                if (n === 1) {
                    throw reply(553)
                }
                if (n === 3) {
                    throw lost()
                }
                if (n > 3) {
                    await restores.shift()()
                    restored = true
                }
            },
        }
    }

    it('還原改名遇連線錯誤: 中止並重新連線後再試, 成功即不留舊檔暫名', async function() {
        let m = mk(restoreScript([async () => Promise.reject(lost()), async () => {}]))
        let e = await rejected(run(m.adapter), 'restore-retry')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (ECONNRESET), fpRemote may or may not be updated')
        assert.ok(names(m.calls).includes('abort'))
        assert.strict.deepEqual(renames(m.calls).filter((v) => v === 'rename ./d/t.bin.X.old ./d/t.bin').length, 2)
    })

    it('還原兩次皆遇連線錯誤: 訊息明示舊檔可能以暫名保留', async function() {
        let m = mk(restoreScript([async () => Promise.reject(lost()), async () => Promise.reject(lost())]))
        let e = await rejected(run(m.adapter), 'restore-unknown')
        assert.ok(e.endsWith('fpRemote may or may not be updated, the old file of fpRemote may be kept under a temporary name in the same folder'), e)
    })

    it('清理之兩次刪除皆為連線層級錯誤: 不再於該連線查詢, 訊息標示未清', async function() {
        let m = mk({ put: async () => Promise.reject(reply(552)), remove: async () => Promise.reject(lost()) })
        let e = await rejected(run(m.adapter), 'twice')
        assert.ok(e.endsWith('can not remove the remote temporary file'), e)
        assert.ok(!names(m.calls).includes('isAbsent'))
        assert.strict.deepEqual(names(m.calls).slice(-1), ['reconnect'], '結束前重新連線')
    })

    //swapScript, 交換退路: 第1次(直接覆蓋)被拒, 第2次(舊→暫名)成功, 第3次依third, 第4次(還原)依fourth
    let swapScript = (third, fourth) => {
        let n = 0
        let present = true
        let over = {
            isFile: async () => present,
            rename: async (from, to) => {
                n++
                if (n === 1) {
                    throw reply(553)
                }
                if (n === 2) {
                    present = false
                    return
                }
                if (n === 3) {
                    return third()
                }
                if (fourth) {
                    return fourth()
                }
                present = true
            },
        }
        return over
    }

    it('交換第二次改名失敗: 目標不存在即改回舊檔, reject「fpRemote is not changed」, 暫存清除且不刪舊暫名', async function() {
        let m = mk(swapScript(async () => Promise.reject(reply(550))))
        let e = await rejected(run(m.adapter), 'swap3')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (550), fpRemote is not changed')
        let rs = renames(m.calls)
        assert.strict.deepEqual(rs[rs.length - 1], 'rename ./d/t.bin.X.old ./d/t.bin')
        assert.strict.deepEqual(m.calls.filter((c) => c[0] === 'remove').map((c) => c[1].slice(-5)), ['.part'])
    })

    it('交換第二次改名遇連線錯誤且還原失敗: 訊息明示舊檔以暫名保留, 不刪舊暫名', async function() {
        let m = mk(swapScript(async () => Promise.reject(lost()), async () => Promise.reject(reply(550))))
        let e = await rejected(run(m.adapter), 'restorefail')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (ECONNRESET), fpRemote may or may not be updated, the old file of fpRemote is kept under a temporary name in the same folder')
        assert.ok(!m.calls.some((c) => c[0] === 'remove' && c[1].endsWith('.old')))
    })

    it('交換第二次改名遇連線錯誤但目標已存在(實際已改名): 刪舊暫名, 訊息「may or may not be updated」', async function() {
        let n = 0
        let m = mk({
            isFile: async () => true,
            rename: async () => {
                n++
                if (n === 1) {
                    throw reply(553)
                }
                if (n === 3) {
                    throw lost()
                }
            },
        })
        let e = await rejected(run(m.adapter), 'lostafter')
        assert.strict.deepEqual(e, 'ftpUpload: can not rename the temporary file to fpRemote (ECONNRESET), fpRemote may or may not be updated')
        assert.strict.deepEqual(m.calls.filter((c) => c[0] === 'remove').map((c) => c[1].slice(-4)), ['.old', 'part'])
    })

    it('舊暫名刪不掉: reject明示目標已更新', async function() {
        let n = 0
        let m = mk({
            rename: async () => {
                if (++n === 1) {
                    throw reply(553)
                }
            },
            remove: async () => Promise.reject(reply(550)),
        })
        let rec = recorder()
        let e = await rejected(run(m.adapter, { onTrace: rec.onTrace }), 'oldleft')
        assert.strict.deepEqual(e, 'ftpUpload: fpRemote is updated, but can not remove the old file kept under a temporary name in the same folder')
        assert.ok(rec.evs.some((v) => v.type === 'temp' && v.kind === 'old' && v.ok === false))
        assert.ok(!rec.evs.some((v) => v.type === 'move'))
    })

    it('傳輸失敗: 暫存清除成功者沿用原錯誤; 刪不掉者固定訊息帶code; 已不存在視為清除', async function() {
        let err = reply(552)
        let ok = mk({ put: async () => Promise.reject(err) })
        assert.ok(await rejected(run(ok.adapter), 'put') === err)
        assert.strict.deepEqual(names(ok.calls), ['prepare', 'put', 'reconnect', 'remove', 'reconnect'])
        let absent = mk({ put: async () => Promise.reject(err), remove: async () => Promise.reject(reply(550)), isAbsent: async () => true })
        assert.ok(await rejected(run(absent.adapter), 'absent') === err)
        let left = mk({ put: async () => Promise.reject(err), remove: async () => Promise.reject(reply(550)) })
        let e = await rejected(run(left.adapter), 'left')
        assert.strict.deepEqual(e, 'ftpUpload: transfer failed (552), fpRemote is not changed, can not remove the remote temporary file')
        assert.ok(!names(left.calls).includes('abort'), '伺服器回應之拒絕不中止連線')
    })

    it('清理遇連線層級錯誤: 中止並重新連線後再刪一次', async function() {
        let n = 0
        let m = mk({
            put: async () => Promise.reject(lost()),
            remove: async () => (++n === 1 ? Promise.reject(lost()) : undefined),
        })
        let e = await rejected(run(m.adapter), 'retry')
        assert.strict.deepEqual(e.code, 'ECONNRESET', '清除成功故沿用原錯誤')
        assert.strict.deepEqual(names(m.calls), ['prepare', 'put', 'reconnect', 'remove', 'abort', 'reconnect', 'remove', 'reconnect'])
    })

    it('核對: 大小不符、本機大小改變、查詢失敗皆reject固定訊息並清暫存', async function() {
        let a = mk({ size: async () => N - 1 })
        assert.strict.deepEqual(await rejected(run(a.adapter), 'size'), `ftpUpload: uploaded size[${N - 1}] does not match local size[${N}], fpRemote is not changed`)
        let b = mk({
            put: async () => {
                fs.appendFileSync(fpLocal, 'z')
            },
        })
        let rec = recorder()
        assert.strict.deepEqual(await rejected(run(b.adapter, { onTrace: rec.onTrace }), 'chg'), 'ftpUpload: fpLocal was changed during upload, fpRemote is not changed')
        assert.ok(rec.evs.some((v) => v.type === 'verify' && v.ok === false && v.size === N && v.sizeLocal === N + 1))
        let c = mk({ size: async () => Promise.reject(reply(550)) })
        assert.strict.deepEqual(await rejected(run(c.adapter), 'nosize'), 'ftpUpload: can not get the size of the uploaded temporary file (550), fpRemote is not changed')
        for (let m of [a, b, c]) {
            assert.ok(names(m.calls).includes('remove') && !names(m.calls).includes('rename'))
        }
    })

    it('prepare失敗: 沿用原錯誤, 不傳輸、不刪除; 仍呼叫reconnect(連線已中止者重新連線, 未中止者不做事)', async function() {
        let err = reply(550)
        let m = mk({ prepare: async () => Promise.reject(err) })
        assert.ok(await rejected(run(m.adapter), 'prep') === err)
        assert.strict.deepEqual(names(m.calls), ['prepare', 'reconnect'])
    })

    for (let stageName of ['prepare', 'transfer', 'verify', 'rename']) {
        it(`逾時(${stageName}): 恰於timeLimit中止並reject, 差1毫秒不逾時; 逾時前之階段各自重新起算`, async function() {
            mock.timers.enable({ apis: ['setTimeout'] })
            let hit = signal()
            let gates = []
            let slow = (name) => () => {
                if (name === stageName) {
                    hit.fire()
                    return never()
                }
                return new Promise((resolve) => gates.push(resolve))
            }
            let map = { prepare: 'prepare', put: 'transfer', size: 'verify', rename: 'rename' }
            let over = {}
            for (let [k, s] of Object.entries(map)) {
                over[k] = slow(s)
            }
            let m = mk(over)
            let rec = recorder()
            let p = run(m.adapter, { timeLimit: 5000, onTrace: rec.onTrace })
            let done = false
            p.then(() => {
                done = true
            }, () => {
                done = true
            })
            //逾時前之各階段各耗4000毫秒(總和超過timeLimit仍不逾時)
            for (let s of ['prepare', 'transfer', 'verify', 'rename']) {
                await flush()
                if (s === stageName) {
                    break
                }
                mock.timers.tick(4000)
                gates.shift()(s === 'verify' ? N : undefined)
            }
            await hit.wait()
            mock.timers.tick(4999)
            await flush()
            assert.strict.deepEqual(done, false, '差1毫秒不逾時')
            assert.ok(!names(m.calls).includes('abort'))
            mock.timers.tick(1)
            await flush()
            assert.strict.deepEqual(done, true)
            let e = await rejected(p, stageName)
            let want = stageName === 'rename' ? 'ftpUploadCore timeout[5000] while renaming, fpRemote may or may not be updated' : 'ftpUploadCore timeout[5000]'
            assert.strict.deepEqual(e, want)
            assert.ok(names(m.calls).includes('abort') && names(m.calls).includes('reconnect'), '中止並重新連線')
            assert.strict.deepEqual(names(m.calls).includes('remove'), stageName !== 'prepare', '有暫存者清除')
            assert.ok(rec.evs.some((v) => v.type === 'timeout' && v.stage === stageName && v.timeLimit === 5000))
        })
    }

    it('逾時後傳輸結束: 發出transfer(late), 結果不採用; 不再送出後續指令', async function() {
        mock.timers.enable({ apis: ['setTimeout'] })
        let release = null
        let m = mk({
            put: () => new Promise((resolve) => {
                release = resolve
            }),
        })
        let rec = recorder()
        let p = run(m.adapter, { timeLimit: 3000, onTrace: rec.onTrace })
        await flush()
        mock.timers.tick(3000)
        await rejected(p, 'late')
        let n = m.calls.length
        release()
        await flush()
        assert.ok(rec.evs.some((v) => v.type === 'transfer' && v.late === true && v.ok === true))
        assert.strict.deepEqual(m.calls.length, n)
    })

    it('改名中逾時: 舊階段之延續不再送出指令(交換退路)', async function() {
        mock.timers.enable({ apis: ['setTimeout'] })
        let release = null
        let m = mk({
            rename: () => new Promise((resolve, reject) => {
                release = () => reject(reply(553))
            }),
        })
        let p = run(m.adapter, { timeLimit: 3000 })
        await flush()
        mock.timers.tick(3000)
        await rejected(p, 'rn')
        let n = m.calls.length
        release()
        await flush()
        assert.strict.deepEqual(m.calls.length, n, '逾時後不再查目標、不搬舊檔')
    })

    it('清理停滯: 以min(timeLimit, 10000)為限, 中止後重新連線, 訊息標示暫存未清', async function() {
        mock.timers.enable({ apis: ['setTimeout'] })
        let m = mk({ size: async () => N - 1, remove: () => never() })
        let rec = recorder()
        let p = run(m.adapter, { timeLimit: 60000, onTrace: rec.onTrace })
        let done = false
        p.catch(() => {
            done = true
        })
        await flush()
        mock.timers.tick(9999)
        await flush()
        assert.strict.deepEqual(done, false)
        mock.timers.tick(1)
        await flush()
        let e = await rejected(p, 'clean')
        assert.ok(e.endsWith('can not remove the remote temporary file'), e)
        assert.ok(rec.evs.some((v) => v.type === 'timeout' && v.stage === 'clean' && v.timeLimit === 10000))
        assert.strict.deepEqual(names(m.calls).slice(-4), ['remove', 'abort', 'reconnect', 'reconnect'])
    })

    it('重新連線停滯: 以上限結束, 不使上傳懸置', async function() {
        mock.timers.enable({ apis: ['setTimeout'] })
        let m = mk({ prepare: () => never(), reconnect: () => never() })
        let p = run(m.adapter, { timeLimit: 2000 })
        p.catch(() => {}) //斷言於推進時鐘後才取結果
        await flush()
        mock.timers.tick(2000)
        await flush()
        mock.timers.tick(2000)
        await flush()
        assert.strict.deepEqual(await rejected(p, 'reconnect'), 'ftpUploadCore timeout[2000]')
    })

    it('改名已完成而刪舊暫名停滯: 以清理上限中止並重新連線, reject明示目標已更新', async function() {
        mock.timers.enable({ apis: ['setTimeout'] })
        let n = 0
        let m = mk({
            rename: async () => {
                if (++n === 1) {
                    throw reply(553)
                }
            },
            remove: () => never(),
        })
        let p = run(m.adapter, { timeLimit: 3000 })
        p.catch(() => {}) //斷言於推進時鐘後才取結果
        await flush()
        mock.timers.tick(3000)
        await flush()
        assert.strict.deepEqual(await rejected(p, 'oldtimeout'), 'ftpUpload: fpRemote is updated, but can not remove the old file kept under a temporary name in the same folder')
        assert.strict.deepEqual(names(m.calls).slice(-4), ['remove', 'abort', 'reconnect', 'reconnect'])
    })

    it('onTrace拋錯或回傳rejection: 結果不變, 無未處理rejection', async function() {
        let un = catchUnhandled()
        for (let onTrace of [() => {
            throw new Error('x')
        }, async () => Promise.reject(new Error('y'))]) {
            let m = mk()
            let r = await settleWithin(run(m.adapter, { onTrace }), 5000)
            assert.ok(r.ok && r.value === 'ok')
        }
        await flush()
        assert.strict.deepEqual(un.list, [])
        un.stop()
    })

})
