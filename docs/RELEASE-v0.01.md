# MVP v0.01 發布與驗證紀錄

狀態：實作與驗收進行中，2026-10-27。以下每項僅記錄實際完成或待驗證狀態，不能以程式存在推論 live 成功。

## 已驗證

- Google Drive 連接器讀取指定開發 IP 的 26 個 tabs；私人完整快照保存於忽略目錄，未提交 Git。
- dev 已保存 146,981 Unicode code points 的來源，切成 15 段；API 可讀回 source hash 與逐段 coverage。
- Meta `/v1/models` 以現有安全儲存 API key 成功回 200，包含 Spark 1.3、Muse Image 1.0；dev 實際來源閱讀有 provider usage 與持久化結果。
- Cloudflare dev／production 初始 D1 migrations 0001–0003 已套用，兩環境有獨立 D1／R2／Queue；後續發布統一交由 GitHub Actions。
- 本機 43 個測試、型別檢查與 production build 通過，npm audit 0 vulnerabilities；包含並行發布唯一處理權、匯入中對話阻擋、對話用量成功／失敗帳本回歸。GitHub run 結果待首輪完成讀回。
- GitHub 部署 token 已依必要 permission groups 建立並存 repo secret；Meta key 不進 GitHub runner。

## 驗收中／待本人校準

- 全文編譯：來源第二段遇到未能對上原文的模型引句，已正確停止且未宣稱全讀完成。新增 formatting-only 定位與兩次有界修復後，待 GitHub 部署新版並從 checkpoint 重試。
- NEO BABYLON 世界時間切片、風格與譯名須由作者確認，系統不代簽核准。
- 真實圖像生成／審查、三語翻譯與完整網站發布，需在整合測試與作者校準中讀回證據。
- production 程式碼自動部署與公開 URL 尚待首輪 GitHub workflow 完成；正式完成紀錄需對齊 commit、deployed code/schema/live behavior。
- 瀏覽器介面驗收尚未完成；目前僅型別／build／API／資料庫／公開資產讀回，不宣稱完整視覺 QA。

## 本版界線

本版實作建立、原作轉譯、中央元素庫、校準與網站發布。完整事件世界模擬、每日自主攝影、電子報實寄與美術集未啟用，不列為本次已驗證能力。私人 Google Doc 直接匯入需部署端 service-account 授權；目前測試素材由既有連接器提供全文 bridge。
