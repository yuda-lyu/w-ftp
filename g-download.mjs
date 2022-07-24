import path from 'path'
import fs from 'fs'
import WFtp from './src/WFtp.mjs'
// import WFtp from './dist/w-ftp.umd.js'


//st
let fp = path.resolve('../', './_data', 'settings.json')
let j = fs.readFileSync(fp, 'utf8')
let st = JSON.parse(j)
console.log(st)


async function test_dw() {
    let r

    let ftp = WFtp()
    // console.log('ftp', ftp)

    await ftp.conn({
        hostname: st.dw.hostname,
        port: st.dw.port,
        username: st.dw.username,
        password: st.dw.password,
    })

    async function core() {

        let fps = await ftp.ls('.')
        console.log('ftp.ls', fps[0], fps.length)

        r = await ftp.isFile('./DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFolder('./DECL_20210805055044.csv')
        console.log('ftp.isFolder', r)

        r = await ftp.download('./DECL_20210805055044.csv', './_test_download_client/DECL_20210805055044.csv', (p) => {
            console.log('ftp.download p', p.name, p.progress)
        })
        console.log('ftp.download', r)

        r = await ftp.syncToLocal('.', './_test_download_client', (p) => {
            console.log('ftp.syncToLocal p', p.name, p.progress)
        })
        console.log('ftp.syncToLocal', r)

    }
    await core()
        .catch((err) => {
            console.log(err)
        })

    r = await ftp.quit()
    console.log('ftp.quit', r)

}
test_dw()
    .catch((err) => {
        console.log(err)
    })
// ftp.ls {
//   name: 'DECL_202108.csv',
//   type: 0,
//   time: 1658302140000,
//   size: '218690',
//   owner: 'ftp',
//   group: 'ftp',
//   userPermissions: { read: true, write: true, exec: false },
//   groupPermissions: { read: true, write: true, exec: false },
//   otherPermissions: { read: true, write: true, exec: false }
// } 74
// ftp.isFile false
// ftp.isFolder false
// ftp.download p DECL_20210805055044.csv 4.7320871554333515
// ftp.download p DECL_20210805055044.csv 9.464174310866703
// ftp.download p DECL_20210805055044.csv 14.196261466300053
// ftp.download p DECL_20210805055044.csv 18.928348621733406
// ftp.download p DECL_20210805055044.csv 23.660435777166754
// ftp.download p DECL_20210805055044.csv 28.392522932600105
// ftp.download p DECL_20210805055044.csv 33.12461008803346
// ftp.download p DECL_20210805055044.csv 37.85669724346681
// ftp.download p DECL_20210805055044.csv 42.58878439890016
// ftp.download p DECL_20210805055044.csv 47.32087155433351
// ftp.download p DECL_20210805055044.csv 52.05295870976686
// ftp.download p DECL_20210805055044.csv 56.78504586520021
// ftp.download p DECL_20210805055044.csv 61.517133020633565
// ftp.download p DECL_20210805055044.csv 66.24922017606691
// ftp.download p DECL_20210805055044.csv 70.98130733150026
// ftp.download p DECL_20210805055044.csv 75.71339448693362
// ftp.download p DECL_20210805055044.csv 80.44548164236697
// ftp.download p DECL_20210805055044.csv 85.17756879780032
// ftp.download p DECL_20210805055044.csv 89.90965595323367
// ftp.download p DECL_20210805055044.csv 94.64174310866701
// ftp.download p DECL_20210805055044.csv 99.37383026410038
// ftp.download p DECL_20210805055044.csv 100
// ftp.download ok
// ftp.syncToLocal { num: 0, files: [] }
// ftp.quit { code: 221, text: '221 Goodbye.', isMark: false, isError: false }

//node --experimental-modules --es-module-specifier-resolution=node g-download.mjs
