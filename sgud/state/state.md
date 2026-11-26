# w-ftp 狀態(現況)

> 只記現況,不寫過程.本檔於 2026-11-17 建立,目前只記錄已盤點之項目,其餘功能現況尚未整理.

## 本機端檔案列舉之層數限制(`levelLimit`)

- **現況**:`ftpSyncToLocal`、`ftpSyncToRemote` 之 `opt.levelLimit` 非正整數(`ispint` 判定為否)時視為不限層數(內部以 `null` 表示),經 `ftpTreeFilesInLocalAndRemote` 分兩端列舉:
  - 遠端:`ftpTreeFolder` 自行遞迴,`null` 為不限(`src/ftpTreeFolder.mjs`),未經 wsemi.
  - 本機:呼叫 wsemi `fsTreeFolder`.wsemi 1.9.63 起該函數之 `levelLimit` 給 `null` 改取預設 1(只列第 1 層),不限層數須給大有限值 `4294967295`;故於呼叫處把 `null` 轉為 `4294967295`(`src/ftpTreeFilesInLocalAndRemote.mjs` 之 `levelLimitLocal`).此寫法於 wsemi 1.9.62 與 1.9.63 皆為不限層數.
- **測試**:`test/unit-ftp-tree-files-local.test.mjs`(本機列舉之各 `levelLimit` 輸入、`ftpSyncToRemote`／`ftpSyncToLocal` 之本機端接線,遠端以替身)、`test/api-ftp-sync-multilevel.test.mjs`(真實 `WFtp` 經假 FTP 伺服器之 3 層同步與再同步無差異).
- **已知缺口(未修,待輸入檢測盤點)**:`ispint` 對 `Infinity`、大於 `4294967295` 之數、字串 `'0x10'` 皆回 `true`,此類值經 `levelLimit` 傳給 wsemi `fsTreeFolder` 時被視為非預期而取預設 1(本機端只列第 1 層),而遠端列舉對 `Infinity` 為不限,兩端不一致.詳見 `sgud/feedback/feedback.md`.
- **最近一次驗證**:wsemi 1.9.63、全套 24 案通過(2026-11-17).

## 下載(`download`、`syncToLocal`;FTP 與 SFTP)

- **現況**:規則 R-DL-01～R-DL-08 皆已實作(見 `sgud/rule/rulebook.md`;需求出處:使用端 Gitea #214):先寫暫存區、傳輸成功且大小相符才移至目標、失敗保留舊檔;SFTP 之 `timeLimit` 生效(含 stat 階段),FTP 逾時銷毀數據 socket;SFTP 之 `syncToLocal` 轉交 opt;`opt.onTrace` 事件;暫存區崩潰殘留清理;移動遇占用有界重試.預設 `timeLimit` 仍為 60000 毫秒、預設暫存區 `./_wftpDownloadTemp`.
- **測試**:`test/unit-download-via-temp.test.mjs`(共用流程之單元測試,傳輸以替身、逾時與重試間隔以假時鐘)、`test/api-sftp-download-temp.test.mjs`、`test/api-ftp-download-temp.test.mjs`(真實 `WFtp` 經假伺服器之接線案);夾具 `test/lib/dlTestKit.mjs`、`fakeSftpServer`(`hooks.READ`、`OPEN`、`STAT`、`statSize`)、`fakeFtpServer`(`hooks.RETR`).
- **已知缺口**:上傳路徑(`ftpUpload`、`syncToRemote`)未改,仍直接寫入遠端目標、SFTP 上傳之計時器於啟動後立即清除而不逾時、SFTP 之 `syncToRemote` 未轉交 opt(另案);跨磁碟之實機驗證須兩磁碟(本機單碟時該案略過);`syncToLocal` 遇第一個失敗即停(語意不改).
- **最近一次驗證**:2026-11-26(本機 Windows、Node 24.22、wsemi 1.9.78):全套 93 案(24 既有＋69 新)92 通過、1 略過(實機跨磁碟案,本機單碟);發布包解開之目錄(wsemi 1.9.79)同為 92 通過、1 略過;新測試三檔連跑 20 次皆通過.
