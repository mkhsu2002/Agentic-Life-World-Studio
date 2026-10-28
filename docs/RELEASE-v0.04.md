# v0.04 圖片上傳容量

狀態：2026-10-27，GitHub main 發布完成，dev／production 的程式、schema、bindings、API 與前端均已交叉驗證。

- 單張上限由 2 MiB 提高至 5 MiB（包含剛好 5 MiB），每世界合計由 6 MiB 提高至 15 MiB，最多 6 張，支援 PNG／JPEG／WebP。
- 前後端共用容量常數，匯入選檔、追加、儲存與讀回同步更新；API JSON 上限 28 MiB，容納圖片 Base64 與原文。解碼直接填入 byte buffer，避免將每個字元展開成中間陣列。
- 超限與無效圖片仍在持久化前拒絕。新增圖片仍清除舊核准，同圖修復維持既有行為；不代替作者核准、啟用或續跑世界。
- 產品 `0.04`、npm `0.0.4`；欄位與資料表未變，API 契約沿用 `utsp-studio/0.03`、migrations 沿用 0001–0005。

## 驗證

已先重現舊版拒絕 5 MiB 單圖（422）及 15 MiB 整批匯入（413）。新增測試涵蓋 5 MiB 保存／讀回、超出單張 1 byte 拒絕且零寫入、15 MiB 總量邊界、已存圖片追加超額，以及整批圖片通過實際 API middleware 並原子保存。

本機 149 個測試、typecheck、production build、Prettier 格式檢查通過；npm audit 為 0 vulnerabilities。已查核 dev／production migrations 0001–0005 及 DB／R2／Queue／ASSETS／必要 secret 名稱一致。

## 發布與線上驗證

- GitHub [run 40613286161](https://github.com/mkhsu2002/Agentic-Life-World-Studio/actions/runs/40613286161) 成功，依序完成 dev／production migration 檢查、Worker／前端部署及 readback；兩環境 deployed revision 均為 `47524906c0ce7e8dedb299353feab1a202511a3a`，產品 `0.04`、契約 `utsp-studio/0.03`。Git tag `v0.04` 指向此程式 commit。
- 部署後再次讀回兩環境 migrations 0001–0005、BUILD_REVISION、DB／R2／Queue／ASSETS 與必要 secret 名稱；私人 overview 保持 401。前端同為 `/assets/index-fEle5WIK.js`，可見上傳說明為每張 5 MB、合計 15 MB，不再包含舊的每張 2 MB。
- 中性 dev QA 世界實際上傳有效 PNG，精確 `5,242,880 bytes`，經 owner media 讀回核對長度與 SHA-256。D1 同步確認 1 個 source_image、1 個 asset、1 筆 `source.image_added` audit，沒有 active release，沒有自動核准。
- dev／production 的 `5,242,881 bytes` 圖片皆回傳 422／`SOURCE_IMAGE_TOO_LARGE`，世界 revision、recordVersion 及圖片數不變；production 原作保持 reading，沒有續跑或修改。
- 獨立且未帶 Cookie 的請求讀取 dev 私有圖片回傳 404。
- 驗證容量不呼叫模型、不產生公開內容。正式環境未新增測試圖片；實際保存僅發生於原有中性 dev QA 世界。
