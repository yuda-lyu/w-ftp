# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## 本機端檔案列舉之層數(wsemi 1.9.80 起之 `opt.levelLimit`)

需求出處:使用端(Gitea 項 492 與 wsemi 破壞性變更第 83 項).單一擁有者:`src/ftpTreeFilesInLocalAndRemote.mjs`(本機端列舉 wsemi `fsTreeFolder`、遠端端列舉 `src/ftpTreeFolder.mjs`);`ftpSyncToLocal`、`ftpSyncToRemote` 只轉交 `opt.levelLimit`.

| 規則 | 內容 | 站點全集與盤點 | 測試 |
|---|---|---|---|
| R-LV-01 本機端列舉之層數 | 本庫 `opt.levelLimit` 經 `ispint` 判定,非正整數視為不限層數(內部 `null`).呼叫 wsemi `fsTreeFolder` 時第 2 參數為 opt 物件(1.9.80 起,給數字拋 `invalid opt: must be an object`):不限層數(`null`)者**不給** `levelLimit`(未給即窮舉),有限層數者給 `{ levelLimit }`;不得給數字(含 `4294967295`),不得把不限層數轉成 `{ levelLimit: 1 }`.超出 wsemi 有效範圍之值(`Infinity`、`4294967296`、`1e10`、`'0x10'`)wsemi 視為未給而窮舉,本機端因此不限層數(與 JSDoc「非正整數視為不限層數」及遠端對 `Infinity` 之行為一致) | `git grep -nE "\b(fsTreeFolder\|fsTreeFolderWithHash\|fsGetFilesInFolder\|fsGetFilesWithHashInFolder\|fsGetFoldersInFolder)(Core)?\s*\(" -- . ':!dist' ':!docs'`(2026-11-26 全集:僅 `src/ftpTreeFilesInLocalAndRemote.mjs` 之 `fsTreeFolder(fdLocal, optLocal)` 1 處,`optLocal` 為 `{}` 或 `{ levelLimit }`;`g-*.mjs`、README、JSDoc、`test/` 皆 0 處) | `test/unit-ftp-tree-files-local.test.mjs`(各 `levelLimit` 輸入之本機列舉層數、邊界值、`ftpSyncToRemote`/`ftpSyncToLocal` 之本機端接線)、`test/api-ftp-sync-multilevel.test.mjs`(真實 `WFtp` 經假 FTP 伺服器之 3 層同步).變異(2026-11-26,鏡像根注入,跑上列兩檔,對照組 10 passing):本機端一律 `{ levelLimit: 1 }` → 9 案紅;一律 `{}` → 1 案紅(有限層數案);不限層數時退回 `{ levelLimit: 1 }` → 7 案紅;退回舊寫法(數字 `4294967295`)→ 10 案全紅;有限層數多給 1 層 → 1 案紅;邊界值改取 1 層(還原舊版行為)→ 1 案紅(邊界值案) |

## 下載(`download`、`syncToLocal`;FTP 與 SFTP)

