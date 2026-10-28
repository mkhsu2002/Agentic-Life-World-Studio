# World Studio v0.07｜操作與部署

本文件描述目前對話流程及部署契約。外部環境查核結果只在實際讀回後記錄；開發測試不代表作者已核准任何正式世界。

## Studio 操作

正式入口：[World Studio](https://agentic-world-studio-production.mkhsu2002.workers.dev/)。私人單一作者、繁中對話；公開網站預設英文。

1. 建立對話，貼全文、網址或上傳原稿／圖片。文件上限 25 MiB，圖片單張 5 MiB、每批六張；六張大圖分別上傳，turn 只傳儲存識別。
2. 等總監整理原著核心及五個創作面向。閱讀時仍可補充或取消，不需要填表。
3. 討論修改後說「採用這個方向」，或使用訊息內採用按鈕。核准世界補全候選，挑選實際視覺試稿。
4. 說「幫我製作網站」，在同一對話查看獨立版型的私人預覽。採用設計不等於公開。
5. 明確說「發布網站」。只有同一核准候選完成 GitHub／Cloudflare／公開讀回驗證才回覆正式網址。
6. 自主更新保持停用。需另外指定頻率、創作範圍及呼叫次數上限，再確認政策；可隨時說「停止自主更新」。

舊原檔與公開快照保留在原資料結構，不自動重跑或變成新核准。可從資料抽屜複製舊原文到新對話，作者送出後才開始新工作。

## 安全設定

```sh
python3 scripts/configure-meta.py
python3 scripts/studio-access.py
python3 scripts/configure-github-app.py
```

Meta 工具隱藏輸入，存入 macOS Keychain 並以 stdin 套用 Worker secret；不接受聊天回覆、repo `.env` 或命令列明文存放 key。密碼工具只複製至剪貼簿。

GitHub App 工具啟動本機回呼頁面，由作者親自確認建立私人 App，安裝只選 `mkhsu2002/Agentic-Life-World-Studio`。App 需要 Contents／Pull requests／Actions write、Checks read：Actions write 僅用於明確重試已失敗的正式部署。工具驗證單一 repository 後才把 PKCS8 private key 存入 Keychain 及 dev／production。個人 gh token 不注入 Worker。Manifest 的 webhook 使用公開 HTTPS 網址且保持停用；本機回呼只接收作者建立及安裝的結果。

必要 Worker secrets：`MODEL_API_KEY`、`SESSION_SECRET`、`STUDIO_PASSWORD`、`STUDIO_DEPLOY_TOKEN`。獨立網站 GitHub 流程另需 `GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_INSTALLATION_ID`。只查名稱，不輸出值。

GitHub Actions 只持有 `CLOUDFLARE_API_TOKEN` 與 `STUDIO_DEPLOY_TOKEN`；沒有模型、原稿或 Studio 密碼。後者與兩個 Worker 的同名 secret 必須一致，值留 Keychain `agentic.world.studio/deploy-callback-token`，透過 stdin 注入，不提交 repository。

未連接 App 時仍可使用對話、核准、實際影像及私人網站預覽；建立 PR／合併／正式網站發布必須先完成連接。不能將本機 mock 當成已完成連接。

## 資源與資料契約

| 環境 | Worker | D1 | R2／Queue／Workflow |
|---|---|---|---|
| dev | agentic-world-studio-dev | 4e96e9b5-649e-4724-8ef0-139ab38c6069 | 同名 bucket／queue；agentic-world-studio-dev-operations |
| production | agentic-world-studio-production | ce752fbd-4bf7-4f48-8d22-270e32d9208b | 同名 bucket／queue；agentic-world-studio-production-operations |

Bindings：`ASSETS`、`DB`、`STORAGE`、`JOBS`、`OPERATIONS`。每次發布核對 `BUILD_REVISION`、產品版號及 `utsp-studio/0.07`，兩環境實際套用 migrations 0001–0007。0006 新增對話、來源、任務、核准、記憶及用量；0007 新增網站、發布、自主政策輪次、排程及旅程紀錄，不刪舊資料。

Studio 新 API 在 `/api/studio/`，舊 `/api/worlds/` 留作歷史資料相容。turn 的原子冪等由 `studio_turns.client_message_id` 處理，不經舊版 `operation_keys` pending cache。SSE 事件可重播，snapshot 是一致的最新一千則，`events?before=` 取得更早訊息。總監若回傳英文說明或內部欄位詞，先保存候選再修訂供作者閱讀的繁中文案，不重讀長原稿；修訂不能改 action、識別、設定權限或營運政策，人工重試沿用已保存候選。首次閱讀若只回覆而未形成方向，使用既有理解補齊未核准提案，再回查原文；重複句段先修訂，不直接顯示。

## GitHub → Cloudflare

程式碼只能經 GitHub 自動部署。主程式分支驗證成功後部署 dev；合併 main 才依序套用 dev 與 production migration、Worker／資產及讀回。禁止本機 wrangler deploy。

世界網站候選由 App 建立 `world/<site-id>`。生成內容限 `sites/<site-id>/layout.html`、`style.css`、`manifest.json` 與受控版本檔，不含原作或故事文案。無憑證 validate job 建置／測試／審核；可信 main 的 callback job 才持有部署回報 token。候選分支不部署正式 Worker。

正式環境序列化合併，一次只允許一個網站進入 merging／deploying。過期基底保留相同版型、重設版本並重新驗證。main 的部署 metadata 驗證所有既有 site manifest，避免合併後接續部署漏回報先前候選。成功回報逐項比對 Worker revision、程式雜湊、作者發布訊息及目前世界內容，讀回所有公開語系與影像後才切換 active。

CI 失敗回報在同一對話顯示，保留前一個 active。重試只重跑實際失敗的正式 Actions，或針對已部署版本重新讀回；不以空 commit／時間戳喚醒 CI。dev 不合併正式網站候選。

`push`／PR paths 僅包含會影響程式、資料契約或正式輸出的檔案；README、docs、audit、handoff 等純文件不啟動完整 CI 或部署。同 repository 的開發／世界候選分支已由 push 驗證時，PR 不重跑相同完整驗證；其他分支及外部 PR 保留驗證。

## 排程與成本

自主更新使用 Workflows 的持久化延遲 → Queue，完成一輪才安排下一輪。延遲在 durable step 中保存，重播沿用相同步驟；已到期直接派送，不向平台要求睡眠至過去。未啟用世界不產生探索喚醒。用量預留涵蓋每次供應商請求，包含無法確認結果但可能計費的請求；有效收據重用不再扣新呼叫。

既有每日一次 recovery cron 保留，兩環境約每月 60 次輕量觸發；無工作快速退出，補送 outbox／未派送或已到期但未建立輪次的喚醒，以及中斷的輪次，不執行完整 build、不作分鐘輪詢、不自行啟動作者未授權政策。每個啟用世界另有約 `30 × 24 / frequencyHours` 次有工作喚醒／月，失敗重試最多兩次。

v0.07 以作者指定的模型呼叫次數作硬上限。沒有即時金額定價換算，不把呼叫次數誤稱金額；達上限暫停，不自動提高預算。郵件、訂閱、明信片及美術集尚未建立寄送排程。

## 驗證

```sh
npm ci
npm run check
npm run format:check
npm audit --audit-level=moderate
node scripts/validate-sites.mjs
node scripts/verify-deployment.mjs <base-url> <full-commit-sha> <dev-or-production>
```

發布前核對目標分支與 commit、兩環境 migration、Worker bindings／secret 名稱、API／前端相符，以及實際中性對話匯入、提案、核准、取消與 audit。正式世界不得自動核准或重跑。

瀏覽器 fixture：`/tests/fixtures/conversation-file-browser.html` 僅由本機 Vite 提供；實際 DOCX／PDF 各八張測試圖片，驗證六張真實參考、末段文字及兩張未納入警告。單元測試的 PDF 模擬不當作瀏覽器 canvas 驗證。

公開輸出檢查涵蓋三語正文、導覽、SEO、ARIA、替代文字及資產。不得公開來源、私人指示、核准證據、prompt 或模型選型。只有已確認快照能進公開 DTO；發布錯誤不能修改前一 active。

### 本輪查核狀態

- 本機核心／SQLite／瀏覽器驗證已執行；完整結果於發布後記入同輪查核文件。
- GitHub App 連接由作者同步操作；完成後需實際驗證 installation 的單一 repository 範圍。
- v0.07 dev／正式部署與線上讀回：尚待本輪 CI 完成，不以本機檢查代替。
