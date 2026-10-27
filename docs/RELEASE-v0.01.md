# MVP v0.01 發布與驗證紀錄

> 歷史快照（2026-10-27）：後續解析失敗／待確認流程由 [v0.02 紀錄](RELEASE-v0.02.md) 接續；以下首版狀態不代表即時進度。

狀態：Studio 與 API 已正式部署；IP 全文處理與作者校準仍進行中。查核日期 2026-10-27。以下只記錄實際證據，不以程式存在推論 live 成功。

## 版本基準

本版固定為 `v0.01`，由 `VERSION` 與同名 Git tag 記錄。2026-10-27 讀回 dev／production `/api/health` 均為 `version: "0.01"`，程式 commit 均為 `bdbf2c9739f37fd190f59eb0ff8d87087c02e406`。本次僅新增版本中繼資料與文件，沒有程式碼變更，不升版、不重新部署。後續每批程式碼發布增加 `0.01`；純文字編輯不計。

## 已驗證

- 程式 commit `bdbf2c9739f37fd190f59eb0ff8d87087c02e406` 已合併並推送 `main`。
- GitHub dev run [40584160104](https://github.com/mkhsu2002/Agentic-Life-World-Studio/actions/runs/40584160104) 成功；main run [40584328517](https://github.com/mkhsu2002/Agentic-Life-World-Studio/actions/runs/40584328517) 成功，由 GitHub 依序部署及驗證 dev、production。
- 兩環境 `/api/health` 讀回同一程式 commit、正確 environment 與 `utsp-studio/0.01`；私人 API 匿名 401，Studio HTML 與 JS bundle 均可讀回。
- 正式 Studio：[production](https://agentic-world-studio-production.mkhsu2002.workers.dev/)。測試 Studio：[dev](https://agentic-world-studio-dev.mkhsu2002.workers.dev/)。
- dev／production D1 實際讀回 migrations `0001_studio.sql`、`0002_job_keys.sql`、`0003_active_jobs.sql`；各有獨立 D1／R2／Queue。正式環境登入及 capabilities 已讀回。
- 本機與 GitHub 43 個測試、型別檢查、production build 通過，npm audit 0 vulnerabilities。包含並行發布唯一處理權、匯入中對話阻擋、對話成功／失敗用量帳本、翻譯 checkpoint 與過期版本回歸。
- Meta `/v1/models` 以安全儲存 API key 回 200，含 Spark 1.3、Muse Image 1.0。正式環境具 `MODEL_API_KEY` secret，前端與 GitHub runner 無 provider key；`configure-meta.py` 可供使用者隱藏輸入後更新兩環境。
- 指定 Google Doc 的 26 個 tabs 已透過既有授權連接器取得並完整保存；dev 與 production 均經 owner-only API 保存 146,981 Unicode code points、15 個片段。來源 hash `aa8e6b91ac4652999aefa66932358fb242d6afc3d0f80c3e84ba90140eed2fa4`。
- dev 曾在第二段因模型引句不符而停止；新版的空白定位／有界修復已實際通過該段，coverage 至少 2/15。兩環境背景閱讀工作已運行，不能把來源已保存誤認為全文已分析完成。

## 尚待驗收／本人校準

- 全文 15/15 coverage、模型編譯與中央元素庫寫入完成，須以 Studio 即時進度及 audit 讀回。最後查核時 dev 2/15、production 0/15，均 running；這是歷史快照，不代表目前即時進度。
- NEO BABYLON 世界時間切片、風格與譯名須由作者確認，系統不代簽核准。
- 真實圖像生成／審查、三語翻譯與 NEO BABYLON 公開網站尚未宣稱 live 成功；流程已有實作及隔離測試，需完成作者校準後實測。
- 瀏覽器介面驗收尚未完成；目前驗證涵蓋型別／build／API／資料庫／公開資產讀回，不宣稱完整視覺 QA。必要時採使用者指定 FlyPig 專屬 lane。

## 本版界線

本版實作建立、原作轉譯、中央元素庫、校準與網站發布。完整事件世界模擬、每日自主攝影、電子報實寄與美術集未啟用。私人 Google Doc 直接匯入需部署端 service-account 授權；目前測試素材由既有連接器提供全文 bridge，未複製連接器 OAuth 或繞過 ACL。Studio 為單 owner，尚無 SaaS 多租戶帳號管理。
