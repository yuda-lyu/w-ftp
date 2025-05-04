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

    let ftp = WFtp({
        transportation: 'FTP',
        hostname: st.FTP.dw.hostname,
        port: st.FTP.dw.port,
        username: st.FTP.dw.username,
        password: st.FTP.dw.password,
    })
    // console.log('ftp', ftp)

    await ftp.conn()

    async function core() {

        let fps = await ftp.ls('.')
        console.log('ftp.ls', fps[0], fps.length)

        r = await ftp.stat('./DECL_202108.csv')
        console.log('ftp.stat', r)

        r = await ftp.isFile('./DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFile('./test/DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFolder('./DECL_20210805055044.csv')
        console.log('ftp.isFolder', r)

        r = await ftp.download('./DECL_20210805055044.csv', './_test_download_client/DECL_20210805055044.csv', (p) => {
            console.log('ftp.download p', p.name, p.progress)
        })
        console.log('ftp.download', r)

        r = await ftp.syncToLocal('.', './_test_download_client', (p) => {
            console.log('ftp.syncToLocal p', p.name, p.progress)
        }, { forceOverwriteWhenSync: false })
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
//   time: 1692318720000,
//   size: 218690,
//   owner: 'ftp',
//   group: 'ftp',
//   userPermissions: { read: true, write: true, exec: false },
//   groupPermissions: { read: true, write: true, exec: false },
//   otherPermissions: { read: true, write: true, exec: false },
//   mtime: '2023-08-18T16:32:00+08:00',
//   isFolder: false
// } 5
// ftp.stat {
//   rmlst: {
//     code: 250,
//     text: '250-Listing ./DECL_202108.csv\n' +
//       ' type=file;size=218690;modify=20230818083200.283;perms=awrfd; /DECL_202108.csv\n' +
//       '250 End',
//     isMark: false,
//     isError: false
//   },
//   mtime: '2023-08-18T16:32:00+08:00',
//   isFolder: false,
//   isFile: true,
//   rsize: { code: 213, text: '213 218690', isMark: false, isError: false },
//   size: 218690
// }
// ftp.isFile true
// ftp.isFile true
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
// ftp.syncToLocal p DECL_202108.csv 29.967533952169738
// ftp.syncToLocal p DECL_202108.csv 59.935067904339476
// ftp.syncToLocal p DECL_202108.csv 89.90260185650921
// ftp.syncToLocal p DECL_202108.csv 100
// ftp.syncToLocal p DECL_20210805055629.csv 4.709754616437716
// ftp.syncToLocal p DECL_20210805055629.csv 9.419509232875432
// ftp.syncToLocal p DECL_20210805055629.csv 14.129263849313148
// ftp.syncToLocal p DECL_20210805055629.csv 18.839018465750865
// ftp.syncToLocal p DECL_20210805055629.csv 23.548773082188582
// ftp.syncToLocal p DECL_20210805055629.csv 28.258527698626295
// ftp.syncToLocal p DECL_20210805055629.csv 32.968282315064016
// ftp.syncToLocal p DECL_20210805055629.csv 37.67803693150173
// ftp.syncToLocal p DECL_20210805055629.csv 42.38779154793944
// ftp.syncToLocal p DECL_20210805055629.csv 47.097546164377164
// ftp.syncToLocal p DECL_20210805055629.csv 51.80730078081488
// ftp.syncToLocal p DECL_20210805055629.csv 56.51705539725259
// ftp.syncToLocal p DECL_20210805055629.csv 61.22681001369031
// ftp.syncToLocal p DECL_20210805055629.csv 65.93656463012803
// ftp.syncToLocal p DECL_20210805055629.csv 70.64631924656575
// ftp.syncToLocal p DECL_20210805055629.csv 75.35607386300346
// ftp.syncToLocal p DECL_20210805055629.csv 80.06582847944118
// ftp.syncToLocal p DECL_20210805055629.csv 84.77558309587889
// ftp.syncToLocal p DECL_20210805055629.csv 89.4853377123166
// ftp.syncToLocal p DECL_20210805055629.csv 94.19509232875433
// ftp.syncToLocal p DECL_20210805055629.csv 98.90484694519203
// ftp.syncToLocal p DECL_20210805055629.csv 100
// ftp.syncToLocal p DECL_202109.csv 30.538818913415255
// ftp.syncToLocal p DECL_202109.csv 61.07763782683051
// ftp.syncToLocal p DECL_202109.csv 91.61645674024575
// ftp.syncToLocal p DECL_202109.csv 100
// ftp.syncToLocal p DECL_202108.csv 29.967533952169738
// ftp.syncToLocal p DECL_202108.csv 59.935067904339476
// ftp.syncToLocal p DECL_202108.csv 89.90260185650921
// ftp.syncToLocal p DECL_202108.csv 100
// ftp.syncToLocal p DECL_20210805055044.csv 4.7320871554333515
// ftp.syncToLocal p DECL_20210805055044.csv 9.464174310866703
// ftp.syncToLocal p DECL_20210805055044.csv 14.196261466300053
// ftp.syncToLocal p DECL_20210805055044.csv 18.928348621733406
// ftp.syncToLocal p DECL_20210805055044.csv 23.660435777166754
// ftp.syncToLocal p DECL_20210805055044.csv 28.392522932600105
// ftp.syncToLocal p DECL_20210805055044.csv 33.12461008803346
// ftp.syncToLocal p DECL_20210805055044.csv 37.85669724346681
// ftp.syncToLocal p DECL_20210805055044.csv 42.58878439890016
// ftp.syncToLocal p DECL_20210805055044.csv 47.32087155433351
// ftp.syncToLocal p DECL_20210805055044.csv 52.05295870976686
// ftp.syncToLocal p DECL_20210805055044.csv 56.78504586520021
// ftp.syncToLocal p DECL_20210805055044.csv 61.517133020633565
// ftp.syncToLocal p DECL_20210805055044.csv 66.24922017606691
// ftp.syncToLocal p DECL_20210805055044.csv 70.98130733150026
// ftp.syncToLocal p DECL_20210805055044.csv 75.71339448693362
// ftp.syncToLocal p DECL_20210805055044.csv 80.44548164236697
// ftp.syncToLocal p DECL_20210805055044.csv 85.17756879780032
// ftp.syncToLocal p DECL_20210805055044.csv 89.90965595323367
// ftp.syncToLocal p DECL_20210805055044.csv 94.64174310866701
// ftp.syncToLocal p DECL_20210805055044.csv 99.37383026410038
// ftp.syncToLocal p DECL_20210805055044.csv 100
// ftp.syncToLocal {
//   num: 5,
//   files: [
//     { path: './DECL_202108.csv', reason: 'no local file' },
//     { path: './DECL_20210805055629.csv', reason: 'no local file' },
//     { path: './DECL_202109.csv', reason: 'no local file' },
//     { path: './test/DECL_202108.csv', reason: 'no local file' },
//     { path: './test/DECL_20210805055044.csv', reason: 'no local file' }
//   ]
// }
// ftp.quit { code: 221, text: '221 Goodbye.', isMark: false, isError: false }

//node g-ftp-download.mjs
