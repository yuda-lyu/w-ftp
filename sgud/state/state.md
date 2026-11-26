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

- **現況**:規則 R-DL-01～R-DL-08 皆已實作(見 `sgud/rule/rulebook.md`;需求出處:使用端 Gitea #214):先寫暫存區、傳輸成功且大小相符才移至目標、失敗保留舊檔;SFTP 之 `timeLimit` 生效(含 stat 階段),FTP 逾時銷毀數據 socket;SFTP 之 `syncToLocal` 轉交 opt;`opt.onTrace` 事件;暫存區崩潰殘留清理;移動遇占用有界重試.預設 `timeLimit` 仍為 60000 毫秒、預設暫存區 `./_wftpDownloadTemp`.
- **測試**:`test/unit-download-via-temp.test.mjs`(共用流程之單元測試,傳輸以替身、逾時與重試間隔以假時鐘)、`test/api-sftp-download-temp.test.mjs`、`test/api-ftp-download-temp.test.mjs`(真實 `WFtp` 經假伺服器之接線案);夾具 `test/lib/dlTestKit.mjs`、`fakeSftpServer`(`hooks.READ`、`OPEN`、`STAT`、`statSize`)、`fakeFtpServer`(`hooks.RETR`).
- **已知缺口**:上傳路徑(`ftpUpload`、`syncToRemote`)未改,仍直接寫入遠端目標、SFTP 上傳之計時器於啟動後立即清除而不逾時、SFTP 之 `syncToRemote` 未轉交 opt(另案);跨磁碟之實機驗證須兩磁碟(本機單碟時該案略過);`syncToLocal` 遇第一個失敗即停(語意不改).
- **最近一次驗證**:2026-11-26(本機 Windows、Node 24.22、wsemi 1.9.78):全套 93 案(24 既有＋69 新)92 通過、1 略過(實機跨磁碟案,本機單碟);發布包解開之目錄(wsemi 1.9.79)同為 92 通過、1 略過;新測試三檔連跑 20 次皆通過.

## 單次呼叫 opt 之讀取(`getOptReader`)

- **現況**:規則 R-OPT-01 已實作(見 `sgud/rule/rulebook.md`;依賴 wsemi 1.9.82 以上):`src/downloadViaTemp.mjs` 讀單次呼叫 opt 之 `onTrace`、`fdDownloadTemp` 一律經 wsemi `getOptReader('w-ftp downloadViaTemp', optCall).read(鍵)`,原自寫之 `readKey` 已刪;opt 之對外語意(讀取拋錯與非物件視為未給)不變,本庫無 `opt.debug` 警告出口與 `funLog` 差異.
- **測試**:`test/unit-download-via-temp.test.mjs` 之 `opt讀取(經wsemi getOptReader, 規則R-OPT-01)`(單鍵讀取拋錯、非物件 opt、函數型 opt、接線〔讀 `opt.debug` 且只讀三鍵〕、src 不自寫讀取器之掃描).
- **已知缺口**:`CoreFTP`、`CoreSFTP` 建構時以 lodash `get(opt, 鍵)` 讀 WFtp 設定(讀取拋錯之 Proxy 會使建構拋錯),屬建構設定而非單次呼叫 opt,未改.
- **最近一次驗證**:2026-11-27(本機 Windows、wsemi 1.9.82):全套 100 案,99 通過、1 略過(實機跨磁碟案,本機單碟);新增 6 案;修前鏡像 28 通過、2 失敗(接線案與掃描案);接線變異 8 項全被殺.
