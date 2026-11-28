# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

## wsemi 列舉函數之第 2 參數(2026-11-26,wsemi 1.9.80)

- `fsTreeFolder(fd, opt = {})`:第 2 參數由 `levelLimit` 改為 opt,`opt.levelLimit` 為有效正整數才限層,**未給即窮舉**;給數字(含舊寫法之 `4294967295`)拋 `invalid opt: must be an object`,故舊呼叫點漏改時測試會明顯轉紅,不會像 1.9.63~1.9.79 之 `null` 那樣靜默只列第 1 層.
- 重盤時「省略第 2 參數」之意義前後相反(舊為 1 層、新為窮舉);本庫之 `{}` 為本意窮舉,非舊式省略.
- 超出有效範圍之值(`Infinity`、`4294967296`、`1e10`、`'0x10'`)舊版取 1 層、新版視為未給而窮舉;本庫經 `ispint` 後這些值會流到 wsemi,本機端因此行為改變(改善,與 JSDoc 及遠端一致),以 `test/unit-ftp-tree-files-local.test.mjs` 之邊界值案守住.
- 變異驗證之鏡像根放 `./tmp/<任務名>/mirror-<id>/`(只複製 `src`、`test`、`package.json`),`node_modules` 由其上層解析至本庫根,無須目錄連結;錨點須恰出現 1 次否則報失敗.

## 下載暫存與逾時(2026-11-26)

- **FTP 之 `quit` 會排在未完成之 RETR 後面**:jsftp 控制連線依序處理指令,假伺服器之 RETR 攔截若停滯不回覆,其後 `quit` 要等到 `timeLimit` 才硬關閉;測試之停滯案放行後須回 `426` 結束該指令,否則 `afterEach` 之 `quit` 會多等一個 `timeLimit`(預設 60 秒).
- **SFTP 之 `fastGet` 無法中止**:逾時後背景傳輸仍續行,`quit` 斷線後其回呼可能永不來;故逾時當下即先刪暫存檔名(Windows 上開啟中之檔可刪),背景結束時只清不移,測試不等待「斷線後之傳輸結束」事件.若停滯於遠端 OPEN、逾時後才開啟本地檔,`fastGet` 會以 `'w'` 重建暫存檔名,此殘檔只由其結束時之清理或 24 小時殘留清理收掉.
- **FTP 取得資料 socket 後 jsftp 不再回報其錯誤**:數據連線中途正常關閉或被重置時 `download` 仍回完成,故完成與否一律以「寫入串流無錯誤關閉＋本地大小等於遠端大小」判定.
- **殘留清理之最短間隔以暫存區路徑為鍵、存於模組層**:同一測試檔內各案若共用同一暫存區,只有第一案會觸發清理(後續案收不到 `sweep` 事件);各案須各用不同之暫存區.
- **以 `mock.timers.enable({ apis: ['setTimeout'] })` 驗時間本身為規格者**(逾時門檻、重試間隔):只模擬 `setTimeout`,測試輔助之防懸置上限須用模組載入時保存之真實計時器;啟動被測物後須先確認其計時器已建立(以伺服器端訊號或傳輸函數被呼叫為同步點)再 `tick`.
- **ssh2 `utils.generateKeyPairSync('ed25519')` 偶發產出無法解析之私鑰**(實測 5000 次中 14 次,ssh2 1.17.0):`new Server` 即拋 `Malformed OpenSSH private key`;假 SFTP 伺服器之主機金鑰改為行程內只產一次並以 `utils.parseKey` 驗證.
- **FTP 之 `ftpStateTar` 於 `SIZE` 失敗時仍回 `size: 0`**(`cint('')`),頂層無 `err` 鍵,舊程式只用它做進度百分比而不受影響;加上大小核對後須另以 `rsize.err` 判定取不到大小並拒絕,否則任何非空檔皆被判為大小不符.
- **暫存檔名比目標檔名多約 20 個字元**,目標檔名接近 255 時會 `ENAMETOOLONG`(Windows NTFS 以 UTF-16 單位計、POSIX 以位元組計);基底以碼點截短至 150 位元組.
- **不必另設而被其他判斷涵蓋之檢查**(例:清殘檔時之「非本行程所有」被「行程已不存在」涵蓋,本行程必然存在)之變異必然存活且無法補案,應直接刪除該檢查而不是補測試.
- **Windows 上改名取代既有檔可能遇防毒占用**(`EPERM`/`EBUSY`/`EACCES`):移動採有界重試(共 5 次嘗試,間隔 200×次數毫秒),目標為資料夾時 `rename` 亦回 `EPERM`,須先判斷以免白等重試.

