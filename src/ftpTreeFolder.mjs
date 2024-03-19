import get from 'lodash-es/get'
import ispint from 'wsemi/src/ispint.mjs'
import getFileName from 'wsemi/src/getFileName.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'


function ftpTreeFolder(fd, ftpLs, opt = {}) {
    let level = 1

    //levelLimit
    let levelLimit = get(opt, 'levelLimit')
    if (!ispint(levelLimit)) {
        levelLimit = null
    }

    let pathMerge = (p1, p2) => {
        let p = `${p1}/${p2}` //path.resolve(p1, p2)
        return p
    }

    //tree
    let tree = async (fd) => {
        let rs = []

        //readdirSync
        let items = await ftpLs(fd)

        //each
        await pmSeries(items, async(item) => {
            // console.log(item)

            //fp
            let fp = pathMerge(fd, item.name)
            // console.log('fd=', fd, 'item.name=', item.name)
            // console.log('fp', fp)
            // console.log('getFileName(fp)', getFileName(fp))

            //proc
            if (item.isFolder) {

                //push
                rs.push({
                    ...item,
                    isFolder: true,
                    level,
                    rpath: fp,
                    name: getFileName(fp),
                })

                //tree
                level += 1
                if (level <= levelLimit || levelLimit === null) {
                    let r = await tree(fp)
                    rs = rs.concat(r)
                }

                level -= 1

            }
            else {

                //push
                rs.push({
                    ...item,
                    isFolder: false,
                    level,
                    rpath: fp,
                    name: getFileName(fp),
                })

            }

        })

        return rs
    }

    return tree(fd)
}


export default ftpTreeFolder
