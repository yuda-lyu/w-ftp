import assert from 'assert'
import connKeeper from '../src/connKeeper.mjs'
import { gate, settleWithin } from './lib/dlTestKit.mjs'


describe('unit-conn-keeper', function() {

    //錯誤代碼(規則R-CN-03: 固定訊息只帶固定詞彙之代碼, 不回顯外來錯誤全文)
    it('codeOfConn: Node錯誤碼與FTP回應碼沿用, ssh2之認證與交握逾時層級另立代碼', function() {
        assert.strict.deepEqual(connKeeper.codeOfConn({ code: 'ECONNREFUSED' }), 'ECONNREFUSED')
        assert.strict.deepEqual(connKeeper.codeOfConn({ code: 421 }), '421')
        assert.strict.deepEqual(connKeeper.codeOfConn({ level: 'client-authentication' }), 'AUTHENTICATION')
        assert.strict.deepEqual(connKeeper.codeOfConn({ level: 'client-timeout' }), 'HANDSHAKE_TIMEOUT')
    })

    it('codeOfConn: 非固定詞彙(含路徑、主機等外來字串)、缺代碼或讀取拋錯者回UNKNOWN', function() {
        let bad = {}
        Object.defineProperty(bad, 'level', {
            get() {
                throw new Error('x')
            },
        })
        for (let [i, e] of [{ code: 'connect ECONNREFUSED 10.0.0.1:22' }, { code: '/home/u1/a' }, { code: 'ERR bad' }, { code: 'SECRET_TOKEN_123' }, { code: 12345 }, { code: 2 }, { message: 'Timed out' }, {}, null, undefined, bad].entries()) {
            assert.ok(connKeeper.codeOfConn(e) === 'UNKNOWN', `第${i}案`)
        }
    })

    //mk, 以假連線建立保管者: 第1條立即就緒, 其後各條由對應之閘門決定就緒; replayGate非null時重放停在閘門
    let mk = ({ replayGate = null } = {}) => {
        let links = []
        let gates = []
        let open = () => {
            let link = connKeeper.genLink({}, () => {})
            let g = gate()
            if (links.length === 0) {
                g.open()
            }
            link.setReady(g.wait())
            links.push(link)
            gates.push(g)
            return link
        }
        let replay = replayGate === null ? null : () => replayGate.wait()
        let keeper = connKeeper({ open, canReconnect: () => true, replay, timeLimit: 60000 })
        return { keeper, links, gates }
    }

    //tick, 讓出一輪事件迴圈, 使已解決之promise鏈走完
    let tick = () => new Promise((resolve) => setImmediate(resolve))

    //cancellable, 發起重新連線並取得其取消函數
    let cancellable = (keeper, old) => {
        let box = { cancel: null }
        let setCancel = (fn) => {
            box.cancel = fn
        }
        let p = keeper.reconnect(old, { setCancel })
        return { p, cancel: () => box.cancel() }
    }

    it('取消重新連線(未併入他方): 其後之要求另起新嘗試, 不併入已取消者(規則R-CN-04)', async function() {
        let { keeper, links, gates } = mk()
        await keeper.connect(null)
        links[0].destroy()
        let { p: p1, cancel } = cancellable(keeper, links[0])
        cancel()
        let p2 = keeper.reconnect(links[0]) //同一同步段內緊接要求
        assert.strict.deepEqual(links.length, 3, '須另起新嘗試')
        assert.strict.deepEqual(links[1].dead, true)
        gates[2].open()
        let r2 = await settleWithin(p2, 3000)
        assert.ok(r2.ok && r2.value.link === links[2] && keeper.current() === links[2])
        let r1 = await settleWithin(p1, 3000) //已取消者改用他方換上之新連線
        assert.ok(r1.settled)
    })

    it('他方已併入同一次嘗試: 發起者之取消不影響併入者', async function() {
        let { keeper, links, gates } = mk()
        await keeper.connect(null)
        links[0].destroy()
        let { p: p1, cancel } = cancellable(keeper, links[0])
        let p2 = keeper.acquire('ftpLs', null)
        await tick()
        cancel()
        assert.strict.deepEqual(links[1].dead, false)
        gates[1].open()
        let r2 = await settleWithin(p2, 3000)
        assert.ok(r2.ok && r2.value === links[1])
        let r1 = await settleWithin(p1, 3000)
        assert.ok(r1.ok && r1.value.link === links[1])
        assert.strict.deepEqual(links.length, 2)
    })

    it('重放中取消: 立即清空連線(須重新conn), 其後之要求視為未連線', async function() {
        let g = gate()
        let { keeper, links, gates } = mk({ replayGate: g })
        await keeper.connect(null)
        links[0].destroy()
        let { p: p1, cancel } = cancellable(keeper, links[0])
        gates[1].open()
        await tick()
        cancel()
        assert.strict.deepEqual(keeper.current(), null)
        let e = await settleWithin(keeper.acquire('ftpLs', null), 3000)
        assert.strict.deepEqual(e.err, connKeeper.msgNotInit)
        g.open()
        let r1 = await settleWithin(p1, 3000)
        assert.ok(r1.settled && !r1.ok)
        assert.strict.deepEqual(links.length, 2)
    })

    it('cancelPending只取消針對指定連線之嘗試: 前一次quit之收尾不影響後來連線之重新連線', async function() {
        let { keeper, links, gates } = mk()
        await keeper.connect(null)
        let first = links[0]
        first.destroy()
        let p1 = keeper.reconnect(first)
        keeper.cancelPending({}) //他連線
        assert.strict.deepEqual(links[1].dead, false)
        gates[1].open()
        let r1 = await settleWithin(p1, 3000)
        assert.ok(r1.ok && r1.value.link === links[1])
        links[1].destroy()
        let p2 = keeper.reconnect(links[1])
        keeper.cancelPending(first) //前一條連線之收尾
        assert.strict.deepEqual(links[2].dead, false)
        keeper.cancelPending(links[1])
        assert.strict.deepEqual(links[2].dead, true)
        let r2 = await settleWithin(p2, 3000)
        assert.ok(r2.settled && !r2.ok)
    })

    it('release只釋放資源不改變dropped, destroy標示為本套件銷毀並帶死因代碼', function() {
        let calls = []
        let a = connKeeper.genLink({}, (c, bKeepBusy) => calls.push(bKeepBusy))
        a.release()
        assert.strict.deepEqual([a.dropped, a.dead, calls], [false, false, [true]])
        let b = connKeeper.genLink({}, (c, bKeepBusy) => calls.push(bKeepBusy))
        b.destroy('TIMEOUT')
        b.destroy()
        assert.strict.deepEqual([b.dropped, b.dead, b.code, calls], [true, true, 'TIMEOUT', [true, false]])
    })

})
