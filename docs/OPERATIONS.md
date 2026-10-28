# World Studio v0.06 操作與部署

> 狀態：2026-10-27 封存。本文件為重新規劃前的既有文件，僅供查核既有資源與歷史版本；不代表新產品需求或繼續開發的授權。新規劃以 `docs/PRD.md` 的待確認提案為準。

狀態：2026-10-27，六項流程操作規格；線上驗收見 [RELEASE-v0.06](RELEASE-v0.06.md)。舊版操作已[封存](archive/OPERATIONS-v0.05.md)。目前產品 `0.06`、npm `0.0.6`、API `utsp-studio/0.06`，下一批程式碼 `0.07`；純文件不升版。

## 匯入、確認與發布

1. 貼文字、上傳文字型 PDF／DOCX 或輸入公開 URL。最多 1,000,000 字元／4 MiB，逐段保存原文。私人 Google Doc 仍需部署端存取權；無完整掃描 OCR 或全文件內嵌圖片擷取保證。
2. 補上代表性的私人參考圖：PNG／JPEG／WebP，最多六張、單張 5 MiB、合計 15 MiB，含上限。API JSON 上限 28 MiB 容納 Base64／原文。圖片選填，無像素不宣稱已讀畫風；同圖重傳能修復私有物件。
3. 新匯入自動閱讀六項相關線索，再產出六段簡報及一個視覺方向，不要求先填方向、物種、地點、角色關係或完整世界表。
4. 在「世界確認」讀 AI 草稿。只有必要裁定才需要回答；「採用建議」是作者明確操作。可直接改六段或用 AI 對話補充，對話不會代填裁定答案或核准。
5. 有修改先儲存；無修改可直接勾選本人確認並送出。零問題合法。設定核准綁定 revision／recordVersion／briefHash，保存不可變 snapshot、approval 與 audit；舊畫面不能批准新內容。
6. 到視覺頁產生整體世界或選定已知元素的試稿，檢視 QA 與實際圖片，再由本人核准。AI 預填方向不等於影像已核准。
7. 設定及同版本試稿都核准後，回「世界確認」啟用。改內容或圖片會清除舊核准並使舊翻譯失效。
8. 生成 en／zh-Hant／ja 譯文、語意 QA、作者校準及本人核准；修改後重新審查。新簡報的公開介紹依已核准基本樣貌改寫，私有指示／裁定／證據不能公開。
9. 建立私人網站預覽、檢查所有選定語系，再發布相同候選。改 slug／語系／世界或校準內容後重新預覽。公開預設英文。

## 舊世界與失敗恢復

- 舊原文、核准與發布快照不刪除。既有工作 payload 保持原版本；沒有背景遷移或自動重跑。舊未核准世界由本人按「用六項重新整理」才改用 0.06，新簡報須重新本人核准。
- 新簡報保存 `worlds.document_json.brief`／`briefApproval`，新增 `briefHash` 與 `/brief`、`/brief-approval` API；沿用 migrations 0001–0005，不新增 SQL migration。兩環境仍必須同步部署新 Worker／前端，不可只更新前端。
- 六項初始化 reader→editor→visual→fidelity，每 delivery 最多一個模型呼叫。角色結果先落 R2 receipt，再更新原用量帳本及 checkpoint；重試沿用成功結果，不重付有效已存解析。每個原作片段只取少量與畫面／敘述／界線有關的線索，既有詳細萃取不成為新簡報輸入。
- 初始化格式／來源／技術問題轉成可恢復處理對話，保留閱讀與用量紀錄；不代替作者裁定。無效 checkpoint 及其後依賴會失效重整，不能當作已驗證來源。
- 最後簡報／元素／source coverage／工作完成／audit 同批 CAS 提交。作者並行補充、圖片變更或內容修訂不能被背景結果覆寫。
- 既有視覺生成及 QA checkpoint 延用；翻譯沿用現行執行流程，尚未納入六項解析的每 delivery 單角色及相同的所有故障成本保證。成本不確定時保留 ledger uncertain，不宣稱零消耗。
- 私人原文、圖片、簡報與核准都不能匿名讀取。公開路由只使用已核准 release DTO；中央元素庫可為空，不以虛構元素補足流程。

## 安全設定

```sh
python3 scripts/configure-meta.py
python3 scripts/studio-access.py
```

第一個工具隱藏輸入 provider key，按需寫入 macOS Keychain 與 Cloudflare dev／production MODEL_API_KEY，不寫 repo、shell history 或明文參數；第二個只將 Studio 密碼複製至剪貼簿。Studio 使用 HttpOnly／SameSite session、Origin 檢查與登入限流；目前為單 owner，不宣稱 SaaS 多租戶已實作。provider 錯誤依實際 HTTP／code 診斷，不依 key 外觀判定。

## GitHub 發布與雙環境驗證

`main` push → checks → dev migrations／Worker／frontend → readback → production 同步 → readback。禁止本機 wrangler deploy 繞過測過的 revision。docs-only 不啟動完整 CI／正式部署。

環境為 agentic-world-studio-dev 與 agentic-world-studio-production，各自持 D1／R2／Queue。檢查 deployed BUILD_REVISION、ASSETS、DB、STORAGE、JOBS、MODEL_API_KEY、SESSION_SECRET、STUDIO_PASSWORD，以及 migrations 0001–0005。只查 secret 名稱，不列值。Meta secret 留在 Worker，GitHub runner 只用部署授權。

```sh
npm run check
npm run format:check
npm audit --audit-level=moderate
node scripts/verify-deployment.mjs <base-url> <full-commit-sha> <dev-or-production>
```

部署驗證包含精確產品／contract／commit、必要資料表、私人 API 401、Studio HTML 與 JS bundle，再驗證新的六項 schema／核准失敗不寫入及 audit。操作驗收用中性 fixture，不代核准正式原作。

既有每日一次 recovery cron 只補送持久化 outbox，兩環境約 60 次輕量觸發／月，無工作即退出；新匯入由事件派 Queue。日常自主探索、訂閱／明信片寄送與美術集排程仍未啟用。
