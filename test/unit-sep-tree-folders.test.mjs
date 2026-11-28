import assert from 'assert'
import sepTreeFolders from '../src/sepTreeFolders.mjs'


describe('unit-sep-tree-folders', function() {

    it('第1層檔案無父資料夾', function() {
        assert.strict.deepEqual(sepTreeFolders('./t1.txt'), [])
        assert.strict.deepEqual(sepTreeFolders('t1.txt'), [])
    })

    it('多層路徑解析出逐層父資料夾', function() {
        assert.strict.deepEqual(sepTreeFolders('./a/b/c.txt'), ['./a', './a/b'])
        assert.strict.deepEqual(sepTreeFolders('a/b/c.txt'), ['./a', './a/b'])
        assert.strict.deepEqual(sepTreeFolders('./deep/up2.txt'), ['./deep'])
    })

    it('絕對路徑解析出絕對之逐層父資料夾', function() {
        assert.strict.deepEqual(sepTreeFolders('/a/b/c.txt'), ['/a', '/a/b'])
        assert.strict.deepEqual(sepTreeFolders('//a//b/c.txt'), ['/a', '/a/b'])
        assert.strict.deepEqual(sepTreeFolders('/c.txt'), [])
    })

    it('..保留於路徑中且本身不列為待建資料夾', function() {
        assert.strict.deepEqual(sepTreeFolders('../x/y.txt'), ['./../x'])
        assert.strict.deepEqual(sepTreeFolders('./a/../b/f.txt'), ['./a', './a/../b'])
        assert.strict.deepEqual(sepTreeFolders('/a/../b/c/f.txt'), ['/a', '/a/../b', '/a/../b/c'])
        assert.strict.deepEqual(sepTreeFolders('../../f.txt'), [])
    })

    it('.起首之名稱與含前後空白之名稱原樣保留', function() {
        assert.strict.deepEqual(sepTreeFolders('.hidden/a/f.txt'), ['./.hidden', './.hidden/a'])
        assert.strict.deepEqual(sepTreeFolders('./.dot/f.txt'), ['./.dot'])
        assert.strict.deepEqual(sepTreeFolders('...x/f.txt'), ['./...x'])
        assert.strict.deepEqual(sepTreeFolders(' a / b /f.txt'), ['./ a ', './ a / b '])
        assert.strict.deepEqual(sepTreeFolders('./a/./b/f.txt'), ['./a', './a/b'])
    })

    it('尾端/之路徑沿用原版: 最後一段視為檔名', function() {
        assert.strict.deepEqual(sepTreeFolders('a/b/'), ['./a'])
    })

    it('非有效字串回空陣列', function() {
        for (let v of [undefined, null, '', 1, {}, []]) {
            assert.strict.deepEqual(sepTreeFolders(v), [])
        }
    })

})
