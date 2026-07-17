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

})
