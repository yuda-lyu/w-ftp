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

## opt 讀取收斂至 wsemi `getOptReader`(2026-11-27,wsemi 1.9.82)

- **只用 `.read` 之站點,`tag` 與 `opt.debug`、`opt.funLog` 皆不可由行為觀察**:`getOptReader` 之警告只在 `rd(key, def, check, …)` 檢測未過時才出,`.read(key)` 不檢測不警告;本庫(`downloadViaTemp`)只讀 `onTrace`、`fdDownloadTemp` 之原值,檢測交下游(`getTrace`、`resolveFdTemp`).故「接線」之行為證據取 `getOptReader` 於呼叫時必讀 `opt.debug` 一次(以 Proxy 記錄讀取之鍵,`debug` 非 true 時不讀 `funLog`),`tag` 只能以原始碼掃描釘住.
- **`traceOf` 外層之 `try/catch` 會遮掩 `onTrace` 站「改回直取」之變異**(直取拋錯被 `traceOf` 自己吞掉而回 `null`,行為與經讀取器同);要驗讀取拋錯視為未給,須以 `fdDownloadTemp` 站(外層無 `try/catch`)與非物件 opt(`undefined`、`null`)之案.
- **變異鏡像根放 repo 之 `./tmp/` 下即可解析上層 `node_modules`**(不必建目錄連結):測試以該鏡像根為工作目錄、mocha 以 repo 之絕對路徑啟動.