## 上傳暫存、核對、改名與逾時中止(2026-11-28;jsftp 2.1.3、ssh2 1.17.0、ssh2-sftp-client 12.1.1)

- **jsftp `put(stream)` 掛住**:`put` 對串流先掛 `'readable'` 監聽,串流進入暫停模式而 `pipe` 不流動(實測 5 秒 0 位元組);改用 `getPutSocket(stream, path, cb)`.數據 socket 由 jsftp 於收到 150 時以 `stream.pipe(socket)` 交出,覆寫該串流之 `pipe` 即可取得 socket 供逾時銷毀.
- **jsftp 之上傳回呼早於伺服器最終回應**:`getPutSocket` 於數據 socket 關閉即回呼,`226`/`4xx` 尚未到;若此時送下一指令,失敗回應會錯派給下一指令.須監聽 `'data'` 事件等最終回應;併發指令之回應以 `commandQueue[0].action` 分辨(150 標記使 STOR 移出佇列).
- **jsftp 控制連線關閉時不回呼進行中之指令**,`'error'` 事件無監聽者即使行程中止;銷毀後的 jsftp 物件再下指令會自行重建 socket 但舊佇列卡住,故中止後一律換新物件,新物件掛 `'error'` 空監聽,且非同步延續須固定「送出指令之連線」——遲到的舊連線錯誤曾銷毀了重新連線之新連線(測試抓到).
- **ssh2 `fastPut` 兩個坑**:本機檔傳輸中被截短時零長度寫入走 `nextTick` 回呼而重讀同一段,無限迴圈;連線關閉時 `onerror` 仍對已斷通道送 `close` 而永不回呼.上傳改自寫 `open`/`write`/`close`(64 並行、32 KiB),真 OpenSSH `sftp-server` 上吞吐與 `fastPut` 相當(100 MiB 約 8 秒,改前 7.5～10.6 秒).ssh2 `Client` 之 `'close'` 事件早於各通道收尾,「寫入於收尾之後」之案須等 `'close'` 後再 `setImmediate`.
- **ssh2-sftp-client 之路徑改寫**:`mkdir` 內 `normalizeRemotePath` 把 `.` 起首者一律當 `./`;`realpath('.')` 為 `/` 時組出 `//a/b`,Windows 之 `path.parse` 視為網路路徑、遞迴不收斂(假伺服器即重現).先以 `path.posix.join(realpath, 相對路徑)` 轉絕對路徑.
- **ssh2-sftp-client 之 `stat` 把 SFTP 一般失敗(code 4)亦報為不存在**:判斷「刪不掉是否因不存在」改用原始 `sftp.stat` 只認 code 2.
- **ssh2 之 `destroy()` 於 socket 不可寫(已 `end()`)時不作用**,須另銷毀 `client._sock`;主動銷毀時設 `endCalled` 免全域監聽印訊息,並清 `sftp` 使其後之指令立即失敗(否則送往死通道而永不回應).
- **本機有真 SFTP 實作可測**:Git for Windows 內附 `usr/lib/ssh/sftp-server.exe`,以 ssh2 伺服端之 `subsystem` 接其 stdin/stdout 即得真 OpenSSH 行為;`-P posix-rename`、`-P rename,posix-rename`、`-P remove`、`-R` 可模擬無擴充、不可改名、不可刪、唯讀之伺服器.
- **假伺服器之 STOR 須比照真實伺服器逐段寫檔**(收到指令即建立檔案);事後整檔寫入會在客戶端已刪除暫存後把它重建,使「無殘檔」斷言失準.
- **清理與還原邏輯之盲點由唯讀獨立複審抓到**(重連之新連線無 `'error'` 監聽、交換退路斷線不重連、quit 與重連交錯拋 TypeError):逾時/斷線/重連之交錯,自寫測試易只覆蓋「逾時」一路,須另列「斷線」與「quit」兩軸.

## 連線生命週期:逾時、隱式重連、conn 錯誤(2026-11-28;jsftp 2.1.3、ssh2-sftp-client 12.1.1、ssh2 1.17.0)

