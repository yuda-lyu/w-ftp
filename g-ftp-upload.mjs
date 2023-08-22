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
        transportation: 'FTP',
        hostname: st.FTP.up.hostname,
        port: st.FTP.up.port,
        username: st.FTP.up.username,
        password: st.FTP.up.password,
    })
    // console.log('ftp', ftp)

    await ftp.conn()

    async function core() {

        let fps = await ftp.ls('.')
        console.log('ftp.ls', fps[0], fps.length) //_test_upload_srv預先建置test2資料夾, 故fps.length=1

        r = await ftp.stat('./DECL_202108.csv')
        console.log('ftp.stat', r)

        r = await ftp.stat('./L1-DECL_202108.csv')
        console.log('ftp.stat', r)

        r = await ftp.isFile('./DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFile('./L1-DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFile('./test/DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFile('./test/L2-DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFolder('./DECL_20210805055044.csv')
        console.log('ftp.isFolder', r)

        r = await ftp.isFolder('./test2')
        console.log('ftp.isFolder', r)

        r = await ftp.upload('./_test_upload_client/L1-DECL_20210805055044.csv', './L1-DECL_20210805055044.csv', (p) => {
            console.log('ftp.upload p', p.name, p.progress)
        })
        console.log('ftp.upload', r)

        r = await ftp.upload('./_test_upload_client/test/test2/L3-DECL_202108.csv', './test/test2/L3-DECL_202108.csv', (p) => {
            console.log('ftp.upload p', p.name, p.progress)
        })
        console.log('ftp.upload', r)

        r = await ftp.syncToRemote('./_test_upload_client', '.', (p) => {
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
//   name: 'test2',
//   type: 1,
//   time: 1692430740000,
//   size: 0,
//   owner: 'ftp',
//   group: 'ftp',
//   userPermissions: { read: true, write: true, exec: true },
//   groupPermissions: { read: true, write: true, exec: true },
//   otherPermissions: { read: true, write: true, exec: true },
//   mtime: '2023-08-19T23:39:00+08:00',
//   isFolder: true
// } 1
// ftp.stat {
//   rmlst: { err: "Error: 550 Couldn't open the file or directory" },
//   mtime: '',
//   isFolder: false,
//   isFile: false,
//   rsize: { err: "Error: 550 Couldn't open the file or directory" },
//   size: 0
// }
// ftp.stat {
//   rmlst: { err: "Error: 550 Couldn't open the file or directory" },
//   mtime: '',
//   isFolder: false,
//   isFile: false,
//   rsize: { err: "Error: 550 Couldn't open the file or directory" },
//   size: 0
// }
// ftp.isFile false
// ftp.isFile false
// ftp.isFile false
// ftp.isFile false
// ftp.isFolder false
// ftp.isFolder true
// ftp.upload p L1-DECL_20210805055044.csv 75.71339448693362
// ftp.upload p L1-DECL_20210805055044.csv 100
// ftp.upload ok
// ftp.upload p L3-DECL_202108.csv 100
// ftp.upload ok
// ftp.syncToRemote p L1-DECL_202108.csv 100
// ftp.syncToRemote p L2-DECL_202108.csv 100
// ftp.syncToRemote p L2-DECL_20210805055044.csv 75.71339448693362
// ftp.syncToRemote p L2-DECL_20210805055044.csv 100
// ftp.syncToRemote p L3-DECL_20210805055044.csv 75.71339448693362
// ftp.syncToRemote p L3-DECL_20210805055044.csv 100
// ftp.syncToRemote {
//   num: 4,
//   files: [
//     { name: './L1-DECL_202108.csv', reason: 'no Remote file' },
//     { name: './test/L2-DECL_202108.csv', reason: 'no Remote file' },
//     {
//       name: './test/L2-DECL_20210805055044.csv',
//       reason: 'no Remote file'
//     },
//     {
//       name: './test/test2/L3-DECL_20210805055044.csv',
//       reason: 'no Remote file'
//     }
//   ]
// }
// ftp.quit { code: 221, text: '221 Goodbye.', isMark: false, isError: false }

//node --experimental-modules --es-module-specifier-resolution=node g-ftp-upload.mjs
