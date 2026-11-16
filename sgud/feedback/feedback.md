# w-ftp 回饋(只增不改;處置結果另記一列並寫明承接哪一列)

| # | 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|---|
| 1 | 2026-11-17 | 自有套件 | w-ftp(`opt.levelLimit` 之輸入檢測)與 wsemi `ispint` | `src/ftpSyncToLocal.mjs`、`src/ftpSyncToRemote.mjs`、`src/ftpTreeFilesInLocalAndRemote.mjs`、`src/ftpTreeFolder.mjs` 以 `ispint` 判定 `levelLimit`,而 `ispint` 對 `Infinity`、`1e10`、`4294967296`、字串 `'0x10'` 皆回 `true`;這些值傳給 wsemi `fsTreeFolder`(1.9.62、1.9.63 皆然)被視為非預期而取預設 1,本機端只列第 1 層,遠端 `ftpTreeFolder` 則以 `level <= levelLimit` 比較,`Infinity` 為不限,兩端不一致.本輪(Gitea 項 492,wsemi `levelLimit` 之 `null` 改取預設 1)只處理 `null`,此項未修,建議於輸入檢測盤點時併處理(例如本庫自行判定有限整數並夾在 `4294967295` 以內,或改以 wsemi 之 `iseint` 規則) | 實測 `fsTreeFolder` 於 wsemi 1.9.63:`4294967295`→4 項(全部層級),`4294967296`、`1e10`、`Infinity`、`'0x10'`→2 項(只第 1 層),`'3'`、`3`→4 項;`ispint(Infinity)`、`ispint(1e10)`、`ispint('0x10')` 皆為 `true`(wsemi 1.9.62、1.9.63 同) |
