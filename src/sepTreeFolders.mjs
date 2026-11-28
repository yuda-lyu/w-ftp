import each from 'lodash-es/each.js'
import dropRight from 'lodash-es/dropRight.js'
import filter from 'lodash-es/filter.js'
import isestr from 'wsemi/src/isestr.mjs'


//sepTreeFolders, 取檔案路徑之逐層父資料夾(最後一段視為檔名): 絕對路徑('/'起首)回絕對之路徑, 相對路徑回'./'起首之路徑;
//  '..'保留於路徑中(其本身不列為待建資料夾), '.'起首之名稱與含前後空白之名稱原樣保留, 空段與'.'段略去
function sepTreeFolders(p) {
    if (!isestr(p)) {
        return []
    }
    let ss = filter(p.split('/'), (v) => v !== '')
    ss = dropRight(ss) //去除檔案
    ss = filter(ss, (v) => v !== '.')
    let rs = []
    let fd = p.startsWith('/') ? '' : '.'
    each(ss, (v) => {
        fd += '/' + v
        if (v !== '..') {
            rs.push(fd)
        }
    })
    return rs
}


export default sepTreeFolders
