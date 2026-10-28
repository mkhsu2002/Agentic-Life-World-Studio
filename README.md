# Agentic Life World Studio

將原作轉為可確認、可追蹤並能發布為公開網站的世界。作者在私人 AI Studio 匯入原作，校準元素、世界設定、視覺方向與翻譯，再預覽並發布世界網站。

## MVP v0.06

私人 [Studio](https://agentic-world-studio-production.mkhsu2002.workers.dev/) 改用六項創作簡報；AI 先整理，作者只處理必要裁定。部署與驗證狀態見 [v0.06 release](docs/RELEASE-v0.06.md)。

- **六段預填：**世界基本樣貌、視覺風格、觀看者與敘述聲音、旅程時段與揭露界線、命名、延伸創作範圍。沒有必要問題即可直接確認，不要求先建立人物／物品／關係百科或探索起點 ID。
- **必要裁定：**最多五個真正影響畫面、公開敘述或創作界線的問題。AI 建議與作者答案分開；採用建議必須由作者點選，解析不能代答。
- **精簡解析：**分段只取六項相關線索，再由編輯、視覺導演及獨立忠實度角色統整；一個初始化 Queue delivery 最多一次模型呼叫，結果、checkpoint 與用量帳本可恢復。
- **明確核准：**本人核准設定、本人核准同版視覺試稿、最後啟用分開。未儲存、版本衝突及未答必要題會阻擋；設定或圖片變更清除舊核准。
- **視覺校準：**一個 AI 預填方向，可直接為整體世界產生試稿，不需要先有物種或領域清單。原作參考圖為私人 PNG／JPEG／WebP，最多六張、單張 5 MiB、合計 15 MiB；同圖重傳可修復物件。
- **中央元素庫：**只保存網站實際需要的少量已知專名，之後隨探索逐步累積名稱、外觀與特色。零元素是合法起點。
- **既有出版：**沿用 en／zh-Hant／ja 翻譯校準、私人預覽及網站發布。公開 DTO 不包含私有簡報、原文、裁定、核准或內部流程。

文字型 Word／PDF 與網址匯入不保證擷取全部內嵌圖片；掃描 PDF 尚無完整 OCR。舊原作、核准與發布快照保留，原版本工作照原版本執行。舊世界可由本人選擇「用六項重新整理」，不自動重跑或替作者核准。

## 版本規則

目前產品版本為 **v0.06**，以根目錄 [VERSION](VERSION) 與對應 Git tag 記錄；`v0.01` 保留為首版基準。

- 每次完成並發布一批程式碼變更，產品版本增加 **0.01**：`v0.01 → v0.02 → v0.03`；`v0.09` 的下一版為 `v0.10`。
- 同一批修改的多個檔案或修正 commit 合併為一次升版，不逐檔加號。
- 純文字／文案、README、PRD、操作文件與紀錄編修不升版；混合程式碼與文字的修改仍須升版。SQL、prompt、設定或翻譯契約若改變功能行為，屬程式碼變更。
- 發布前同步更新 `VERSION`、Studio 顯示、API 版本、README 與 release 紀錄，並建立對應 Git tag；不修改歷史版號或移動既有 tag。
- 產品版本與世界內容 `revision`、API 資料契約版本分別管理；文件更新後 Git HEAD 可較 deployed commit 更新，以部署讀回的程式 commit 判斷正式環境版本。

目前創作簡報契約為 **world-brief/0.06**，API 契約為 **utsp-studio/0.06**；下一批程式碼修改從 **v0.07** 開始。純文件變更沿用既有 GitHub paths 規則，不觸發完整建置或正式部署。

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

- [PRD 1.2](docs/PRD.md)：目前六項產品設計與初始化 Agent 職責。
- [v0.06 release](docs/RELEASE-v0.06.md)：本版相容、驗證與發布狀態。
- [v0.06 實作計畫](docs/superpowers/plans/2026-10-27-v006-six-part-brief.md)：已確認的實作範圍與檢查。
- [PRD 1.1 歷史封存](docs/archive/PRD-1.1-historical.md)：已被取代的完整世界／八模組方案。
- [v0.05 release](docs/RELEASE-v0.05.md)、[v0.04 release](docs/RELEASE-v0.04.md)、[v0.03 release](docs/RELEASE-v0.03.md)：歷史發布快照。

v0.01 採 React/Vite、TypeScript/Hono、Cloudflare Workers/D1/R2/Queues，以 Zod 執行本版資料契約；PRD 內 Python/Pydantic/PostgreSQL 為完整架構參考，不是本版已部署的 runtime。推理固定 `muse-spark-1.3`，影像固定 `muse-image-1.0`。

本版聚焦建立、校準與發布。持續世界模擬、每日自主攝影、訂閱寄送與美術集仍屬後續範圍，未啟用這些功能。Studio 關閉不會中止已持久化的匯入、翻譯或影像工作。
