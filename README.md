# Agentic Life World Studio

將原作轉為可確認、可追蹤並能發布為公開網站的世界。作者在私人 AI Studio 匯入原作，校準元素、世界設定、視覺方向與翻譯，再預覽並發布世界網站。

## MVP v0.05

私人 [Studio](https://agentic-world-studio-production.mkhsu2002.workers.dev/) 的 v0.05 已由 GitHub 同步部署至 dev／production，補齊整理進度、下一步與核准入口；驗證狀態見 [release 紀錄](docs/RELEASE-v0.05.md)。核心與補全都需本人明確確認，系統不自動啟用或發布世界。

- **核准導引：**每個分頁顯示目前進度與下一步。整理中不再誤標待核准；完成後可直達審核及核准區。已儲存版本重新開啟可直接親自確認，無須再儲存一次；缺少的補全決定、重大事項、視覺方向或未儲存修改會逐項列出。
- **世界解析：**先理解全局、篩選世界關鍵，再由年代文明、地理環境、生命生態、視覺受眾、命名角色細化，獨立審核直接檢視原始來源。每個 Queue 訊息最多一個角色呼叫，保存 checkpoint 與用量。
- **首次世界審核：**八個內容模組、核心錨點、逐項補全／生成範圍、命名、受眾、探索起點、視覺規範及高影響疑義。AI 先填方案，作者可修改、儲存並明確核准；未知與不適用合法。
- **核准與啟用：**核准綁定畫面上的 revision、recordVersion 與內容 hash；保存不可變快照與 audit。修改設定或圖片後舊核准失效；核心／補全核准、同版視覺試稿核准、最終啟用是三個明確步驟。
- **視覺校準：**私人原圖可在匯入時或來源頁補上，實際像素送視覺理解與 Muse Image 參考生成，再經圖像 QA 與本人核准。未提供原圖時明示僅依文字，不冒稱已分析原圖。最多 6 張、每張 5 MB、合計 15 MB（含上限，按 1 MB = 1,048,576 bytes 計算）；同圖重傳可修復遺失物件。
- **中央元素庫：**元素／特色 ID、多語名稱、定義、來源、命名原則與關係。未能可靠消歧的跨片段同名項目保留分開，避免錯誤合併；尚未提供完整人工身分合併工具。
- **續跑與對話：**低層引句差異不再主導新流程；未驗證描述保留為推論候選，核心證據缺漏進整合確認。一般失敗保留進度並開對話；AI 對話修改同步進待審模組，不靜默啟用。
- **既有發布能力：**保留登入、來源全文、元素校準、en／zh-Hant／ja 翻譯及私人網站預覽／發布。前台只接受核准後的公開 DTO，沒有來源全文、補全標記、prompt 或內部審核資訊。

目前文字型 Word/PDF／網址匯入**不自動擷取全部內嵌圖片**，需要在 Studio 補上視覺依據；掃描 PDF 也不宣稱具完整 OCR。測試 IP 留待作者自行測試，本輪不續跑或替既有世界回答疑義。舊世界可由本人手動選擇「建立八模組審核表」或「改用世界框架繼續整理」，保留已完成閱讀後重新整理，不能沿用舊確認冒充新框架已核准。

## 版本規則

目前產品版本為 **v0.05**，以根目錄 [VERSION](VERSION) 與對應 Git tag 記錄；`v0.01` 保留為首版基準。

- 每次完成並發布一批程式碼變更，產品版本增加 **0.01**：`v0.01 → v0.02 → v0.03`；`v0.09` 的下一版為 `v0.10`。
- 同一批修改的多個檔案或修正 commit 合併為一次升版，不逐檔加號。
- 純文字／文案、README、PRD、操作文件與紀錄編修不升版；混合程式碼與文字的修改仍須升版。SQL、prompt、設定或翻譯契約若改變功能行為，屬程式碼變更。
- 發布前同步更新 `VERSION`、Studio 顯示、API 版本、README 與 release 紀錄，並建立對應 Git tag；不修改歷史版號或移動既有 tag。
- 產品版本與世界內容 `revision`、API 資料契約版本分別管理；文件更新後 Git HEAD 可較 deployed commit 更新，以部署讀回的程式 commit 判斷正式環境版本。

目前世界審核流程版本為 **v0.03**；下一批程式碼修改從 **v0.06** 開始。純文件變更沿用既有 GitHub paths 規則，不觸發完整建置或正式部署。

## 開發

需求：Node.js 24+、npm、Python 3.11+（僅安全設定與 owner 測試工具）。

```sh
npm ci
npm run check
```

`npm run dev` 啟動 Vite；API 使用 Wrangler。部署憑證與模型 key 由安全儲存按需注入，不建立包含 secret 的 repo 檔案。正式程式碼發布只走 GitHub 工作流。

## 部署

**程式碼更新 → push GitHub → checks → dev migrations/API/frontend → dev readback → production migrations/API/frontend → production readback。**

[GitHub Actions](.github/workflows/ci-deploy.yml) 以檔案 paths 與 concurrency 限制觸發。README、docs、audit 等 docs-only 修改不觸發完整 CI 或 production deploy；無 daily build 或分鐘級 polling。GitHub runner 僅持部署 token，Meta key 留在 Cloudflare secret。

設定 Meta key（隱藏輸入，寫入本機 Keychain 與 Cloudflare dev／production，不寫 repo）：

```sh
python3 scripts/configure-meta.py
```

將此 Mac 安全儲存的 Studio 密碼複製至剪貼簿，再貼至登入頁：

```sh
python3 scripts/studio-access.py
```

詳細操作、環境與恢復方式見 [OPERATIONS](docs/OPERATIONS.md)。

## 範圍與文件

- [PRD 1.1 設計草案](docs/PRD.md)：完整願景與已確認的世界框架方向；歷史參考契約已明確標註。
- [v0.02 解析對話計畫](docs/plans/2026-10-27-v002-import-dialogue.md)：已發布 v0.02 的歷史修正與驗收計畫。
- [v0.05 release](docs/RELEASE-v0.05.md)：本版核准導引與驗證狀態。
- [v0.04 release](docs/RELEASE-v0.04.md)：圖片容量調整的歷史發布紀錄。
- [v0.03 release](docs/RELEASE-v0.03.md)：世界框架版本的歷史發布紀錄。
- [v0.03 實作計畫](docs/plans/2026-10-27-v003-world-framework.md)：範圍與驗收。
- [v0.02 release](docs/RELEASE-v0.02.md)：歷史解析對話發布快照。
- [v0.01 實作計畫](docs/plans/2026-10-27-mvp-v001.md)：歷史首版切片與堆疊取捨。
- [v0.01 release](docs/RELEASE-v0.01.md)：歷史首版驗證快照。

v0.01 採 React/Vite、TypeScript/Hono、Cloudflare Workers/D1/R2/Queues，以 Zod 執行本版資料契約；PRD 內 Python/Pydantic/PostgreSQL 為完整架構參考，不是本版已部署的 runtime。推理固定 `muse-spark-1.3`，影像固定 `muse-image-1.0`。

本版聚焦建立、校準與發布。持續世界模擬、每日自主攝影、訂閱寄送與美術集仍屬後續範圍，未啟用這些功能。Studio 關閉不會中止已持久化的匯入、翻譯或影像工作。
