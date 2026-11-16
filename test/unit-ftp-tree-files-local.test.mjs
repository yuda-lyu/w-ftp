import fs from 'fs'
import path from 'path'
import assert from 'assert'
import w from 'wsemi'
import ftpTreeFilesInLocalAndRemote from '../src/ftpTreeFilesInLocalAndRemote.mjs'
import ftpSyncToRemote from '../src/ftpSyncToRemote.mjs'
import ftpSyncToLocal from '../src/ftpSyncToLocal.mjs'


//ftpTreeFilesInLocalAndRemote之本機半邊: 本機資料夾列舉之層數限制
//規格(使用端需求, wsemi fsTreeFolder之levelLimit改制): 本庫opt.levelLimit非正整數表不限層數, 傳給wsemi之fs列舉函數時須為大有限值4294967295,
//因新版wsemi之fsTreeFolder給null時改取預設1(只列第1層); 遠端列舉(ftpLs)不在本測試範圍, 以空列舉之替身取代
describe('unit-ftp-tree-files-local', function() {

    //fdBase, 測試臨時資料夾(依測試規範放test/_tmp/<案名>/)
    let fdBase = './test/_tmp/ftp-tree-files-local'

    //fdLocal, 本機資料夾, 內含第1層1個檔案, 第2層1個檔案, 第3層1個檔案與1個空資料夾
    let fdLocal = `${fdBase}/local`

    //ftpLs, 遠端列舉替身, 遠端無任何檔案
    let ftpLsEmpty = async () => {
        return []
    }

    //rpaths, 取本機列舉結果之遠端相對路徑並排序
    let rpaths = (r) => {
        return r.fsLocal.map((v) => {
            return v.rpath
        }).sort()
    }

    //全部層級之檔案
    let all = ['./abc/z2.txt', './def/ijk/z3.txt', './z1.txt']

    before(function() {
        w.fsDeleteFolder(fdBase)
        w.fsCreateFolder(fdLocal)
        fs.writeFileSync(`${fdLocal}/z1.txt`, 'z1', 'utf8')
        w.fsCreateFolder(`${fdLocal}/abc`)
        fs.writeFileSync(`${fdLocal}/abc/z2.txt`, 'z2', 'utf8')
        w.fsCreateFolder(`${fdLocal}/def/ijk`)
        fs.writeFileSync(`${fdLocal}/def/ijk/z3.txt`, 'z3', 'utf8')
        w.fsCreateFolder(`${fdLocal}/mno/pqr`)
    })

    after(function() {
        w.fsDeleteFolder(fdBase)
    })

    it('opt.levelLimit未給: 列舉全部層級之本機檔案(不只第1層)', async function() {
        let r = await ftpTreeFilesInLocalAndRemote('.', fdLocal, { ftpLs: ftpLsEmpty })
        assert.strict.deepEqual(rpaths(r), all)
    })

    it('opt.levelLimit為非正整數(null,undefined,0,-1,1.5,字串,NaN): 皆視為不限層數, 列舉全部層級', async function() {
        for (let levelLimit of [null, undefined, 0, -1, 1.5, 'abc', NaN]) {
            let r = await ftpTreeFilesInLocalAndRemote('.', fdLocal, { ftpLs: ftpLsEmpty, levelLimit })
            assert.strict.deepEqual(rpaths(r), all, `levelLimit=${String(levelLimit)}`)
        }
    })

    it('opt.levelLimit為正整數: 依層數限制列舉(1只第1層, 2至第2層, 3及更大列全部)', async function() {
        let cases = [
            { levelLimit: 1, rps: ['./z1.txt'] },
            { levelLimit: 2, rps: ['./abc/z2.txt', './z1.txt'] },
            { levelLimit: 3, rps: all },
            { levelLimit: 99, rps: all },
            { levelLimit: 4294967295, rps: all },
        ]
        for (let c of cases) {
            let r = await ftpTreeFilesInLocalAndRemote('.', fdLocal, { ftpLs: ftpLsEmpty, levelLimit: c.levelLimit })
            assert.strict.deepEqual(rpaths(r), c.rps, `levelLimit=${c.levelLimit}`)
        }
    })

    it('opt.levelLimit未給: 本機檔案之path, rpath, size與資料夾不列入之輸出不變', async function() {
        let r = await ftpTreeFilesInLocalAndRemote('./remote', fdLocal, { ftpLs: ftpLsEmpty })
        let fs3 = r.fsLocal.find((v) => {
            return v.rpath === './remote/def/ijk/z3.txt'
        })
        assert.strict.deepEqual(fs3.isFolder, false)
        assert.strict.deepEqual(fs3.level, 3)
        assert.strict.deepEqual(fs3.name, 'z3.txt')
        assert.strict.deepEqual(fs3.size, 2)
        assert.strict.deepEqual(fs3.path, path.resolve(fdLocal, 'def/ijk/z3.txt'))
        assert.strict.deepEqual(r.fsLocal.length, 3) //空資料夾與資料夾本身不列入
        assert.strict.deepEqual(r.fsRemote, [])
    })

    it('ftpSyncToRemote未給levelLimit: 全部層級之本機檔案皆納入同步(本機端不短少)', async function() {
        let ups = []
        let r = await ftpSyncToRemote(fdLocal, '.', null, {
            ftpLs: ftpLsEmpty,
            ftpUpload: async (fpLocal, fpRemote) => {
                ups.push(fpRemote)
            },
        })
        assert.strict.deepEqual(ups.sort(), all)
        assert.strict.deepEqual(r.num, 3)
    })

    it('ftpSyncToLocal未給levelLimit: 遠端與本機皆有且大小相同之深層檔案不重複下載(本機端不短少)', async function() {

        //遠端列舉替身: 與本機同構之全部檔案, 大小同為2
        let tree = {
            '.': [{ name: 'z1.txt', isFolder: false, size: 2 }, { name: 'abc', isFolder: true, size: 0 }, { name: 'def', isFolder: true, size: 0 }],
            './abc': [{ name: 'z2.txt', isFolder: false, size: 2 }],
            './def': [{ name: 'ijk', isFolder: true, size: 0 }],
            './def/ijk': [{ name: 'z3.txt', isFolder: false, size: 2 }],
        }
        let ftpLs = async (fd) => {
            return tree[fd] || []
        }

        let dws = []
        let r = await ftpSyncToLocal('.', fdLocal, null, {
            ftpLs,
            ftpDownload: async (fpRemote, fpLocal) => {
                dws.push(fpRemote)
            },
        })
        assert.strict.deepEqual(dws, [])
        assert.strict.deepEqual(r.num, 0)
    })

})
