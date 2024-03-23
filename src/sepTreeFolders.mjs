import each from 'lodash-es/each.js'
import dropRight from 'lodash-es/dropRight.js'
import sep from 'wsemi/src/sep.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import strdelleft from 'wsemi/src/strdelleft.mjs'


function sepTreeFolders(p) {
    if (strleft(p, 1) === '.') {
        p = strdelleft(p, 1)
    }
    let ss = sep(p, '/')
    ss = dropRight(ss) //去除檔案
    let rs = []
    let fd = '.'
    each(ss, (v) => {
        fd += '/' + v
        rs.push(fd)
    })
    return rs
}


export default sepTreeFolders
