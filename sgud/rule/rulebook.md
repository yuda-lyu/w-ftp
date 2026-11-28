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
| R-DL-01 先寫暫存、確定完成才移 | 各檔先寫入暫存區內本次專用之暫存檔,確定完成(傳輸成功結束且本地大小等於遠端大小)才移至目標;移動前目標之舊檔不動,不再於下載前刪除舊檔 | 站點:SFTP `ftpDownload`、FTP `ftpDownload`(皆已套;`git grep -n "downloadViaTemp(" -- src` 應為 2 處).上傳路徑之對應規則為 R-UL-01.判準:`git grep -n "fastGet\|createWriteStream" -- src` 之下載站點寫入者須為暫存檔(`fpTemp`) | `api-sftp-download-temp`、`api-ftp-download-temp`、`unit-download-via-temp` |
| R-DL-02 失敗一律 reject 且不留殘檔 | 傳輸失敗(含中斷)、逾時、大小不符、無法建立暫存檔、無法移動:刪除暫存檔並 reject,目標舊檔不動;FTP 取不到遠端大小(SIZE 失敗)即無從核對,預設拒絕(`can not get the size of file[...]`,不傳輸);目標為既有資料夾於傳輸前即 reject;訊息為固定詞彙,只帶觀測之大小與 Node 錯誤之 `code`,不帶路徑與傳入值 | 站點:`downloadViaTemp` 之各失敗分支(`onSettle`、`reserveTemp`) | 同上 |
| R-DL-03 `timeLimit` | 預設 60000 毫秒(`0` 與負數視為未給而用預設,因 `setTimeout` 會當作 1 毫秒使操作立即逾時;超過 2147483647 者以其為上限);每檔自傳輸開始起計;查詢遠端檔案資訊(stat)階段(兩協定)另以同一值計時(`withTimeLimit`,onTimeout 銷毀連線);到時 reject `ftpDownload timeout[<timeLimit>]`、中止傳輸(銷毀本次所用之連線,FTP 含數據 socket;SFTP 之 `fastGet` 無中止介面,靠銷毀連線使其停止,傳輸之 promise 由連線死亡事件結束)、先刪暫存檔名;傳輸結束只清不移;計時器於傳輸結束時清除;逾時後不再通知進度回呼 | 站點:兩協定 stat 階段、傳輸階段(`ctl.setAbort`) | 上列三檔與 `api-ftp-conn`、`api-sftp-conn`(逾時門檻以假時鐘驗證,預設值各一案) |
| R-DL-04 暫存區 | 選項 `fdDownloadTemp`:實例層級(`WFtp(opt)`)與單次(`download`、`syncToLocal` 之 opt,單次優先);只收不含 NUL 之非空字串,非預期改用實例或預設;預設 `./_wftpDownloadTemp`(建構時轉絕對路徑,首次使用時建立);暫存檔名 `<目標檔名>.<行程id>.<8碼隨機碼>.part`(目標檔名超過 150 位元組者基底以碼點截短,使整個名稱不超過 255),以 `'wx'` 排他建立,名稱已存在(EEXIST)換名重試至多 5 次,其他錯誤不重試 | 站點:`resolveFdTemp`(單一擁有者)、兩個 Core 之建構處、`ftpSyncToLocal` 之轉交 | 同上 |
| R-DL-05 崩潰殘留 | 只清暫存區內「逾 24 小時未更新、符合上列命名格式、行程 id 對應之行程已不存在」者(本行程必然存在,故不會清到自己之檔;不另設「非本行程」判斷,因其被「行程已不存在」涵蓋、為冗餘);同一行程對同一暫存區至多每小時清一次;暫存區不存在或任一檔處理失敗皆略過;目標同資料夾之跨磁碟暫存名不清 | 站點:`sweepStale` | `unit-download-via-temp`、兩個 api 檔之接線案 |
| R-DL-06 移動 | 同磁碟 `rename` 一步取代;`EXDEV` 時先複製至目標同資料夾之暫存名(`<目標>.<行程id>.<隨機碼>.part`)再 `rename`;`rename` 遇 `EPERM`/`EBUSY`/`EACCES` 有界重試(共 5 次嘗試,第 i 次失敗後等 200×i 毫秒),用盡即刪暫存並 reject;目標為資料夾直接 `EISDIR`、不重試 | 站點:`moveToTarget`、`renameRetry` | `unit-download-via-temp`、兩個 api 檔(替身 `fs.promises.rename`) |
| R-DL-07 opt 轉交 | SFTP 與 FTP 之 `syncToLocal(fdRemote, fdLocal, cbProcess, opt)` 皆轉交 opt;`ftpSyncToLocal` 把 `fdDownloadTemp`、`onTrace` 轉交各檔之 `ftpDownload` | 站點:`CoreSFTP.syncToLocal`、`CoreFTP.syncToLocal`、`ftpSyncToLocal`(上傳之 `syncToRemote` 見 R-UL-07) | `api-sftp-download-temp`、`api-ftp-download-temp` 中以 `syncToLocal` 為題之案(`levelLimit`、`forceOverwriteWhenSync`、`fdDownloadTemp`、`onTrace` 轉交) |
| R-DL-08 `onTrace` | 依 dspec〈計時器相關函數之觀察回調與測試〉:單次 opt 之 `onTrace`(經 wsemi `getTrace`),事件 `sweep`、`temp`、`timeout`、`transfer`、`verify`、`retry`、`move`(欄位見 `WFtp.mjs` 之 `download` JSDoc);同步、凍結、回調拋錯與 rejection 忽略、未給時不組事件;測試以事件同步,不以延時 | 站點:`downloadViaTemp`、`withTimeLimit` | 同上 |