需求出處:使用端(Gitea #214).單一擁有者:`src/downloadViaTemp.mjs`(暫存、計時、核對、移動、殘留清理、`onTrace` 事件);呼叫點:`src/CoreSFTP.mjs` 與 `src/CoreFTP.mjs` 之 `ftpDownload`.

| 規則 | 內容 | 站點全集與盤點 | 測試 |
|---|---|---|---|
| R-DL-01 先寫暫存、確定完成才移 | 各檔先寫入暫存區內本次專用之暫存檔,確定完成(傳輸成功結束且本地大小等於遠端大小)才移至目標;移動前目標之舊檔不動,不再於下載前刪除舊檔 | 站點:SFTP `ftpDownload`、FTP `ftpDownload`(皆已套;`git grep -n "downloadViaTemp(" -- src` 應為 2 處).刻意不套:上傳路徑(`ftpUpload`、`syncToRemote`,另案).判準:`git grep -n "fastGet\|createWriteStream" -- src` 之下載站點寫入者須為暫存檔(`fpTemp`) | `api-sftp-download-temp`、`api-ftp-download-temp`、`unit-download-via-temp` |
| R-DL-02 失敗一律 reject 且不留殘檔 | 傳輸失敗(含中斷)、逾時、大小不符、無法建立暫存檔、無法移動:刪除暫存檔並 reject,目標舊檔不動;FTP 取不到遠端大小(SIZE 失敗)即無從核對,預設拒絕(`can not get the size of file[...]`,不傳輸);目標為既有資料夾於傳輸前即 reject;訊息為固定詞彙,只帶觀測之大小與 Node 錯誤之 `code`,不帶路徑與傳入值 | 站點:`downloadViaTemp` 之各失敗分支(`onSettle`、`reserveTemp`) | 同上 |
| R-DL-03 `timeLimit` | 預設 60000 毫秒(`0` 與負數視為未給而用預設,因 `setTimeout` 會當作 1 毫秒使操作立即逾時;超過 2147483647 者以其為上限);每檔自傳輸開始起計;SFTP 查詢遠端檔案資訊(stat)階段另以同一值計時(`withTimeLimit`);到時 reject `ftpDownload timeout[<timeLimit>]`、呼叫中止函數(FTP 銷毀數據 socket;SFTP `fastGet` 無法中止)、先刪暫存檔名;其後背景傳輸結束只清不移;計時器於傳輸結束時清除;逾時後不再通知進度回呼 | 站點:SFTP stat、SFTP 傳輸、FTP 傳輸(FTP 之 stat 經 `ftpRaw` 已有計時,未改) | 上列三檔(逾時門檻以假時鐘驗證,預設值各一案) |
| R-DL-04 暫存區 | 選項 `fdDownloadTemp`:實例層級(`WFtp(opt)`)與單次(`download`、`syncToLocal` 之 opt,單次優先);只收不含 NUL 之非空字串,非預期改用實例或預設;預設 `./_wftpDownloadTemp`(建構時轉絕對路徑,首次使用時建立);暫存檔名 `<目標檔名>.<行程id>.<8碼隨機碼>.part`(目標檔名超過 150 位元組者基底以碼點截短,使整個名稱不超過 255),以 `'wx'` 排他建立,名稱已存在(EEXIST)換名重試至多 5 次,其他錯誤不重試 | 站點:`resolveFdTemp`(單一擁有者)、兩個 Core 之建構處、`ftpSyncToLocal` 之轉交 | 同上 |
| R-DL-05 崩潰殘留 | 只清暫存區內「逾 24 小時未更新、符合上列命名格式、行程 id 對應之行程已不存在」者(本行程必然存在,故不會清到自己之檔;不另設「非本行程」判斷,因其被「行程已不存在」涵蓋、為冗餘);同一行程對同一暫存區至多每小時清一次;暫存區不存在或任一檔處理失敗皆略過;目標同資料夾之跨磁碟暫存名不清 | 站點:`sweepStale` | `unit-download-via-temp`、兩個 api 檔之接線案 |
| R-DL-06 移動 | 同磁碟 `rename` 一步取代;`EXDEV` 時先複製至目標同資料夾之暫存名(`<目標>.<行程id>.<隨機碼>.part`)再 `rename`;`rename` 遇 `EPERM`/`EBUSY`/`EACCES` 有界重試(共 5 次嘗試,第 i 次失敗後等 200×i 毫秒),用盡即刪暫存並 reject;目標為資料夾直接 `EISDIR`、不重試 | 站點:`moveToTarget`、`renameRetry` | `unit-download-via-temp`、兩個 api 檔(替身 `fs.promises.rename`) |
| R-DL-07 opt 轉交 | SFTP 與 FTP 之 `syncToLocal(fdRemote, fdLocal, cbProcess, opt)` 皆轉交 opt;`ftpSyncToLocal` 把 `fdDownloadTemp`、`onTrace` 轉交各檔之 `ftpDownload` | 站點:`CoreSFTP.syncToLocal`、`CoreFTP.syncToLocal`、`ftpSyncToLocal`(上傳之 `syncToRemote` 不在此規則) | `api-sftp-download-temp`、`api-ftp-download-temp` 中以 `syncToLocal` 為題之案(`levelLimit`、`forceOverwriteWhenSync`、`fdDownloadTemp`、`onTrace` 轉交) |
| R-DL-08 `onTrace` | 依 dspec〈計時器相關函數之觀察回調與測試〉:單次 opt 之 `onTrace`(經 wsemi `getTrace`),事件 `sweep`、`temp`、`timeout`、`transfer`、`verify`、`retry`、`move`(欄位見 `WFtp.mjs` 之 `download` JSDoc);同步、凍結、回調拋錯與 rejection 忽略、未給時不組事件;測試以事件同步,不以延時 | 站點:`downloadViaTemp`、`withTimeLimit` | 同上 |

已知限制(不修):遠端之檔本身為半截(遠端回報之大小即半截)時擋不住;FTP 於伺服器回 150 之前逾時時尚無數據連線可銷毀,控制連線仍等該指令之回覆,同一實例之後續指令排在其後,須 `quit` 再 `conn`;SFTP `fastGet` 逾時後無法中止,quit 斷線後背景傳輸可能不再結束(暫存檔名已於逾時時刪除,若本地檔於逾時後才被重新開啟則殘檔由 R-DL-05 於 24 小時後清);`syncToLocal` 遇第一個失敗即停,已下載者保留;跨磁碟之實機驗證須暫存區與目標位於不同磁碟(本機單碟時略過,`EXDEV` 以替身驗證).

測試指令:`npx mocha --no-parallel test/unit-download-via-temp.test.mjs test/api-sftp-download-temp.test.mjs test/api-ftp-download-temp.test.mjs --timeout 180000`;全套 `npm test`.
