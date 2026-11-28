# w-ftp 狀態(現況)

> 只記現況,不寫過程.本檔於 2026-11-17 建立,目前只記錄已盤點之項目,其餘功能現況尚未整理.

## 本機端檔案列舉之層數限制(`levelLimit`)

- **現況**:`ftpSyncToLocal`、`ftpSyncToRemote` 之 `opt.levelLimit` 非正整數(`ispint` 判定為否)時視為不限層數(內部以 `null` 表示),經 `ftpTreeFilesInLocalAndRemote` 分兩端列舉:
  - 遠端:`ftpTreeFolder` 自行遞迴,`null` 為不限(`src/ftpTreeFolder.mjs`),未經 wsemi.
  - 本機:呼叫 wsemi `fsTreeFolder`.wsemi 1.9.80 起該函數之第 2 參數為 opt 物件,未給 `opt.levelLimit` 即窮舉全部層級,給數字拋錯;故不限層數(`null`)時傳 `{}`、有限層數時傳 `{ levelLimit }`(`src/ftpTreeFilesInLocalAndRemote.mjs` 之 `optLocal`,規則 R-LV-01).
- **測試**:`test/unit-ftp-tree-files-local.test.mjs`(本機列舉之各 `levelLimit` 輸入與邊界值、`ftpSyncToRemote`／`ftpSyncToLocal` 之本機端接線,遠端以替身)、`test/api-ftp-sync-multilevel.test.mjs`(真實 `WFtp` 經假 FTP 伺服器之 3 層同步與再同步無差異).
- **超出 wsemi 有效範圍之 `levelLimit`**(`Infinity`、大於 `4294967295` 之數、字串 `'0x10'`;`ispint` 皆回 `true`):wsemi 1.9.80 起視為未給而窮舉,本機端不限層數,遠端對 `Infinity` 與極大值亦實質不限,兩端一致(舊版取 1 層而不一致之缺口已因此消失,見 `sgud/feedback/feedback.md` 第 1 列之承接列).`'0x10'` 遠端以 `level <= '0x10'` 比較而限 16 層,與本機不限層數仍有差異,屬極端輸入,未另處理.
- **最近一次驗證**:2026-11-26(本機 Windows、wsemi 1.9.80):全套 94 案,93 通過、1 略過.

## 下載(`download`、`syncToLocal`;FTP 與 SFTP)