已知限制(不修):遠端之檔本身為半截(遠端回報之大小即半截)時擋不住;逾時銷毀連線會一併中斷同一實例併發中之其他操作;SFTP 之 `fastGet` 於連線銷毀後其 promise 可能永不結束(本套件不等它),本機暫存檔名已於逾時時刪除;`syncToLocal` 遇第一個失敗即停,已下載者保留;跨磁碟之實機驗證須暫存區與目標位於不同磁碟(本機單碟時略過,`EXDEV` 以替身驗證).

測試指令:`npx mocha --no-parallel test/unit-download-via-temp.test.mjs test/api-sftp-download-temp.test.mjs test/api-ftp-download-temp.test.mjs --timeout 180000`;全套 `npm test`.

## 上傳(`upload`、`syncToRemote`;FTP 與 SFTP)

需求出處:使用端(Gitea #214 §4 第 6 項).單一擁有者:`src/uploadViaTemp.mjs`(暫存名、各階段計時、核對、改名與退路、清理、`onTrace` 事件);傳輸端操作(adapter):`src/CoreSFTP.mjs` 與 `src/CoreFTP.mjs` 之 `genUploadAdapter`.

| 規則 | 內容 | 站點全集與盤點 | 測試 |
|---|---|---|---|
| R-UL-01 先寫遠端暫存名、核對完成才改名 | 寫入目標同資料夾之 `<檔名>.<行程id>.<8碼隨機碼>.part`(每次嘗試不同名;檔名基底超過 150 位元組以碼點截短,同下載);傳輸成功、遠端暫存大小等於本機大小且本機大小未改變才改名;不得直接寫入目標;`fpRemote` 檔名部分為空、`.`、`..` 者拒絕且不送任何遠端指令 | `git grep -n "uploadViaTemp(" -- src` 應為 2 處呼叫(兩個 Core)加 1 處定義;`git grep -nE "fastPut\(\|(Ftp\|conn\|client)\.put\(\|readFileSync\(fpLocal" -- src` 應為 0 處(`uploadViaTemp` 之 `adapter.put` 為傳輸端操作名,不在此列) | `unit-upload-via-temp`、`api-sftp-upload-temp`、`api-ftp-upload-temp` |
| R-UL-02 失敗刪暫存、舊目標不動、訊息固定 | 傳輸失敗、逾時、大小不符、本機改變、查不到大小、改名失敗皆刪遠端暫存(連線層級錯誤時重新連線再試一次);刪不掉(伺服器拒絕、使用者已 quit、重新連線失敗)訊息加後綴 `, can not remove the remote temporary file`,`onTrace` 之 `temp`(`ok:false`);本套件自組之訊息只帶觀測之大小與 `code`,不帶路徑與伺服器訊息;只有「傳輸本身失敗且暫存已清」沿用原錯誤;任何失敗於 reject 前呼叫 `reconnect`(未中止者不做事) | `uploadViaTemp` 之 `core`、`cleanup`、`removeRemote`、`failWithCleanup` | 同上 |
| R-UL-03 改名覆蓋與交換退路 | 順序:`posixRename`(SFTP 於伺服器宣告 `posix-rename@openssh.com` 時)→ `rename` → 目標為既有檔案時交換(舊檔改 `.old` 暫名 → 暫存改目標 → 刪舊暫名,非原子);只有伺服器回應之拒絕(code 為數字)才退回下一方式,連線層級錯誤不退回(結果不明);資料夾目標不得搬走(FTP 以 MLST `type=file;` 判斷,不支援 MLST 才用 SIZE);交換中途失敗之還原:目標不存在即改回舊檔;目標存在時僅在「舊檔已搬走、非伺服器回應之錯誤、目標大小等於本次上傳」才刪舊暫名,否則保留並於訊息寫明;連線層級錯誤或逾時重新連線後再試一次;舊暫名刪不掉者 reject「fpRemote is updated, but …」(不得靜默留暫名而回成功) | `replace`、`restoreStep`、`restoreSwap`、`failRename` | 同上 |
| R-UL-04 `timeLimit` 與中止 | 預設同下載;prepare(建資料夾)、transfer、verify、rename 各以 `timeLimit` 計時;到時銷毀本次所用之連線(FTP 含數據 socket;不再送出資料)、經連線保管者重新連線(R-CN-04;使用者已 quit 或已另行 conn 者不覆蓋;FTP 重放成功之 `cwd`,絕對路徑 `cwd` 重置重放清單;重放失敗(含重放中被中止)即清空連線須重新 `conn`;尚未連上即被中止或連不上者保留舊連線供下一個操作再試)、清理、reject `ftpUploadCore timeout[T]`(改名階段加 `while renaming, fpRemote may or may not be updated`);清理、還原、重新連線各步以 `min(T, 10000)` 為限 | `uploadViaTemp` 之 `stage`;兩 Core 之 `abort`、`reconnect` | `unit-upload-via-temp`(假時鐘)、兩個 api 檔、`api-upload-stall-exit`(逾時後子行程可自行退出) |
| R-UL-05 FTP 傳輸 | 串流讀本機檔(不整檔讀入);用 jsftp `getPutSocket` 加 PassThrough 類串流(jsftp `put(stream)` 之 `'readable'` 監聽使串流停住);以控制連線之最終回應判定成敗(jsftp 於數據 socket 關閉即回呼,早於最終回應);併發指令之回應不得當作本次結果(佇列首為他指令時只認 `226/425/426/451/452/551/552`);控制連線於指令中關閉或出錯即結束並銷毀該連線;重新連線之連線須掛 `'error'` 監聽;上傳不改變工作目錄 | `putStream`、`watchClose`、`sendOn`、`dropConn` | `api-ftp-upload-temp`、`api-upload-stall-exit` |
| R-UL-06 SFTP 傳輸 | 不用 `fastPut`(本機檔傳輸中被截短時 `fastXfer` 無限迴圈;連線關閉時不回呼),以 ssh2 `open`/`write`/`close` 並行寫入(未回應至多 64 個、塊 32 KiB);連線關閉即結束;建資料夾經 `sftpMkdirp`(見 R-CN-06) | `sftpPutFile`、`genUploadAdapter.prepare` | `api-sftp-upload-temp`(含並行上限、傳輸中改短、無待回應寫入時斷線、多層資料夾) |
| R-UL-07 `syncToRemote` | 逐檔依序,第一個失敗即 reject(其後不上傳、已上傳者保留、失敗之檔維持舊檔),回傳 `{ num, files }`;SFTP 與 FTP 皆轉交 opt,`ftpSyncToRemote` 把 `onTrace` 轉交各檔與列舉階段;遠端與本機推得之路徑以 `path.posix.normalize` 正規化後比對(`fdRemote` 寫 `sub`、`sub/`、`./sub` 皆認得同一檔);遠端資料夾須已存在(沿用原版) | `CoreSFTP.syncToRemote`、`CoreFTP.syncToRemote`、`ftpSyncToRemote` | 兩個 api 檔之 `syncToRemote` 案、`api-ftp-sync-multilevel`、`api-ftp-conn`、`api-sftp-conn` |
| R-UL-08 `onTrace` | `upload` 第 4 參數(經 R-OPT-01 之讀取路徑 `downloadViaTemp.traceOf`),事件 `timeout`、`transfer`、`verify`、`temp`、`move`、`reconnect`(欄位見 `WFtp.mjs` 之 `upload` JSDoc) | `uploadViaTemp`、兩 Core 之 `reconnect` | 三個上傳測試檔 |

已知限制(不修,另見 README):行程崩潰或無法重新連線而殘留之遠端暫存名不自動清理;交換退路非原子;目標既有檔之權限與擁有者不保留,符號連結目標被新檔取代;上傳逾時銷毀連線會一併中斷同一實例併發中之其他操作;FTP 不支援 `SIZE` 之伺服器上傳一律失敗(無從核對);伺服器若於工作階段斷線後仍完成已收到之改名或開檔,結果不可知(訊息以「may」表明);SFTP 由伺服器斷線者,上傳依原處置失敗一次(單層目標沿用函式庫之原錯誤,資料夾內目標回固定訊息),其清理重新連線使實例可續用.

測試指令:`npx mocha --no-parallel test/unit-upload-via-temp.test.mjs test/api-sftp-upload-temp.test.mjs test/api-ftp-upload-temp.test.mjs test/api-upload-stall-exit.test.mjs --timeout 60000`.變異(2026-11-28,鏡像根單點植入、跑上列四檔加 `--bail`):47 項全被殺;同批以改前之上傳相關測試(`api-ftp-flow`、`api-sftp-flow`、`api-ftp-sync-multilevel`)全數存活;修前紅:改前 `src` 上單元檔載入失敗,SFTP 28/29、FTP 31/36、退出 4/4 失敗(通過者為行為不變之護欄案).

## 連線生命週期、逾時、重新連線與路徑(FTP 與 SFTP)

需求出處:排程第 708 項(第 658 項讀碼發現之四項既有缺陷:SFTP `ls` 逾時無效、jsftp 隱式重連不重放 `cwd`、`ftp.conn` 連線錯誤中止行程、`sepTreeFolders` 絕對路徑).單一擁有者:`src/connKeeper.mjs`(連線包裝 `genLink`、就緒等待、請求計時與固定訊息 `reqLink`、重新連線單一嘗試、`codeOfConn`);傳輸端差異(建立連線、就緒條件、錯誤轉換、可否重新連線、重放)在兩個 Core.

| 規則 | 內容 | 站點全集與盤點 | 測試 |
|---|---|---|---|
| R-CN-01 `conn` | 連線可用才 resolve(FTP 收到 220;SFTP 連線並開啟 SFTP 通道),以 `timeLimit` 計時;失敗 reject 固定訊息(`ftpConn: can not connect to the server (<code>)`、`ftpConn timeout[T]`),不使行程中止;就緒前即為目前連線(未 await 之操作等待之);失敗之連線保留為「已死、未就緒」:操作視為未連線、`quit` 照常完成 | `keeper.connect`;兩 Core 之 `openLink` | `api-ftp-conn`、`api-sftp-conn`、`api-conn-exit` |
| R-CN-02 逾時 | 每個公開操作(`conn`、`quit`、`ls`、`stat`、`isFile`、`isFolder`、`mkdir`、`cwd`、`pwd`、下載、上傳、同步之列舉)與重新連線皆計時;到時 reject 固定訊息並**銷毀本次所用之連線**(`destroy('TIMEOUT')`),同一連線上之他操作回 `<op>: the connection to the server is closed (TIMEOUT)` | `git grep --untracked -nE "setTimeout\(" -- src`(2026-11-28:`connKeeper` 2、`CoreFTP` quit 1、`CoreSFTP` quit 1、`downloadViaTemp` 2、`uploadViaTemp` 1);`git grep --untracked -nE "destroy\('TIMEOUT'\)\|finish\('TIMEOUT'\)" -- src`(下載 stat 與傳輸兩協定、quit 兩協定、`reqLink`) | 同上之逾時案;`api-ftp-stall`、`api-ftp-stall-exit`、兩個 download 檔 |
| R-CN-03 連線錯誤與訊息 | 連線層級錯誤回固定訊息,只帶 `codeOfConn` 之固定詞彙代碼(ssh2 認證／交握逾時層級、FTP 三位數回應碼、系統與 Node 錯誤代碼經 wsemi `getDiagBriefErr`,其餘 `UNKNOWN`;本套件代碼 `CLOSED`、`TIMEOUT`、`REPLACED`);伺服器對指令之回應沿用原錯誤物件(下游比對 425/550 原文);傳輸本身之錯誤沿用第 657、658 項契約;jsftp 控制連線常駐 `'error'` 監聽;ssh2-sftp-client 之全域監聽改為靜默(原版寫 console) | `openLink` 兩處、`mapErr` 兩處 | `unit-conn-keeper`、兩個 conn 檔 |
| R-CN-04 重新連線 | jsftp 之隱式重連停用(`guardExecute`:控制 socket 不可寫時指令以錯誤結束);FTP 之任何死連線於下一個操作重新連線並重放成功之 `cwd`(重放失敗即清空連線須重新 `conn`);SFTP 僅本套件銷毀者(逾時、上傳中止)自動重新連線,伺服器斷線者須再 `conn`(上傳沿用原失敗處置);同一死連線併發要求共用一次嘗試;連不上者保留死連線供下次再試;嘗試期間另行 `conn` 者改用新連線(待就緒);上傳中止只取消自己發起且無他方併入之嘗試,取消後之要求另起新嘗試,重放中取消者一併清空連線;`quit` 只取消針對被關閉那條連線之嘗試;`cwd` 回覆前連線已換者 reject 且不記錄;控制連線中斷時僅 `ls`(自開數據連線)與取得數據 socket 前之下載釋放連線資源(`release`),下載中之數據 socket 保留 | `keeper.acquire`、`reconnect`、`cancelPending`;`genLink.release`/`destroy`;`git grep -nE "new Jsftp\|new SFTPClient\|guardExecute" -- src` 各 1 個建立站點 | `unit-conn-keeper`(取消、併入、重放中取消、指定連線)、兩個 conn 檔(重放、重放失敗、併發、連不上、quit、conn 交錯、I/O 間隙中斷線、下載中控制連線中斷) |
| R-CN-05 SFTP 工作資料夾 | SFTP 無伺服器端工作資料夾:`cwd` 由本套件保存(目標須為既有資料夾,回其絕對路徑),各操作之相對路徑以串接解析(不作字面正規化,`..` 交伺服器);上傳目標之檔名部分為空、`.`、`..` 者原樣交上傳流程拒絕;`pwd` 回目前資料夾;`conn` 重設 | `rp`、`rpFile`;各操作入口(`ftpLs`、`ftpStateTar`、`ftpDownload`、`ftpUpload`、`ftpMkdir`、`ftpCwd`) | `api-sftp-conn` 之工作資料夾案 |
| R-CN-06 路徑 | `mkdir`(兩協定,公開與上傳之建資料夾)、`syncToRemote` 之遠端路徑:絕對路徑維持絕對,`..`、`.` 起首名稱、含前後空白名稱原樣;`mkdir` 之輸入為檔案路徑(最後一段視為檔名);SFTP 含 `..` 之路徑逐層以跟隨連結之 `stat` 查詢後建立(ssh2-sftp-client 之遞迴建立處理不了),其餘沿用其遞迴建立 | `sepTreeFolders`(單一擁有者)、`ftpTreeFilesInLocalAndRemote` 之 `cvrp`、`CoreSFTP` 之 `sftpMkdirp` | `unit-sep-tree-folders`、兩個 conn 檔之路徑案 |

已知限制(不修,另見 README):jsftp 指令以單一空白串接且整串修剪,含換行或結尾空白之 FTP 路徑會被改寫或注入額外指令(改版前即如此,不在本案);FTP `STAT` 列表含 `.`、`..` 之伺服器於同步列舉行為未改;SFTP 之 `cwd` 為本套件保存之路徑,資料夾事後被伺服器端移除者於下一個操作回伺服器錯誤;`conn` 重複呼叫時前一條存活之連線不關閉(改版前即如此).

測試指令:`npx mocha --no-parallel test/api-conn-exit.test.mjs test/api-ftp-conn.test.mjs test/api-sftp-conn.test.mjs test/unit-conn-keeper.test.mjs test/unit-sep-tree-folders.test.mjs --timeout 60000`.變異(2026-11-28,鏡像根單點植入、跑受影響檔加 `--bail`):62 項,61 項被殺;存活 1 項為 FTP 控制 socket 之 `'end'` 監聽(拿掉後仍由 `'close'` 標記死亡,差異只在 `'end'` 至 `'close'` 之間之時序窗口,無法決定性重現,保留).修前紅(定稿測試對改前 `src` 逐案單獨行程):154 案紅 90、新模組載入失敗 7、通過 56(行為保持案)、略過 1.

## 單次呼叫 opt 之讀取(wsemi 1.9.82 起之 `getOptReader`)

需求出處:wsemi 1.9.82 起公開 `getOptReader(tag, opt)`(輸入參數之檢測機制規格 §7:opt 之取值〔讀取拋錯視為未給〕、種類檢測、`opt.debug` 警告之單一擁有者為 wsemi),自有套件各自寫之 opt 讀取收斂改用.單一擁有者:wsemi `getOptReader`;本庫不自寫 opt 讀取器.

| 規則 | 內容 | 站點全集與盤點 | 測試 |
|---|---|---|---|
| R-OPT-01 單次呼叫 opt 一律經 wsemi `getOptReader` 取值 | `downloadViaTemp` 之 `onTrace`(經 `traceOf`)與 `fdDownloadTemp` 以 `getOptReader('w-ftp downloadViaTemp', optCall).read(鍵)` 讀取:opt 非物件非函數、讀取拋錯(存取器、已撤銷之 Proxy)皆視為未給(不拋錯),函數型 opt 之屬性照常讀;本庫只用 `.read`(不檢測、不警告,檢測由下游 `getTrace`、`resolveFdTemp` 負責),故 `opt.debug`、`opt.funLog` 於本庫無警告出口、無字樣差異;不得再自寫 `readKey` 一類讀取器(本輪已刪 `readKey`) | `git grep -nE "function (readKey\|pickOpt\|readOpt\|optReader)\b\|typeof \w+ === 'object' && \w+ !== null" -- src` 應為 0 處;`git grep -n "getOptReader" -- src` 應為 `downloadViaTemp.mjs` 之 1 處匯入、2 處呼叫(另 1 行註解,2026-11-27).刻意不套:`CoreFTP`、`CoreSFTP` 建構時以 lodash `get(opt, 鍵)` 讀 WFtp 設定(建構設定,非單次呼叫 opt,另案) | `test/unit-download-via-temp.test.mjs` 之 `opt讀取(經wsemi getOptReader, 規則R-OPT-01)` 6 案.變異(2026-11-27,鏡像根注入,跑該檔,修後 30 passing):`fdDownloadTemp` 站不經讀取器直取、鍵名誤寫、不傳入 opt,`onTrace` 站鍵名誤寫、不傳入 opt,兩站各改回自寫之 try/catch(拿掉接線),tag 改字樣,共 8 項全被殺(失敗 4/3/4/12/13/1/1/1 案);修前鏡像 28 passing、2 failing(接線案與掃描案) |