- **jsftp `execute` 於控制 socket 不可寫時自行重建連線**(重新登入、不重放 `cwd`,且上一條之指令佇列若有進行中指令則新連線永遠送不出);停用法:覆寫實例之 `execute`,socket 不可寫即以錯誤呼叫回調.`Jsftp` 建構即連線,`'data'` 事件含 220 歡迎訊息;`'error'` 無監聽者使行程中止.
- **ssh2-sftp-client `cwd()` 不收參數**(只回登入資料夾),`pwd` 方法不存在;原版 `ftp.cwd(x)` 在 SFTP 成功回傳卻不生效,是「寫到別處並回成功」之同形.其全域監聽預設寫 console(含主機訊息),建構子第 2 參數可傳靜默回調.
- **`endCalled=true` 銷毀 SFTP 連線後,進行中之 promise 可能永不結束**(`fastGet` 之回呼送往死通道);凡要使其結束者,須自掛連線死亡事件(`onDead`)以固定訊息 reject,且用 `setImmediate` 讓函式庫自身之錯誤先行(伺服器斷線時沿用原錯誤).
- **ssh2-sftp-client 之遞迴 `mkdir` 處理不了含 `..` 之路徑**(父層未建時對 `<父>/..` 建立而失敗);含 `..` 者改逐層 `stat`(跟隨連結)後建立,其餘沿用其遞迴(其 `exists` 用 `lstat`,逐層呼叫會把符號連結資料夾判為非資料夾).
- **字面正規化路徑(`posix.join/normalize`)與伺服器解析 `..` 不一定相同**(符號連結);工作資料夾解析只串接,`..` 交伺服器.
- **就緒等待與重連之競態只有唯讀獨立複審抓到**(嘗試期間另行 `conn`,回傳未就緒之新連線;上傳中止清空連線於未重放時即清;控制連線關閉不釋放數據 socket);自寫案偏重「逾時」,須另列「conn／quit 交錯」「僅控制連線關閉」兩軸.
- **下游測試是相容性金絲雀**:`conn` 失敗後 `quit` 由「成功」改「reject 未連線」會使下游兩案失敗;改連線生命週期前先 Grep 下游對 `quit`／訊息之斷言.沙箱複本跑法:複本放 `tmp/<任務>/ds`,以 `module.registerHooks` 把裸名匯入導向下游 `node_modules`、`w-ftp` 導向要驗之 `src`(`NODE_OPTIONS=--import=…`),改前改後各跑一次比對.
- **等價／備援之守門**:`reqLink` 之死連線檢查、下載取得 socket 前之 `onDead`、`guardExecute` 三者互為備援,單一變異存活屬正常;可觀察之判準是伺服器累計連線數(隱式重連會多出一條).
- **修正本身之缺陷由第二輪唯讀複審抓到**(收窄只審上一輪修改):一律 `release()` 會銷毀併發下載之數據 socket(jsftp 之 `_pasvSocket` 只記最後一個);共用之重新連線嘗試被某一等待者取消時波及他人;取消後未即清除 `pending`,緊接之要求併入已取消者;`quit` 收尾之取消須限定其所關閉之連線.這類時序以假連線之單元測試(閘門控制就緒)可決定性重現,比經假伺服器快且穩.

## opt 讀取收斂至 wsemi `getOptReader`(2026-11-27,wsemi 1.9.82)

- **只用 `.read` 之站點,`tag` 與 `opt.debug`、`opt.funLog` 皆不可由行為觀察**:`getOptReader` 之警告只在 `rd(key, def, check, …)` 檢測未過時才出,`.read(key)` 不檢測不警告;本庫(`downloadViaTemp`)只讀 `onTrace`、`fdDownloadTemp` 之原值,檢測交下游(`getTrace`、`resolveFdTemp`).故「接線」之行為證據取 `getOptReader` 於呼叫時必讀 `opt.debug` 一次(以 Proxy 記錄讀取之鍵,`debug` 非 true 時不讀 `funLog`),`tag` 只能以原始碼掃描釘住.
- **`traceOf` 外層之 `try/catch` 會遮掩 `onTrace` 站「改回直取」之變異**(直取拋錯被 `traceOf` 自己吞掉而回 `null`,行為與經讀取器同);要驗讀取拋錯視為未給,須以 `fdDownloadTemp` 站(外層無 `try/catch`)與非物件 opt(`undefined`、`null`)之案.
- **變異鏡像根放 repo 之 `./tmp/` 下即可解析上層 `node_modules`**(不必建目錄連結):測試以該鏡像根為工作目錄、mocha 以 repo 之絕對路徑啟動.