- **現況**:規則 R-DL-01～R-DL-08 皆已實作(見 `sgud/rule/rulebook.md`;需求出處:使用端 Gitea #214):先寫暫存區、傳輸成功且大小相符才移至目標、失敗保留舊檔;`timeLimit` 生效(兩協定含 stat 階段),逾時銷毀本次所用之連線、下一個操作自動重新連線;SFTP 之 `syncToLocal` 轉交 opt;`opt.onTrace` 事件;暫存區崩潰殘留清理;移動遇占用有界重試.預設 `timeLimit` 仍為 60000 毫秒、預設暫存區 `./_wftpDownloadTemp`.
- **測試**:`test/unit-download-via-temp.test.mjs`(共用流程之單元測試,傳輸以替身、逾時與重試間隔以假時鐘)、`test/api-sftp-download-temp.test.mjs`、`test/api-ftp-download-temp.test.mjs`(真實 `WFtp` 經假伺服器之接線案);夾具 `test/lib/dlTestKit.mjs`、`fakeSftpServer`(`hooks.READ`、`OPEN`、`STAT`、`statSize`)、`fakeFtpServer`(`hooks.RETR`).
- **已知缺口**:跨磁碟之實機驗證須兩磁碟(本機單碟時該案略過);`syncToLocal` 遇第一個失敗即停(語意不改).
- **最近一次驗證**:見下節〈連線生命週期〉.

## 上傳(`upload`、`syncToRemote`;FTP 與 SFTP)

- **現況**:規則 R-UL-01～R-UL-08 皆已實作(見 `sgud/rule/rulebook.md`;需求出處:使用端 Gitea #214 §4 第 6 項):遠端同資料夾暫存名、大小核對後改名(SFTP posix-rename,不支援或被拒時退回 rename 與非原子交換)、失敗刪暫存且舊目標不動、各階段 `timeLimit` 到時銷毀連線並重連清理(重新連線改經 `connKeeper`)、FTP 串流讀本機檔且不再改變工作目錄、SFTP 改自寫並行寫入(不用 `fastPut`)、SFTP `syncToRemote` 轉交 opt、`upload` 第 4 參數 `onTrace`.
- **測試**:`test/unit-upload-via-temp.test.mjs`(共用流程,傳輸端替身、逾時以假時鐘)、`test/api-sftp-upload-temp.test.mjs`、`test/api-ftp-upload-temp.test.mjs`(真實 `WFtp` 經假伺服器)、`test/api-upload-stall-exit.test.mjs`(逾時後子行程自行退出);夾具 `test/lib/ulTestKit.mjs`、`clientUploadFlow.mjs`、`fakeSftpServer`(寫入、改名、posix-rename 擴充、`hooks.WRITE/RENAME/REMOVE/AUTH`)、`fakeFtpServer`(逐段寫入之 STOR、RNFR/RNTO/DELE、`hooks.STOR/CMD`、`renameOverwrite`).
- **已知缺口**:崩潰或無法重連之遠端暫存名不自動清理;目標權限與符號連結不保留;FTP 之 `SIZE` 不支援者上傳一律失敗;真實 FTP 伺服器未實測(本機只有假伺服器;SFTP 於第 658 項另以 Git 內附之 OpenSSH `sftp-server` 實測 8 情境,第 708 項之連線生命週期僅以假伺服器驗證).
- **最近一次驗證**:2026-11-28(本機 Windows、Node 24.22、wsemi 1.9.83):全套 203 案,202 通過、1 略過(實機跨磁碟案,本機單碟);上傳四檔(103 案)連跑 10 次皆通過;變異 47 項全殺;建置冒煙(輸出至暫存)之 UMD 兩協定上傳成功;尚未發布.

## 連線生命週期、逾時、重新連線與路徑(FTP 與 SFTP)

- **現況**:規則 R-CN-01～R-CN-06 皆已實作(見 `sgud/rule/rulebook.md`;排程第 708 項,尚未發布):`conn` 就緒才 resolve 且連線錯誤以固定訊息 reject(不中止行程);所有公開操作之 `timeLimit` 生效且到時銷毀本次所用之連線;FTP 停用 jsftp 隱式重連、重新連線時重放 `cwd`(無法重放即須重新 `conn`);SFTP `cwd`/`pwd` 可用(由本套件保存工作資料夾);`mkdir`、`upload`、`syncToRemote` 之絕對路徑與含 `..`、`.` 起首名稱之路徑寫到正確位置;`conn` 等公開操作接受 `opt.onTrace`(`connect`、`reconnect`、`timeout`).
- **測試**:`test/api-ftp-conn.test.mjs`、`test/api-sftp-conn.test.mjs`、`test/api-conn-exit.test.mjs`(子行程:不中止、可退出)、`test/unit-conn-keeper.test.mjs`、`test/unit-sep-tree-folders.test.mjs`;夾具 `test/lib/connTestKit.mjs`、`clientConnFlow.mjs`、`fakeFtpServer`(`home`、`greeting`、`keepData`、`dropControls`、`hooks.GREET/CMD`,CWD/MKD/PWD 比照真實伺服器)、`fakeSftpServer`(`home`、`dropClients`、`hooks.OPENDIR/READDIR/REALPATH/MKDIR/AUTH`).
- **已知缺口**:含換行或結尾空白之 FTP 路徑受 jsftp 指令串接影響(改版前即如此);FTP `STAT` 列表含 `.`、`..` 之伺服器於同步列舉行為未改;`conn` 重複呼叫時前一條存活之連線不關閉(改版前即如此);下載之 `cbProcess` 拋錯仍中止行程(改版前即如此,上傳有保護);`syncToRemote` 之遠端資料夾須已存在;真實 FTP／SFTP 伺服器未實測.
- **下游**:下游自有套件之測試(沙箱複本,指向本庫改前與改後之 `src`)結果相同(87 通過、3 失敗,3 案改前即敗,與本庫改動無關).
- **最近一次驗證**:2026-11-28(本機 Windows、Node 24.22、wsemi 1.9.83):全套 308 案,307 通過、1 略過(實機跨磁碟案,本機單碟);連線、下載、上傳相關測試檔連跑 8 輪(定稿碼,各 217 通過、1 略過)與先前 12 輪皆無失敗;變異 62 項殺 61;`.jsdoc` 實跑無 ERROR;eslint 0;建置冒煙(輸出至暫存)之 UMD 兩協定 conn、cwd、上傳、下載、連不上皆如預期;尚未發布.

## 單次呼叫 opt 之讀取(`getOptReader`)

- **現況**:規則 R-OPT-01 已實作(見 `sgud/rule/rulebook.md`;依賴 wsemi 1.9.82 以上):`src/downloadViaTemp.mjs` 讀單次呼叫 opt 之 `onTrace`、`fdDownloadTemp` 一律經 wsemi `getOptReader('w-ftp downloadViaTemp', optCall).read(鍵)`,原自寫之 `readKey` 已刪;opt 之對外語意(讀取拋錯與非物件視為未給)不變,本庫無 `opt.debug` 警告出口與 `funLog` 差異.
- **測試**:`test/unit-download-via-temp.test.mjs` 之 `opt讀取(經wsemi getOptReader, 規則R-OPT-01)`(單鍵讀取拋錯、非物件 opt、函數型 opt、接線〔讀 `opt.debug` 且只讀三鍵〕、src 不自寫讀取器之掃描).
- **已知缺口**:`CoreFTP`、`CoreSFTP` 建構時以 lodash `get(opt, 鍵)` 讀 WFtp 設定(讀取拋錯之 Proxy 會使建構拋錯),屬建構設定而非單次呼叫 opt,未改.
- **最近一次驗證**:2026-11-27(本機 Windows、wsemi 1.9.82):全套 100 案,99 通過、1 略過(實機跨磁碟案,本機單碟);新增 6 案;修前鏡像 28 通過、2 失敗(接線案與掃描案);接線變異 8 項全被殺.
