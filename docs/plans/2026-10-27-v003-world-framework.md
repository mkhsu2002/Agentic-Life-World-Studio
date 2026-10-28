# v0.03 世界解析、首次確認與視覺校準實作計畫

> 狀態：2026-10-27 封存。本文件為重新規劃前的既有文件，僅供查核既有資源與歷史版本；不代表新產品需求或繼續開發的授權。新規劃以 `docs/PRD.md` 的待確認提案為準。

> 採 writing-plans、test-driven-development 與 subagent-driven-development，持續完成實作與兩階段審查；本輪使用者已核准框架及實作，不再要求重複授權。

**目標：**Studio 先理解世界，再呈現八模組與補全審核；核心與補全由作者明確確認，視覺校準與最終啟用另有同版本核准。

**架構：**沿用 React/Hono/D1/R2/Queues。新增版本化世界框架、私有來源圖像與不可變審核快照；來源閱讀提供全局線索，具名角色分段執行、checkpoint 續跑。作者修改即使舊核准失效，模型沒有核准權限。

**技術：**現有 TypeScript/Zod 與 Meta API；程式版本 0.03，資料契約 utsp-studio/0.03；發布只由 GitHub 觸發兩環境遷移、部署及讀回。

## 1. 契約與核准邊界

- [x] 在 `tests/world-framework.test.ts` 先驗證八模組完整性、未知／不適用、補全待決、拒絕範圍、過期核准與編輯失效；執行 `npx vitest run tests/world-framework.test.ts` 確認先失敗。
- [x] 建立 `src/shared/world-framework.ts`，將 `framework`、`frameworkApproval`、來源圖像與 visual manifest 型別接入 `src/shared/contracts.ts`。
- [x] 建立 `src/server/world-framework.ts`：`frameworkHash(world)`、`assertFrameworkReviewed(world)`、`validateFrameworkReview(world)`；hash 包含世界內容、元素、命名、視覺版本及參考圖，排除時間戳、工作與翻譯。
- [x] 新增 `migrations/0005_world_framework.sql` 保存 framework snapshots、角色 checkpoints 與 source references；核准由 transaction 寫 snapshot、approval、audit。

## 2. 世界理解與多角色工作流

- [x] 在 `tests/api.test.ts` 先寫新工作流與重試測試，驗證 draft 不能啟用、局部錯誤保留成果、模型無權核准。
- [x] 建立 `src/server/world-analysis.ts`：總架構提案 → 專業模組 → 命名整合 → 獨立來源審核；每個 Queue 訊息最多執行一個角色，依輸入 hash 快取並記錄 usage。
- [x] 更新 `jobs.ts` 與 `prompts.ts`：世界重要性先於名詞數量；引句修復失敗不再把瑣碎格式錯誤交作者，而以未驗證候選交高影響審核；不能靜默升格成原作事實。
- [x] 原作閱讀完成自動產生首次世界方案；解析方向是可選補充，不能要求作者先替 AI 建世界。舊世界需作者手動選擇重新整理，既有待確認工作不自動恢復或解析測試 IP。

## 3. Studio 表單與視覺

- [x] 建立 `src/client/world-review.tsx`，八模組、核心、補全與生成範圍、命名、受眾／探索、疑義與建議可修改；未儲存修改／待決補全不可核准。
- [x] 新增 `src/server/world-routes.ts`，提供框架儲存／同 hash 核准／手動重新整理與來源圖像入口；細粒度 record version 防止覆寫背景工作。
- [x] 修改 `world-panels.tsx` 與 `studio.tsx`，首次表單、來源進度、角色進度與下一步清楚可見；核准設定後才能視覺試稿，試稿和最終啟用仍須本人核准。
- [x] 來源圖像只能私人讀取。實際圖像送視覺理解；文檔未擷取圖片時明示限制並可補上圖片，不宣稱已讀。`meta.ts` 參考圖走官方 Images edits JSON 契約，`tests/meta.test.ts` 驗證請求。

## 4. 驗證、版本與發布

- [x] 執行 `npm run check`、`npm run format:check`、`npm audit --audit-level=moderate`；進行桌面／手機 UI 驗證，送出失敗保留表單，審查公開 DTO 與文案不含內部欄位。
- [x] 同步 VERSION、package metadata、API health／verification script、README、設計狀態與 RELEASE-v0.03；歷史文件只加狀態註記。
- [x] 規格審查通過後進行程式品質審查，修復後再跑相關測試。
- [x] commit、合併 main、push，由 GitHub 部署 dev 與 production；核對 migration0005、bindings、secret 名稱、health、前端 bundle、私人 API與核准 audit。新建中性測試草稿可做 live smoke test，但不代替作者核准真實世界。
- [x] 完成產品 tag v0.03 與發布紀錄，提供正式 Studio 連結；若 live 失敗先修復，不宣告完成。

完成狀態：2026-10-27，146 tests、規格／品質複審、兩環境 migration/API/frontend/readback 與 dev 真實解析通過。未代作者核准或啟用真實作品；具體證據與限制見 RELEASE-v0.03.md。
