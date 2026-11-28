# w-ftp
A tool for FTP(FTP, SFTP).

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-ftp.svg?style=flat)](https://npmjs.org/package/w-ftp) 
[![license](https://img.shields.io/npm/l/w-ftp.svg?style=flat)](https://npmjs.org/package/w-ftp) 
[![npm download](https://img.shields.io/npm/dt/w-ftp.svg)](https://npmjs.org/package/w-ftp) 
[![npm download](https://img.shields.io/npm/dm/w-ftp.svg)](https://npmjs.org/package/w-ftp) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-ftp.svg)](https://www.jsdelivr.com/package/npm/w-ftp)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-ftp/global.html).

## Download behavior
`download` and `syncToLocal` (FTP and SFTP) never leave a partial file at the target:

* **Temp folder first.** Each file is written to the download temp folder as `<name>.<pid>.<random>.part` and moved to the target only after the transfer ended successfully **and** the local size equals the remote size. If anything fails (connection lost, timeout, size mismatch, the file cannot be moved) the temp file is removed, the promise rejects and the existing target file is left untouched (it is no longer deleted before the download). For FTP the remote size is taken from the `SIZE` command; if the server cannot report it, the download is rejected because completeness cannot be verified.
* **`fdDownloadTemp`** selects the temp folder: `WFtp({ fdDownloadTemp })` for the instance, `download(..., { fdDownloadTemp })` or `syncToLocal(..., { fdDownloadTemp })` for a single call (the single call wins). The default is `./_wftpDownloadTemp`, resolved against the cwd when the instance is created and created on first use. Put it on the same disk as the targets (the move is then one rename; across disks the file is copied next to the target first); do not put it inside the folder given to `syncToLocal`.
* **Move retry.** If renaming onto the target fails with `EPERM`, `EBUSY` or `EACCES` (e.g. antivirus scanning on Windows) it is retried up to 5 attempts in total; after that the temp file is removed and the promise rejects.
* **Crash residue.** Files in the temp folder that follow the naming above, were not updated for 24 hours, and belong to a process that no longer exists are removed (at most once an hour per folder per process).
* **`timeLimit`** (default `60000` ms) now also limits SFTP downloads. It is counted per file from the start of the transfer (the query of the remote file information is limited by the same value), so large files need a larger `timeLimit` (`0` and negative values are treated as unset and use the default). On timeout the promise rejects with `ftpDownload timeout[<timeLimit>]`, the temp file name is removed and the connection used by the download is destroyed (FTP also closes the data connection; for SFTP this is what stops `fastGet`). The next operation reconnects, so the same instance can retry right away.
* **SFTP `syncToLocal`** now forwards its 4th argument like FTP does, so `levelLimit`, `forceOverwriteWhenSync`, `fdDownloadTemp` and `onTrace` take effect. `syncToLocal` still stops at the first file that fails.
* **`onTrace`** (single call option of `download` and `syncToLocal`) receives frozen events `{ type, ... }` (`sweep`, `temp`, `timeout`, `transfer`, `verify`, `retry`, `move`, `reconnect`; see the JSDoc of `download`) for diagnostics and event-driven tests; errors it throws are ignored.

## Upload behavior
`upload` and `syncToRemote` (FTP and SFTP) never leave a partial file at the target and never destroy the old remote file before the new one is complete:

* **Temporary name first.** Each file is written next to the remote target as `<name>.<pid>.<random>.part` and renamed to the target only after the transfer ended successfully **and** the size of that remote file equals the local size (the local file must not change during the upload). If anything fails (connection lost, server error, timeout, size mismatch, rename refused) the temporary file is deleted (best effort; if it cannot be deleted the rejection message ends with `, can not remove the remote temporary file`) and the existing remote file is left untouched. FTP verifies with `SIZE`; if the server cannot report it, the upload is rejected.
* **Renaming over the old file.** SFTP uses the `posix-rename@openssh.com` extension (atomic overwrite) and falls back to a plain rename; FTP uses `RNFR`/`RNTO`. If the server's rename does not overwrite an existing file (some FTP servers, SFTP servers without the extension), the old file is first renamed to `<name>.<pid>.<random>.old`, the new file is renamed to the target and the old one is deleted. **This fallback is not atomic** (the target is missing between the two renames); if it fails midway the old file is renamed back.
* **Server permissions.** The server must allow renaming and deleting. A refused rename rejects with `ftpUpload: can not rename the temporary file to fpRemote (<code>), fpRemote is not changed`; if the new file is in place but the renamed old file cannot be deleted it rejects with `ftpUpload: fpRemote is updated, but can not remove the old file kept under a temporary name in the same folder`. Messages built by this package contain no paths and no server text.
* **`timeLimit`** now applies to uploads on both protocols (the SFTP upload timer used to be cleared immediately and FTP only rejected without stopping the transfer). Creating the folders, the transfer, the size check and the rename are each limited by `timeLimit`; give a larger value for large files. On timeout the connection used by the upload is destroyed (no data is sent afterwards), the instance reconnects with the same settings (FTP replays the successful `cwd` calls) to delete the temporary file, and the promise rejects with `ftpUploadCore timeout[<timeLimit>]` (during the rename: `... while renaming, fpRemote may or may not be updated`). Other operations running on the same instance at that moment fail too.
* **Streaming.** FTP now reads the local file as a stream instead of loading it into memory, and `upload` no longer changes the working directory (it used to `cwd` into the target folder and back to `/`). SFTP writes the file with parallel SFTP write requests instead of `fastPut`.
* **`syncToRemote`** processes files one by one and stops at the first file that fails (files already uploaded stay, the failed one keeps its old content). The SFTP version now forwards its 4th argument like FTP does (`levelLimit`, `forceOverwriteWhenSync`, `onTrace`).
* **`onTrace`** (4th argument of `upload`, option of `syncToRemote`) receives frozen events (`timeout`, `transfer`, `verify`, `temp`, `move`, `reconnect`; see the JSDoc of `upload`).
* **Limits.** Temporary files left by a crashed process or by a connection that could not be re-established are not cleaned up automatically. The permissions and owner of a replaced file are not preserved, and a target that is a symbolic link is replaced by the new file.

## Connection behavior
* **`conn`.** `conn()` resolves only when the connection is usable (FTP: the server greeting `220` was received; SFTP: connected and the SFTP channel is open) and is limited by `timeLimit`. A failure rejects with a fixed message (`ftpConn: can not connect to the server (<code>)` or `ftpConn timeout[<timeLimit>]`), never with an uncaught exception; `<code>` is a Node error code, an FTP reply code or `AUTHENTICATION`/`HANDSHAKE_TIMEOUT`/`CLOSED`/`UNKNOWN`. Operations called while `conn()` is still pending wait for it. After a failed `conn()` the instance is treated as not connected (`quit()` still resolves).
* **`timeLimit` covers every operation** (`conn`, `quit`, `ls`, `stat`, `isFile`, `isFolder`, `mkdir`, `cwd`, `pwd`, download, upload, listing during sync). On timeout the promise rejects (`<operation> timeout[<timeLimit>]`, FTP single commands `ftpRaw[<command>] timeout[<timeLimit>]`) and **the connection used by that call is destroyed**, so no data is sent or received afterwards; other operations running on the same connection fail too (`<operation>: the connection to the server is closed (TIMEOUT)`). The next operation reconnects with the same settings.
* **Connection lost.** An operation whose control connection closes before the reply rejects with `<operation>: the connection to the server is closed (<code>)`; nothing is silently re-sent on another connection. FTP: if the server closes the connection (e.g. idle timeout), the next operation reconnects and **replays the successful `cwd` calls** first; if they cannot be replayed (the folder is gone), it rejects with `<operation>: can not restore the working directory after reconnecting (<code>), please use 'conn' to construct FTP` and `conn()` is required again. SFTP: a connection closed by the server is not reconnected automatically (call `conn()` again); `upload` keeps cleaning up and reconnecting as before.
* **Working directory (`cwd`, `pwd`).** SFTP has no server-side working directory: `cwd(path)` now changes it on the client side (it resolves to the new absolute path and rejects if it is not an existing folder), and relative paths of every following operation are resolved against it; `pwd()` returns it. `conn()` resets it. For FTP `cwd` and `pwd` are unchanged server commands.
* **Paths.** Absolute paths stay absolute in `mkdir`, `upload` and `syncToRemote`, and `..`, names that start with `.` and names with spaces are used as given. `mkdir` creates the parent folders of the given **file path** (its last segment is treated as a file name).
* **`onTrace`** is also accepted as an option of `conn`, `quit`, `ls`, `stat`, `isFile`, `isFolder`, `mkdir`, `cwd` and `pwd` (and the listing phase of sync) and receives `connect`, `reconnect` and `timeout` events.

## Breaking changes
Next release after 1.0.80:

* FTP `conn()` now waits for the server and **rejects** when it cannot connect (it used to resolve immediately and a connection error then crashed the process). SFTP `conn()` rejects with the fixed message above instead of the library error object.
* Operations that never timed out now do (SFTP `ls`, `stat`, `isFile`, `isFolder`, `mkdir`, `cwd`, `pwd`); FTP `stat`, `isFile`, `isFolder` **reject** on timeout or lost connection instead of resolving `false`; a timeout destroys the connection used. SFTP download timeouts now stop the transfer (it used to continue in the background).
* A connection closed by the server no longer makes FTP silently run later commands in the login directory (see *Connection lost* above). `quit()` on a connection that is already closed resolves `'ok'` without opening a new one; SFTP `quit()` now waits for the connection to close and rejects with `ftpQuit timeout[<timeLimit>]` if the server does not close it.
* SFTP `cwd()` used to ignore its argument and resolve the login directory (files were then written to the login directory and reported as success); `pwd()` used to reject with a `TypeError`.
* Absolute paths and paths with `..` or names starting with `.` are no longer rewritten to relative or other paths by `mkdir`, `upload` (FTP) and `syncToRemote` (they used to create or write files somewhere else). `syncToRemote` with a folder written as `sub` or `sub/` no longer uploads unchanged files again on every run.
* The SFTP library no longer prints connection messages to the console.


## Installation

### Using npm(ES6 module):
```alias
npm i w-ftp
```

#### Example for FTP download:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-ftp/blob/master/g-ftp-download.mjs)]
```alias
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

```

#### Example for FTP upload:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-ftp/blob/master/g-ftp-upload.mjs)]
```alias
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

```

#### Example for SFTP download:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-ftp/blob/master/g-sftp-download.mjs)]
```alias
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
        transportation: 'SFTP',
        hostname: st.SFTP.hostname,
        port: st.SFTP.port,
        username: st.SFTP.username,
        password: st.SFTP.password,
    })
    // console.log('ftp', ftp)

    await ftp.conn()

    async function core() {

        let fps = await ftp.ls('./_test_download_srv')
        console.log('ftp.ls', fps[0], fps.length)

        r = await ftp.stat('./_test_download_srv/DECL_202108.csv')
        console.log('ftp.stat', r)

        r = await ftp.isFile('./_test_download_srv/DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFile('./_test_download_srv/test/DECL_20210805055044.csv')
        console.log('ftp.isFile', r)

        r = await ftp.isFolder('./_test_download_srv/DECL_20210805055044.csv')
        console.log('ftp.isFolder', r)

        r = await ftp.download('./_test_download_srv/DECL_20210805055044.csv', './_test_download_client/DECL_20210805055044.csv', (p) => {
            console.log('ftp.download p', p.name, p.progress)
        })
        console.log('ftp.download', r)

        r = await ftp.download('./_test_download_srv/test/DECL_202108.csv', './_test_download_client/test/DECL_202108.csv', (p) => {
            console.log('ftp.download p', p.name, p.progress)
        })
        console.log('ftp.download', r)

        r = await ftp.syncToLocal('./_test_download_srv', './_test_download_client', (p) => {
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
//   type: '-',
//   name: 'DECL_202108.csv',
//   size: 218690,
//   modifyTime: 1692347520000,
//   accessTime: 1692692553000,
//   rights: { user: 'rw', group: '***', other: '***' },
//   owner: 0,
//   group: 0,
//   longname: '-rw-******    1 -        -          218690 Aug 18 16:32 DECL_202108.csv',
//   atime: '2023-08-22T16:22:33+08:00',
//   mtime: '2023-08-18T16:32:00+08:00',
//   isFolder: false
// } 5
// ftp.stat {
//   mode: 33152,
//   uid: 0,
//   gid: 0,
//   size: 218690,
//   accessTime: 1692692553000,
//   modifyTime: 1692347520000,
//   isDirectory: false,
//   isFile: true,
//   isBlockDevice: false,
//   isCharacterDevice: false,
//   isSymbolicLink: false,
//   isFIFO: false,
//   isSocket: false,
//   atime: '2023-08-22T16:22:33+08:00',
//   mtime: '2023-08-18T16:32:00+08:00',
//   name: './_test_download_srv/DECL_202108.csv'
// }
// ftp.isFile true
// ftp.isFile true
// ftp.isFolder false
// ftp.download p DECL_20210805055044.csv 2.3660435777166757
// ftp.download p DECL_20210805055044.csv 4.7320871554333515
// ftp.download p DECL_20210805055044.csv 7.098130733150026
// ftp.download p DECL_20210805055044.csv 9.464174310866703
// ftp.download p DECL_20210805055044.csv 11.830217888583377
// ftp.download p DECL_20210805055044.csv 14.196261466300053
// ftp.download p DECL_20210805055044.csv 16.56230504401673
// ftp.download p DECL_20210805055044.csv 18.928348621733406
// ftp.download p DECL_20210805055044.csv 21.29439219945008
// ftp.download p DECL_20210805055044.csv 23.660435777166754
// ftp.download p DECL_20210805055044.csv 26.02647935488343
// ftp.download p DECL_20210805055044.csv 28.392522932600105
// ftp.download p DECL_20210805055044.csv 30.758566510316783
// ftp.download p DECL_20210805055044.csv 33.12461008803346
// ftp.download p DECL_20210805055044.csv 35.49065366575013
// ftp.download p DECL_20210805055044.csv 37.85669724346681
// ftp.download p DECL_20210805055044.csv 40.222740821183486
// ftp.download p DECL_20210805055044.csv 42.58878439890016
// ftp.download p DECL_20210805055044.csv 44.95482797661683
// ftp.download p DECL_20210805055044.csv 47.32087155433351
// ftp.download p DECL_20210805055044.csv 49.68691513205019
// ftp.download p DECL_20210805055044.csv 52.05295870976686
// ftp.download p DECL_20210805055044.csv 54.41900228748354
// ftp.download p DECL_20210805055044.csv 56.78504586520021
// ftp.download p DECL_20210805055044.csv 59.15108944291689
// ftp.download p DECL_20210805055044.csv 61.517133020633565
// ftp.download p DECL_20210805055044.csv 63.883176598350246
// ftp.download p DECL_20210805055044.csv 66.24922017606691
// ftp.download p DECL_20210805055044.csv 68.6152637537836
// ftp.download p DECL_20210805055044.csv 70.98130733150026
// ftp.download p DECL_20210805055044.csv 73.34735090921694
// ftp.download p DECL_20210805055044.csv 75.71339448693362
// ftp.download p DECL_20210805055044.csv 78.0794380646503
// ftp.download p DECL_20210805055044.csv 80.44548164236697
// ftp.download p DECL_20210805055044.csv 82.81152522008365
// ftp.download p DECL_20210805055044.csv 85.17756879780032
// ftp.download p DECL_20210805055044.csv 87.543612375517
// ftp.download p DECL_20210805055044.csv 89.90965595323367
// ftp.download p DECL_20210805055044.csv 92.27569953095035
// ftp.download p DECL_20210805055044.csv 94.64174310866701
// ftp.download p DECL_20210805055044.csv 97.0077866863837
// ftp.download p DECL_20210805055044.csv 99.37383026410038
// ftp.download p DECL_20210805055044.csv 100
// ftp.download ok
// ftp.download p DECL_202108.csv 14.983766976084869
// ftp.download p DECL_202108.csv 29.967533952169738
// ftp.download p DECL_202108.csv 44.951300928254604
// ftp.download p DECL_202108.csv 59.935067904339476
// ftp.download p DECL_202108.csv 74.91883488042434
// ftp.download p DECL_202108.csv 89.90260185650921
// ftp.download p DECL_202108.csv 100
// ftp.download ok
// ftp.syncToLocal p DECL_202108.csv 14.983766976084869
// ftp.syncToLocal p DECL_202108.csv 29.967533952169738
// ftp.syncToLocal p DECL_202108.csv 44.951300928254604
// ftp.syncToLocal p DECL_202108.csv 59.935067904339476
// ftp.syncToLocal p DECL_202108.csv 74.91883488042434
// ftp.syncToLocal p DECL_202108.csv 89.90260185650921
// ftp.syncToLocal p DECL_202108.csv 100
// ftp.syncToLocal p DECL_20210805055629.csv 2.354877308218858
// ftp.syncToLocal p DECL_20210805055629.csv 4.709754616437716
// ftp.syncToLocal p DECL_20210805055629.csv 7.064631924656574
// ftp.syncToLocal p DECL_20210805055629.csv 9.419509232875432
// ftp.syncToLocal p DECL_20210805055629.csv 11.774386541094291
// ftp.syncToLocal p DECL_20210805055629.csv 14.129263849313148
// ftp.syncToLocal p DECL_20210805055629.csv 16.484141157532008
// ftp.syncToLocal p DECL_20210805055629.csv 18.839018465750865
// ftp.syncToLocal p DECL_20210805055629.csv 21.19389577396972
// ftp.syncToLocal p DECL_20210805055629.csv 23.548773082188582
// ftp.syncToLocal p DECL_20210805055629.csv 25.90365039040744
// ftp.syncToLocal p DECL_20210805055629.csv 28.258527698626295
// ftp.syncToLocal p DECL_20210805055629.csv 30.613405006845156
// ftp.syncToLocal p DECL_20210805055629.csv 32.968282315064016
// ftp.syncToLocal p DECL_20210805055629.csv 35.323159623282876
// ftp.syncToLocal p DECL_20210805055629.csv 37.67803693150173
// ftp.syncToLocal p DECL_20210805055629.csv 40.03291423972059
// ftp.syncToLocal p DECL_20210805055629.csv 42.38779154793944
// ftp.syncToLocal p DECL_20210805055629.csv 44.7426688561583
// ftp.syncToLocal p DECL_20210805055629.csv 47.097546164377164
// ftp.syncToLocal p DECL_20210805055629.csv 49.45242347259602
// ftp.syncToLocal p DECL_20210805055629.csv 51.80730078081488
// ftp.syncToLocal p DECL_20210805055629.csv 54.162178089033745
// ftp.syncToLocal p DECL_20210805055629.csv 56.51705539725259
// ftp.syncToLocal p DECL_20210805055629.csv 58.87193270547145
// ftp.syncToLocal p DECL_20210805055629.csv 61.22681001369031
// ftp.syncToLocal p DECL_20210805055629.csv 63.58168732190917
// ftp.syncToLocal p DECL_20210805055629.csv 65.93656463012803
// ftp.syncToLocal p DECL_20210805055629.csv 68.29144193834689
// ftp.syncToLocal p DECL_20210805055629.csv 70.64631924656575
// ftp.syncToLocal p DECL_20210805055629.csv 73.0011965547846
// ftp.syncToLocal p DECL_20210805055629.csv 75.35607386300346
// ftp.syncToLocal p DECL_20210805055629.csv 77.71095117122232
// ftp.syncToLocal p DECL_20210805055629.csv 80.06582847944118
// ftp.syncToLocal p DECL_20210805055629.csv 82.42070578766003
// ftp.syncToLocal p DECL_20210805055629.csv 84.77558309587889
// ftp.syncToLocal p DECL_20210805055629.csv 87.13046040409776
// ftp.syncToLocal p DECL_20210805055629.csv 89.4853377123166
// ftp.syncToLocal p DECL_20210805055629.csv 91.84021502053547
// ftp.syncToLocal p DECL_20210805055629.csv 94.19509232875433
// ftp.syncToLocal p DECL_20210805055629.csv 96.54996963697319
// ftp.syncToLocal p DECL_20210805055629.csv 98.90484694519203
// ftp.syncToLocal p DECL_20210805055629.csv 100
// ftp.syncToLocal p DECL_202109.csv 15.269409456707628
// ftp.syncToLocal p DECL_202109.csv 30.538818913415255
// ftp.syncToLocal p DECL_202109.csv 45.808228370122876
// ftp.syncToLocal p DECL_202109.csv 61.07763782683051
// ftp.syncToLocal p DECL_202109.csv 76.34704728353813
// ftp.syncToLocal p DECL_202109.csv 91.61645674024575
// ftp.syncToLocal p DECL_202109.csv 100
// ftp.syncToLocal p DECL_20210805055044.csv 2.3660435777166757
// ftp.syncToLocal p DECL_20210805055044.csv 4.7320871554333515
// ftp.syncToLocal p DECL_20210805055044.csv 7.098130733150026
// ftp.syncToLocal p DECL_20210805055044.csv 9.464174310866703
// ftp.syncToLocal p DECL_20210805055044.csv 11.830217888583377
// ftp.syncToLocal p DECL_20210805055044.csv 14.196261466300053
// ftp.syncToLocal p DECL_20210805055044.csv 16.56230504401673
// ftp.syncToLocal p DECL_20210805055044.csv 18.928348621733406
// ftp.syncToLocal p DECL_20210805055044.csv 21.29439219945008
// ftp.syncToLocal p DECL_20210805055044.csv 23.660435777166754
// ftp.syncToLocal p DECL_20210805055044.csv 26.02647935488343
// ftp.syncToLocal p DECL_20210805055044.csv 28.392522932600105
// ftp.syncToLocal p DECL_20210805055044.csv 30.758566510316783
// ftp.syncToLocal p DECL_20210805055044.csv 33.12461008803346
// ftp.syncToLocal p DECL_20210805055044.csv 35.49065366575013
// ftp.syncToLocal p DECL_20210805055044.csv 37.85669724346681
// ftp.syncToLocal p DECL_20210805055044.csv 40.222740821183486
// ftp.syncToLocal p DECL_20210805055044.csv 42.58878439890016
// ftp.syncToLocal p DECL_20210805055044.csv 44.95482797661683
// ftp.syncToLocal p DECL_20210805055044.csv 47.32087155433351
// ftp.syncToLocal p DECL_20210805055044.csv 49.68691513205019
// ftp.syncToLocal p DECL_20210805055044.csv 52.05295870976686
// ftp.syncToLocal p DECL_20210805055044.csv 54.41900228748354
// ftp.syncToLocal p DECL_20210805055044.csv 56.78504586520021
// ftp.syncToLocal p DECL_20210805055044.csv 59.15108944291689
// ftp.syncToLocal p DECL_20210805055044.csv 61.517133020633565
// ftp.syncToLocal p DECL_20210805055044.csv 63.883176598350246
// ftp.syncToLocal p DECL_20210805055044.csv 66.24922017606691
// ftp.syncToLocal p DECL_20210805055044.csv 68.6152637537836
// ftp.syncToLocal p DECL_20210805055044.csv 70.98130733150026
// ftp.syncToLocal p DECL_20210805055044.csv 73.34735090921694
// ftp.syncToLocal p DECL_20210805055044.csv 75.71339448693362
// ftp.syncToLocal p DECL_20210805055044.csv 78.0794380646503
// ftp.syncToLocal p DECL_20210805055044.csv 80.44548164236697
// ftp.syncToLocal p DECL_20210805055044.csv 82.81152522008365
// ftp.syncToLocal p DECL_20210805055044.csv 85.17756879780032
// ftp.syncToLocal p DECL_20210805055044.csv 87.543612375517
// ftp.syncToLocal p DECL_20210805055044.csv 89.90965595323367
// ftp.syncToLocal p DECL_20210805055044.csv 92.27569953095035
// ftp.syncToLocal p DECL_20210805055044.csv 94.64174310866701
// ftp.syncToLocal p DECL_20210805055044.csv 97.0077866863837
// ftp.syncToLocal p DECL_20210805055044.csv 99.37383026410038
// ftp.syncToLocal p DECL_20210805055044.csv 100
// ftp.syncToLocal {
//   num: 4,
//   files: [
//     {
//       path: './_test_download_srv/DECL_202108.csv',
//       reason: 'no local file'
//     },
//     {
//       path: './_test_download_srv/DECL_20210805055629.csv',
//       reason: 'no local file'
//     },
//     {
//       path: './_test_download_srv/DECL_202109.csv',
//       reason: 'no local file'
//     },
//     {
//       path: './_test_download_srv/test/DECL_20210805055044.csv',
//       reason: 'no local file'
//     }
//   ]
// }
// ftp.quit ok

```

#### Example for SFTP upload:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-ftp/blob/master/g-sftp-upload.mjs)]
```alias
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

```
