# Agentic Life World Studio

將原作轉為可確認、可追蹤並能發布為公開網站的世界。作者在私人 AI Studio 匯入原作，校準元素、世界設定、視覺方向與翻譯，再預覽並發布世界網站。

## MVP v0.01

正式 [Studio](https://agentic-world-studio-production.mkhsu2002.workers.dev/) 已部署，私人登入密碼可由下方安全指令複製。NEO BABYLON 全文已保存並在背景分析，校準與公開世界發布尚待作者完成。

本版已建立 React Studio、Hono API、中央元素資料庫、來源分段工作流、世界問答／視覺校準、英文預設網站，以及英文／繁中／日文翻譯校準。實際部署與驗證狀態見 [release 紀錄](docs/RELEASE-v0.01.md)，不能將功能存在視為 live 驗收已完成。

- **私人 Studio：**登入、世界列表、AI 對話、來源覆蓋進度、工作重試及 audit。
- **完整匯入：**貼文、瀏覽器端 Word/PDF 擷取、公開 URL、具 service-account 授權的 Google Docs 全 tabs；私人連接器取得的內容可經 owner-only bridge 進入相同 pipeline。
- **元素登錄：**穩定 element／feature IDs，原名、三語名稱、特色、原文引句、作者校準與版本。
- **世界確認：**回答高影響問題，模型將明確決定套回設定；未完成閱讀、決策或視覺核准時阻止確認。
- **視覺校準：**三個來源相容風格方向、真實 Muse Image 預覽、視覺 QA、作者回饋與同版本核准。
- **翻譯校準：**en／zh-Hant／ja 的名稱、特色與介紹，共用元素 ID；語意 QA、作者修訂、內容 hash、過期攔截及核准。
- **網站發布：**私人完整頁面預覽、候選 hash、圖片／DTO／renderer 公開讀回，通過後切換 active release；失敗保留舊站。

故事內容不寫死於程式或提示詞。開發 IP `NEO BABYLON WORLD` 原文僅存私人快照／R2，不提交 Git。

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

- [PRD 1.0](docs/PRD.md)：完整產品願景與未來驗收基準。
- [v0.01 實作計畫](docs/plans/2026-10-27-mvp-v001.md)：本輪切片與堆疊取捨。
- [v0.01 release](docs/RELEASE-v0.01.md)：真實驗證結果與待完成事項。

v0.01 採 React/Vite、TypeScript/Hono、Cloudflare Workers/D1/R2/Queues，以 Zod 執行本版資料契約；PRD 內 Python/Pydantic/PostgreSQL 為完整架構參考，不是本版已部署的 runtime。推理固定 `muse-spark-1.3`，影像固定 `muse-image-1.0`。

本版聚焦建立、校準與發布。持續世界模擬、每日自主攝影、訂閱寄送與美術集仍屬後續範圍，未啟用這些功能。Studio 關閉不會中止已持久化的匯入、翻譯或影像工作。
