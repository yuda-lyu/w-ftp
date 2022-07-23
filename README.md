# w-ftp
A tool for ftp.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-ftp.svg?style=flat)](https://npmjs.org/package/w-ftp) 
[![license](https://img.shields.io/npm/l/w-ftp.svg?style=flat)](https://npmjs.org/package/w-ftp) 
[![gzip file size](http://img.badgesize.io/yuda-lyu/w-ftp/master/dist/w-ftp.umd.js.svg?compression=gzip)](https://github.com/yuda-lyu/w-ftp)
[![npm download](https://img.shields.io/npm/dt/w-ftp.svg)](https://npmjs.org/package/w-ftp) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-ftp.svg)](https://www.jsdelivr.com/package/npm/w-ftp)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-ftp/global.htm).

## Installation
### Using npm(ES6 module):
> **Note:** `w-ftp` is mainly dependent on the fork of `jsftp`, `lodash` and `wsemi`.

```alias
npm i w-ftp
```

#### Example for download:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-ftp/blob/master/g-download.mjs)]
```alias
import path from 'path'
import fs from 'fs'
import WFtp from './src/WFtp.mjs'


async function test_up() {
    let r

    let ftp = WFtp()
    // console.log('ftp', ftp)

    await ftp.conn({
        hostname: `hostname`,
        port: `port`,
        username: `username`,
        password: `password`,
    })

    let fps = await ftp.ls('.')
    console.log('ftp.ls', fps[0], fps.length)

    r = await ftp.upload('./_test_upload_client/DECL_20210805055044.csv', './DECL_20210805055044.csv', (p) => {
        console.log('ftp.upload p', p.name, p.progress)
    })
    console.log('ftp.upload', r)

    r = await ftp.syncToRemote('./_test_upload_client', '.', (p) => {
        console.log('ftp.syncToRemote p', p.name, p.progress)
    })
    console.log('ftp.syncToRemote', r)

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
// ftp.upload p DECL_20210805055044.csv 75.71339448693362
// drain
// ftp.upload p DECL_20210805055044.csv 100
// ftp.upload ok
// ftp.syncToRemote { num: 0, files: [] }
// ftp.quit { code: 221, text: '221 Goodbye.', isMark: false, isError: false }

```

#### Example for upload:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-ftp/blob/master/g-upload.mjs)]
```alias
import path from 'path'
import fs from 'fs'
import WFtp from './src/WFtp.mjs'


async function test_dw() {
    let r

    let ftp = WFtp()
    // console.log('ftp', ftp)

    await ftp.conn({
        hostname: `hostname`,
        port: `port`,
        username: `username`,
        password: `password`,
    })

    let fps = await ftp.ls('.')
    console.log('ftp.ls', fps[0], fps.length)

    r = await ftp.download('./DECL_20210805055044.csv', './_test_download_client/DECL_20210805055044.csv', (p) => {
        console.log('ftp.download p', p.name, p.progress)
    })
    console.log('ftp.download', r)

    r = await ftp.syncToLocal('.', './_test_download_client', (p) => {
        console.log('ftp.syncToLocal p', p.name, p.progress)
    })
    console.log('ftp.syncToLocal', r)

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

```
