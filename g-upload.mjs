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

    let ftp = WFtp()
    // console.log('ftp', ftp)

    await ftp.conn({
        hostname: st.up.hostname,
        port: st.up.port,
        username: st.up.username,
        password: st.up.password,
    })

    async function core() {

        let fps = await ftp.ls('.')
        console.log('ftp.ls', fps[0], fps.length)

        r = await ftp.isFile('./DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFolder('./DECL_20210805055044.csv')
        console.log('ftp.isFolder', r)

        r = await ftp.upload('./_test_upload_client/DECL_20210805055044.csv', './DECL_20210805055044.csv', (p) => {
            console.log('ftp.upload p', p.name, p.progress)
        })
        console.log('ftp.upload', r)

        r = await ftp.syncToRemote('./_test_upload_client', '.', (p) => {
            console.log('ftp.syncToRemote p', p.name, p.progress)
        })
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
//   name: 'DECL_202108.csv',
//   type: 0,
//   time: 1658366760000,
//   size: '218690',
//   owner: 'ftp',
//   group: 'ftp',
//   userPermissions: { read: true, write: true, exec: false },
//   groupPermissions: { read: true, write: true, exec: false },
//   otherPermissions: { read: true, write: true, exec: false }
// } 73
// ftp.isFile false
// ftp.isFolder false
// ftp.upload p DECL_20210805055044.csv 75.71339448693362
// ftp.upload p DECL_20210805055044.csv 100
// ftp.upload ok
// ftp.syncToRemote { num: 0, files: [] }
// ftp.quit { code: 221, text: '221 Goodbye.', isMark: false, isError: false }

//node --experimental-modules --es-module-specifier-resolution=node g-upload.mjs
