# v0.04 圖片上傳容量

狀態：2026-10-27，實作完成，GitHub 部署及 live 驗證待完成。

- 單張上限由 2 MiB 提高至 5 MiB（包含剛好 5 MiB），每世界合計由 6 MiB 提高至 15 MiB，最多 6 張，支援 PNG／JPEG／WebP。
- 前後端共用容量常數，匯入選檔、追加、儲存與讀回同步更新；API JSON 上限 28 MiB，容納圖片 Base64 與原文。解碼直接填入 byte buffer，避免將每個字元展開成中間陣列。
- 超限與無效圖片仍在持久化前拒絕。新增圖片仍清除舊核准，同圖修復維持既有行為；不代替作者核准、啟用或續跑世界。
- 產品 `0.04`、npm `0.0.4`；欄位與資料表未變，API 契約沿用 `utsp-studio/0.03`、migrations 沿用 0001–0005。

## 驗證

已先重現舊版拒絕 5 MiB 單圖（422）及 15 MiB 整批匯入（413）。新增測試涵蓋 5 MiB 保存／讀回、超出單張 1 byte 拒絕且零寫入、15 MiB 總量邊界、已存圖片追加超額，以及整批圖片通過實際 API middleware 並原子保存。

本機 149 個測試、typecheck、production build、Prettier 格式檢查通過；npm audit 為 0 vulnerabilities。已查核 dev／production migrations 0001–0005 及 DB／R2／Queue／ASSETS／必要 secret 名稱一致。GitHub run、雙環境 deployed revision／frontend／private media 與 dev 真實容量 smoke 結果於發布後補齊。
