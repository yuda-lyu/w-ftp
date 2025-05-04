import path from 'path'
import fs from 'fs'
import WFtp from './src/WFtp.mjs'
// import WFtp from './dist/w-ftp.umd.js'


//st
let fp = path.resolve('../', './_data', 'settings.json')
let j = fs.readFileSync(fp, 'utf8')
let st = JSON.parse(j)
console.log(st)


async function test_up() {
    let r

    let ftp = WFtp({
        transportation: 'SFTP',
        hostname: st.SFTP.hostname,
        port: st.SFTP.port,
        username: st.SFTP.username,
        password: st.SFTP.password,
    })
    // console.log('ftp', ftp)

    await ftp.conn()

    async function core() {

        let fps = await ftp.ls('./_test_upload_srv')
        console.log('ftp.ls', fps[0], fps.length)

        r = await ftp.stat('./_test_upload_srv/DECL_202108.csv')
        console.log('ftp.stat', r)

        r = await ftp.stat('./_test_upload_srv/L1-DECL_202108.csv')
        console.log('ftp.stat', r)

        r = await ftp.isFile('./_test_upload_srv/DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFile('./_test_upload_srv/L1-DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFile('./_test_upload_srv/test/DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFile('./_test_upload_srv/test/L2-DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFolder('./_test_upload_srv/DECL_20210805055044.csv')
        console.log('ftp.isFolder', r)

        r = await ftp.isFolder('./_test_upload_srv/test2')
        console.log('ftp.isFolder', r)

        r = await ftp.upload('./_test_upload_client/L1-DECL_20210805055044.csv', './_test_upload_srv/L1-DECL_20210805055044.csv', (p) => {
            console.log('ftp.upload p', p.name, p.progress)
        })
        console.log('ftp.upload', r)

        r = await ftp.upload('./_test_upload_client/test/test2/L3-DECL_202108.csv', './_test_upload_srv/test/test2/L3-DECL_202108.csv', (p) => {
            console.log('ftp.upload p', p.name, p.progress)
        })
        console.log('ftp.upload', r)

        r = await ftp.syncToRemote('./_test_upload_client', './_test_upload_srv', (p) => {
            console.log('ftp.syncToRemote p', p.name, p.progress)
        }, { forceOverwriteWhenSync: false })
        console.log('ftp.syncToRemote', r)

    }
    await core()
        .catch((err) => {
            console.log(err)
        })

    r = await ftp.quit()
    console.log('ftp.quit', r)

}
test_up()
    .catch((err) => {
        console.log(err)
    })
// ftp.ls {
//   type: 'd',
//   name: 'test2',
//   size: 0,
//   modifyTime: 1692529018000,
//   accessTime: 1692692728000,
//   rights: { user: 'rwx', group: '***', other: '***' },
//   owner: 0,
//   group: 0,
//   longname: 'drwx******    1 -        -               0 Aug 20 18:56 test2',
//   atime: '2023-08-22T16:25:28+08:00',
//   mtime: '2023-08-20T18:56:58+08:00',
//   isFolder: true
// } 1
// ftp.stat {
//   err: 'Error: _xstat: No such file: ./_test_upload_srv/DECL_202108.csv'
// }
// ftp.stat {
//   err: 'Error: _xstat: No such file: ./_test_upload_srv/L1-DECL_202108.csv'
// }
// ftp.isFile false
// ftp.isFile false
// ftp.isFile false
// ftp.isFile false
// ftp.isFolder false
// Ftp.stat then {
//   mode: 16832,
//   uid: 0,
//   gid: 0,
//   size: 0,
//   accessTime: 1692692728000,
//   modifyTime: 1692529018000,
//   isDirectory: true,
//   isFile: false,
//   isBlockDevice: false,
//   isCharacterDevice: false,
//   isSymbolicLink: false,
//   isFIFO: false,
//   isSocket: false
// }
// ftp.isFolder true
// ftp.upload p L1-DECL_20210805055044.csv 2.3660435777166757
// ftp.upload p L1-DECL_20210805055044.csv 4.7320871554333515
// ftp.upload p L1-DECL_20210805055044.csv 7.098130733150026
// ftp.upload p L1-DECL_20210805055044.csv 9.464174310866703
// ftp.upload p L1-DECL_20210805055044.csv 11.830217888583377
// ftp.upload p L1-DECL_20210805055044.csv 14.196261466300053
// ftp.upload p L1-DECL_20210805055044.csv 16.56230504401673
// ftp.upload p L1-DECL_20210805055044.csv 18.928348621733406
// ftp.upload p L1-DECL_20210805055044.csv 21.29439219945008
// ftp.upload p L1-DECL_20210805055044.csv 23.660435777166754
// ftp.upload p L1-DECL_20210805055044.csv 26.02647935488343
// ftp.upload p L1-DECL_20210805055044.csv 28.392522932600105
// ftp.upload p L1-DECL_20210805055044.csv 30.758566510316783
// ftp.upload p L1-DECL_20210805055044.csv 33.12461008803346
// ftp.upload p L1-DECL_20210805055044.csv 35.49065366575013
// ftp.upload p L1-DECL_20210805055044.csv 37.85669724346681
// ftp.upload p L1-DECL_20210805055044.csv 40.222740821183486
// ftp.upload p L1-DECL_20210805055044.csv 42.58878439890016
// ftp.upload p L1-DECL_20210805055044.csv 44.95482797661683
// ftp.upload p L1-DECL_20210805055044.csv 47.32087155433351
// ftp.upload p L1-DECL_20210805055044.csv 49.68691513205019
// ftp.upload p L1-DECL_20210805055044.csv 52.05295870976686
// ftp.upload p L1-DECL_20210805055044.csv 54.41900228748354
// ftp.upload p L1-DECL_20210805055044.csv 56.78504586520021
// ftp.upload p L1-DECL_20210805055044.csv 59.15108944291689
// ftp.upload p L1-DECL_20210805055044.csv 61.517133020633565
// ftp.upload p L1-DECL_20210805055044.csv 63.883176598350246
// ftp.upload p L1-DECL_20210805055044.csv 66.24922017606691
// ftp.upload p L1-DECL_20210805055044.csv 68.6152637537836
// ftp.upload p L1-DECL_20210805055044.csv 70.98130733150026
// ftp.upload p L1-DECL_20210805055044.csv 73.34735090921694
// ftp.upload p L1-DECL_20210805055044.csv 75.71339448693362
// ftp.upload p L1-DECL_20210805055044.csv 78.0794380646503
// ftp.upload p L1-DECL_20210805055044.csv 80.44548164236697
// ftp.upload p L1-DECL_20210805055044.csv 82.81152522008365
// ftp.upload p L1-DECL_20210805055044.csv 85.17756879780032
// ftp.upload p L1-DECL_20210805055044.csv 87.543612375517
// ftp.upload p L1-DECL_20210805055044.csv 89.90965595323367
// ftp.upload p L1-DECL_20210805055044.csv 92.27569953095035
// ftp.upload p L1-DECL_20210805055044.csv 94.64174310866701
// ftp.upload p L1-DECL_20210805055044.csv 97.0077866863837
// ftp.upload p L1-DECL_20210805055044.csv 99.37383026410038
// ftp.upload p L1-DECL_20210805055044.csv 100
// ftp.upload ok
// ftp.upload p L3-DECL_202108.csv 14.983766976084869
// ftp.upload p L3-DECL_202108.csv 29.967533952169738
// ftp.upload p L3-DECL_202108.csv 44.951300928254604
// ftp.upload p L3-DECL_202108.csv 59.935067904339476
// ftp.upload p L3-DECL_202108.csv 74.91883488042434
// ftp.upload p L3-DECL_202108.csv 89.90260185650921
// ftp.upload p L3-DECL_202108.csv 100
// ftp.upload ok
// ftp.syncToRemote p L1-DECL_202108.csv 14.983766976084869
// ftp.syncToRemote p L1-DECL_202108.csv 29.967533952169738
// ftp.syncToRemote p L1-DECL_202108.csv 44.951300928254604
// ftp.syncToRemote p L1-DECL_202108.csv 59.935067904339476
// ftp.syncToRemote p L1-DECL_202108.csv 74.91883488042434
// ftp.syncToRemote p L1-DECL_202108.csv 89.90260185650921
// ftp.syncToRemote p L1-DECL_202108.csv 100
// ftp.syncToRemote p L2-DECL_202108.csv 14.983766976084869
// ftp.syncToRemote p L2-DECL_202108.csv 29.967533952169738
// ftp.syncToRemote p L2-DECL_202108.csv 44.951300928254604
// ftp.syncToRemote p L2-DECL_202108.csv 59.935067904339476
// ftp.syncToRemote p L2-DECL_202108.csv 74.91883488042434
// ftp.syncToRemote p L2-DECL_202108.csv 89.90260185650921
// ftp.syncToRemote p L2-DECL_202108.csv 100
// ftp.syncToRemote p L2-DECL_20210805055044.csv 2.3660435777166757
// ftp.syncToRemote p L2-DECL_20210805055044.csv 4.7320871554333515
// ftp.syncToRemote p L2-DECL_20210805055044.csv 7.098130733150026
// ftp.syncToRemote p L2-DECL_20210805055044.csv 9.464174310866703
// ftp.syncToRemote p L2-DECL_20210805055044.csv 11.830217888583377
// ftp.syncToRemote p L2-DECL_20210805055044.csv 14.196261466300053
// ftp.syncToRemote p L2-DECL_20210805055044.csv 16.56230504401673
// ftp.syncToRemote p L2-DECL_20210805055044.csv 18.928348621733406
// ftp.syncToRemote p L2-DECL_20210805055044.csv 21.29439219945008
// ftp.syncToRemote p L2-DECL_20210805055044.csv 23.660435777166754
// ftp.syncToRemote p L2-DECL_20210805055044.csv 26.02647935488343
// ftp.syncToRemote p L2-DECL_20210805055044.csv 28.392522932600105
// ftp.syncToRemote p L2-DECL_20210805055044.csv 30.758566510316783
// ftp.syncToRemote p L2-DECL_20210805055044.csv 33.12461008803346
// ftp.syncToRemote p L2-DECL_20210805055044.csv 35.49065366575013
// ftp.syncToRemote p L2-DECL_20210805055044.csv 37.85669724346681
// ftp.syncToRemote p L2-DECL_20210805055044.csv 40.222740821183486
// ftp.syncToRemote p L2-DECL_20210805055044.csv 42.58878439890016
// ftp.syncToRemote p L2-DECL_20210805055044.csv 44.95482797661683
// ftp.syncToRemote p L2-DECL_20210805055044.csv 47.32087155433351
// ftp.syncToRemote p L2-DECL_20210805055044.csv 49.68691513205019
// ftp.syncToRemote p L2-DECL_20210805055044.csv 52.05295870976686
// ftp.syncToRemote p L2-DECL_20210805055044.csv 54.41900228748354
// ftp.syncToRemote p L2-DECL_20210805055044.csv 56.78504586520021
// ftp.syncToRemote p L2-DECL_20210805055044.csv 59.15108944291689
// ftp.syncToRemote p L2-DECL_20210805055044.csv 61.517133020633565
// ftp.syncToRemote p L2-DECL_20210805055044.csv 63.883176598350246
// ftp.syncToRemote p L2-DECL_20210805055044.csv 66.24922017606691
// ftp.syncToRemote p L2-DECL_20210805055044.csv 68.6152637537836
// ftp.syncToRemote p L2-DECL_20210805055044.csv 70.98130733150026
// ftp.syncToRemote p L2-DECL_20210805055044.csv 73.34735090921694
// ftp.syncToRemote p L2-DECL_20210805055044.csv 75.71339448693362
// ftp.syncToRemote p L2-DECL_20210805055044.csv 78.0794380646503
// ftp.syncToRemote p L2-DECL_20210805055044.csv 80.44548164236697
// ftp.syncToRemote p L2-DECL_20210805055044.csv 82.81152522008365
// ftp.syncToRemote p L2-DECL_20210805055044.csv 85.17756879780032
// ftp.syncToRemote p L2-DECL_20210805055044.csv 87.543612375517
// ftp.syncToRemote p L2-DECL_20210805055044.csv 89.90965595323367
// ftp.syncToRemote p L2-DECL_20210805055044.csv 92.27569953095035
// ftp.syncToRemote p L2-DECL_20210805055044.csv 94.64174310866701
// ftp.syncToRemote p L2-DECL_20210805055044.csv 97.0077866863837
// ftp.syncToRemote p L2-DECL_20210805055044.csv 99.37383026410038
// ftp.syncToRemote p L2-DECL_20210805055044.csv 100
// ftp.syncToRemote p L3-DECL_20210805055044.csv 2.3660435777166757
// ftp.syncToRemote p L3-DECL_20210805055044.csv 4.7320871554333515
// ftp.syncToRemote p L3-DECL_20210805055044.csv 7.098130733150026
// ftp.syncToRemote p L3-DECL_20210805055044.csv 9.464174310866703
// ftp.syncToRemote p L3-DECL_20210805055044.csv 11.830217888583377
// ftp.syncToRemote p L3-DECL_20210805055044.csv 14.196261466300053
// ftp.syncToRemote p L3-DECL_20210805055044.csv 16.56230504401673
// ftp.syncToRemote p L3-DECL_20210805055044.csv 18.928348621733406
// ftp.syncToRemote p L3-DECL_20210805055044.csv 21.29439219945008
// ftp.syncToRemote p L3-DECL_20210805055044.csv 23.660435777166754
// ftp.syncToRemote p L3-DECL_20210805055044.csv 26.02647935488343
// ftp.syncToRemote p L3-DECL_20210805055044.csv 28.392522932600105
// ftp.syncToRemote p L3-DECL_20210805055044.csv 30.758566510316783
// ftp.syncToRemote p L3-DECL_20210805055044.csv 33.12461008803346
// ftp.syncToRemote p L3-DECL_20210805055044.csv 35.49065366575013
// ftp.syncToRemote p L3-DECL_20210805055044.csv 37.85669724346681
// ftp.syncToRemote p L3-DECL_20210805055044.csv 40.222740821183486
// ftp.syncToRemote p L3-DECL_20210805055044.csv 42.58878439890016
// ftp.syncToRemote p L3-DECL_20210805055044.csv 44.95482797661683
// ftp.syncToRemote p L3-DECL_20210805055044.csv 47.32087155433351
// ftp.syncToRemote p L3-DECL_20210805055044.csv 49.68691513205019
// ftp.syncToRemote p L3-DECL_20210805055044.csv 52.05295870976686
// ftp.syncToRemote p L3-DECL_20210805055044.csv 54.41900228748354
// ftp.syncToRemote p L3-DECL_20210805055044.csv 56.78504586520021
// ftp.syncToRemote p L3-DECL_20210805055044.csv 59.15108944291689
// ftp.syncToRemote p L3-DECL_20210805055044.csv 61.517133020633565
// ftp.syncToRemote p L3-DECL_20210805055044.csv 63.883176598350246
// ftp.syncToRemote p L3-DECL_20210805055044.csv 66.24922017606691
// ftp.syncToRemote p L3-DECL_20210805055044.csv 68.6152637537836
// ftp.syncToRemote p L3-DECL_20210805055044.csv 70.98130733150026
// ftp.syncToRemote p L3-DECL_20210805055044.csv 73.34735090921694
// ftp.syncToRemote p L3-DECL_20210805055044.csv 75.71339448693362
// ftp.syncToRemote p L3-DECL_20210805055044.csv 78.0794380646503
// ftp.syncToRemote p L3-DECL_20210805055044.csv 80.44548164236697
// ftp.syncToRemote p L3-DECL_20210805055044.csv 82.81152522008365
// ftp.syncToRemote p L3-DECL_20210805055044.csv 85.17756879780032
// ftp.syncToRemote p L3-DECL_20210805055044.csv 87.543612375517
// ftp.syncToRemote p L3-DECL_20210805055044.csv 89.90965595323367
// ftp.syncToRemote p L3-DECL_20210805055044.csv 92.27569953095035
// ftp.syncToRemote p L3-DECL_20210805055044.csv 94.64174310866701
// ftp.syncToRemote p L3-DECL_20210805055044.csv 97.0077866863837
// ftp.syncToRemote p L3-DECL_20210805055044.csv 99.37383026410038
// ftp.syncToRemote p L3-DECL_20210805055044.csv 100
// ftp.syncToRemote {
//   num: 4,
//   files: [
//     {
//       name: './_test_upload_srv/L1-DECL_202108.csv',
//       reason: 'no Remote file'
//     },
//     {
//       name: './_test_upload_srv/test/L2-DECL_202108.csv',
//       reason: 'no Remote file'
//     },
//     {
//       name: './_test_upload_srv/test/L2-DECL_20210805055044.csv',
//       reason: 'no Remote file'
//     },
//     {
//       name: './_test_upload_srv/test/test2/L3-DECL_20210805055044.csv',
//       reason: 'no Remote file'
//     }
//   ]
// }
// ftp.quit ok

//node g-sftp-upload.mjs
