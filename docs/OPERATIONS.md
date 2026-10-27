# World Studio v0.02 操作與部署

更新：2026-10-27。這是目前程式操作文件；live 驗收狀態見 RELEASE-v0.02.md。

## 產品版本

目前產品版本為 `v0.02`，版本來源見根目錄 `VERSION`；升版分類與例外以 [README 版本規則](../README.md#版本規則) 為準。每批程式碼發布增加 `0.01`，下一版 `v0.03`；純文字／文案編輯不升版。發布時同步產品版號與 Git tag，前後端部署仍須通過既有一致性驗證。npm package 的 SemVer 欄位供套件工具使用，對外產品版號採上述格式。

## 固定發布路徑

所有程式碼更新先 commit／push GitHub，由 `.github/workflows/ci-deploy.yml` 部署 Cloudflare。不得使用本機 `wrangler deploy` 繞過已測 revision。`main` 依序部署 dev、驗證、部署 production、再次驗證；feature PR 先跑檢查。

Cloudflare 兩環境分離，名稱為 `agentic-world-studio-dev` 與 `agentic-world-studio-production`，各有獨立 Worker、D1、R2、Queue。資源 ID 在 wrangler.jsonc；API/data contract 為 `utsp-studio/0.02`。

GitHub 只持有最低必要部署 token（Workers Scripts、D1、Queues、R2 write 與 Account Settings read），無 Meta provider key。部署 token 帳號範圍受 Cloudflare 平台能力限制，僅用於本 repo 的發布流程；不要複製到 runtime。Meta key、Studio password、session secret 分別以 Worker secrets 注入。

Worker recovery cron 每日一次；兩環境合計約 60 次 lightweight invocation／月，健康運行假設約 100% 無工作即退出。它只補送持久化 outbox，無模型呼叫、build 或訂閱分鐘輪詢。所有低頻工作由使用者事件先持久化再派 Queue。

## 安全設定 Meta API

在 repo 根目錄執行：

```sh
python3 scripts/configure-meta.py
```

工具使用隱藏輸入，不把 key 放進 shell history、process arguments、聊天或 repo。先向 Meta `/v1/models` 驗證帳號可用模型，再將此專案 key 存入 macOS Keychain `agentic.world.studio / meta-api-key`，並透過 stdin 寫入 Cloudflare dev／production `MODEL_API_KEY` secret。這是 secret 設定，不是程式碼部署。

Cloudflare 認證使用本機既有安全儲存；若執行環境缺少該授權，應先使用已核准的 Wrangler OAuth 或安全 token store，不手動把 token 寫進指令。任何 provider 錯誤保留原始 HTTP／code，不依 key prefix 判斷有效性。

Studio 密碼：

```sh
python3 scripts/studio-access.py
```

只複製到 macOS clipboard，不在終端機列印。Studio 使用 HttpOnly/SameSite session、寫入 Origin 檢查與登入限流。目前為單 owner 私人工作台；尚未提供 SaaS 多租戶帳號管理，不宣稱不同作者帳號隔離已實作。

## 匯入與校準

1. 貼文、上傳文字型 PDF／DOCX 或輸入公開 URL。PDF／DOCX 在瀏覽器擷取，再由伺服器保存正規化全文。
2. 私人 Google Doc 需部署端 `GOOGLE_SERVICE_ACCOUNT` 並分享原始檔案給該帳號；未配置時介面會明確要求 Word/PDF／文字，不能繞過 ACL。Codex 已授權連接器讀取的測試快照可用 `studio-client.py import` 送進同一 pipeline，不複製連接器 OAuth。
3. 匯入開始即可填寫年代／範圍／視覺方向／補充表單；欄位選填，確認後才會編譯世界。閱讀中可修訂或從 AI 對話追加作者補充，原文與作者資訊分開保存。
4. 匯入最多 1,000,000 字元／4 MB，逐段處理，無截斷。來源與中間產物均在 private R2；只有已核准的公開 DTO 與被 active release 引用的圖可匿名讀取。
5. 元素的原名與原文證據不可被校準文字覆寫；特色／英文名稱修正升世界 revision，取消舊視覺與語系核准。
6. 完成世界問答並等待套用工作，再選風格、生成預覽、檢查視覺 QA、由本人核准。
7. 翻譯先生成、語意 QA、作者編修與再審，再由本人核准。編修後的舊 QA 不可覆蓋新文字；不完整語系不可上線。
8. 建立網站預覽、開啟英文及選定語系頁面檢查，再發布相同候選。slug／語系／世界或校準內容變動須重新預覽。

## 失敗與恢復

- 來源模型引句需對得上原文。純空白差異可定位回原始 span；其餘最多兩次修復，仍有疑義則建立 `waiting_user` 對話並保存候選，不能增加 coverage。使用者需逐項更正引句、改為作者補充或排除。作者補充標為 `origin=user` 且不保留偽引句；排除項也移除相關定義殘留。
- 其他 import 解析問題同樣轉成待確認，提供原文、補充說明與續跑入口；私人 raw code 留在資料庫診斷，不直接當成介面錯誤。決定與 brief 以 metadata CAS、messages、audit、片段更新及 outbox 同批提交，並行送出只允許一次續跑。
- Migration 0004 將既有 failed import 轉成待確認，不更動來源與 coverage。可由 private R2 最後已保存 repair checkpoint 恢復待核對項，不需重跑模型；無 checkpoint 則提供保留進度的重試對話。
- 工作失敗後由 Studio「重試」繼續 checkpoint；已處理來源段落不重讀。圖片成功後保存 asset checkpoint，後段 QA 重試不重新生圖。
- JSON／型別／refusal／截斷不提交世界；Meta 請求不確定成本保留 usage ledger `uncertain`，不冒充未消耗。
- world/element/terms/audit 在同一 D1 batch，revision＋lock_version compare-and-swap 防止內容與 metadata 互相覆蓋。
- API operation key 與 active job logical key 去重；已完成工作可由明確的新操作重新校準。
- 發布先驗 candidate 與當前內容，再 HTTP 讀回 DTO、實際圖像 bytes/hash 和 renderer；切換失敗保留先前 active release。
- 回滾程式需 revert 修復 commit 並 push GitHub；不刪除歷史資料或降版 destructive migration。

## 驗證命令

```sh
npm ci
npm run check
npm audit --audit-level=moderate
```

CI 另執行 `scripts/verify-deployment.mjs <base-url> <commit-sha> <environment>`，核對 deployed revision、schema、private API 401、Studio HTML 與 JS bundle。

瀏覽器只在必要的介面驗收使用 FlyPig 專屬 lane；本 repo 不因測試 IP 名稱自動切換 M.K. Said 身分。設定與部署優先現有 CLI／API。
