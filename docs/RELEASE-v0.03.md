# v0.03 世界解析、首次確認與視覺校準

狀態：2026-10-27，本機實作與整合驗證完成；GitHub 發布與兩環境 live 驗證尚待執行，不以本文件存在宣稱已部署。產品 `0.03`、npm `0.0.3`、API 契約 `utsp-studio/0.03`。

## 本版交付

- 新匯入先整理世界重要性，再按具名角色完成八模組、核心錨點、命名／關係、補全與生成範圍；最後以原始來源逐段做獨立忠實度審核。閱讀完成後自動產生整合審核表，不先要求作者填世界。
- 首次表單可修改摘要、核心、命名、受眾／探索、視覺規範及重大疑義；補全與生成範圍逐項接受／拒絕。依據及獨立審核備註唯讀，作者以處理決定回應。修改會使舊核准、視覺與翻譯失效。
- 明確區分：儲存草稿、本人核准設定、本人核准同版視覺、最後啟用。核准提交使用畫面看過的 revision／recordVersion／hash，模型不能自簽核准；核准、不可變 snapshot 與 audit 同交易提交。
- 來源圖像私人保存，實際像素進視覺理解、參考生圖與視覺 QA；沒有圖像就標明文字推導。PNG/JPEG/WebP 最多 6 張、每張 2 MB、合計 6 MB；同圖可重傳修復私有物件，保留世界內容核准與檢視狀態。
- Source 與審核表跨分頁保留；API 失敗不清空修改或剩餘圖片。AI 對話修改進待審模組，不能只改舊版 flat 欄位後被新表單覆寫。
- 一個 Queue delivery 最多一個角色呼叫；角色輸出、動態引用及輸入 hash 在 checkpoint 前驗證。錯誤快取可失效重做；模型成功結果先保存，再寫用量帳本，後續故障復原沿用原 usage reservation。R2 本身寫入失敗仍可能已消耗模型費用，帳本保留 uncertain，不宣稱零消耗。
- 原文來源、角色解析、來源圖像、核准快照、usage 與 audit 都保留在私人側；公開 DTO 不含補全身分、來源全文、內部 prompt 或審核紀錄。

## 本機與介面驗證

- 規格審查原列角色模組／引用、核心引據、探索起點、同名誤合併、快取重試問題皆已修復並複審。
- 本機完整 145 個測試（12 個檔案）、typecheck、production build、format check 通過；npm audit 為 0 vulnerabilities。包含 source reading／visual generation／QA 的 durable checkpoint、ledger 補帳、作者補充失效及 CAS 核准回歸。
- 規格與程式品質複審均 PASS；先前列出的核准競態、同名誤合併、錯誤快取、來源圖修復、對話資料同步與用量故障續跑問題均已修復。
- FlyPig canonical lane 已讀回正確帳戶；桌面 1440px 與手機 393px 的隔離介面 fixture 驗證無頁面水平溢出。未儲存文字、待上傳圖可跨分頁保留；核准勾選預設為否；設定核准後若視覺未核准，啟用仍禁用。
- 這些介面操作僅作用於隔離 fixture，沒有替任何真實作品核准、啟用或發布。測試 IP 未被本輪自動續跑。

## 資料與部署契約

- Migration `0005_world_framework.sql` 新增 `world_snapshots`、`analysis_checkpoints`、`source_images`。不改既有原作內容、不重寫歷史核准、不喚醒舊待確認工作。
- 新 `/framework`、`/framework-approval`、`/analyze`、`/source-images` 為 owner-only；world detail 增加 `frameworkHash`。最終 `/confirm` 需明確的 recordVersion 與 hash，來源／視覺／設定核准都須同版。
- GitHub main 依序執行 dev migration／Worker／前端讀回，再執行 production 同版本流程。尚未核對的 live 項目不能標為通過；不從本機直接 deploy。

## 範圍與限制

- 八模組目前以結構化摘要、錨點、關係與規則邊界保存，完整 PRD 的每個概念欄位尚未各自建表；以實際 Zod 型別為資料契約。
- Word/PDF／網頁仍以文字匯入為主；本版不自動擷取全部內嵌圖片，也未交付完整 OCR。作者需補上要用於校準的原圖。
- 無可靠證據時，跨片段同名元素保留來源 scope 與獨立 ID，不自動斷言同一身分；命名角色可檢視歧義，完整人工合併工具仍未交付。
- 超過單次全局整合預算的來源會保留原文與閱讀進度，請求縮小本次範圍，不截斷後宣稱讀完；完整長篇階層編譯仍待擴充。
- 每日自主探索、持續模擬、訂閱寄送與美術集未在本版啟用。
