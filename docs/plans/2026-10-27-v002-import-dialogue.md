# v0.02 解析對話與首次確認表單

狀態：2026-10-27 實作中。使用者已明確要求遇到解析疑義時交互確認並續跑，不再直接失敗。沿用既有部署工作流、測試與資料契約，僅補專案特定流程。

## 設計

來源保存與逐段 coverage 不變。新增私人 `import_reviews`，問題、待確認抽取與使用者決定持久化；工作狀態增加 `waiting_user`。每個引句問題提供原文、待核對主張、引句及三種處理：更正原文引句、明確標為作者補充、排除該項。作者補充不能偽裝成原文證據；排除主張也須移除相關定義殘留。原文不被覆寫，未確認片段不增加 coverage。

首次匯入提供年代／探索範圍／視覺方向／作者補充表單。閱讀過程產生建議，但建議不等於正典。表單可於 reading 階段儲存，不得把世界提前改為 draft。編譯前必須確認表單；編譯使用最新表單與已確認的逐段證據。一般模型／解析錯誤也轉為待確認，提供說明與重試，避免無人處理的 failed。

## 交付與驗證

- [ ] 先寫引句處理回歸：有效原文、替代引句、作者補充、排除、未知／缺少決定。
- [ ] Migration 0004 新表、waiting_user 去重與既有失敗 import 復原；保留來源、進度、帳本。
- [ ] Queue checkpoint 與使用者決定交易；重複／並行決定只續跑一次，待確認不消耗模型。
- [ ] Owner API 回傳待確認內容與建議；brief 儲存／解決疑義時同步 messages、audit、outbox。
- [ ] Studio 首次表單、待確認視窗、自動提示、保存／返回／續跑及無障礙。
- [ ] 先規格再品質複審，完整 tests/typecheck/build/audit。
- [ ] VERSION／Studio／API／README／release 版本同步為 v0.02。
- [ ] Push main → GitHub 自動 migration／deploy dev 及 production；交叉讀回 migration、binding、程式 commit、live 待確認與前端。

本次不代替作者決定 NEO BABYLON 的疑義，不把 waiting_user 視為完整匯入或已確認世界。公開網站 DTO 不包含私人表單、解析候選、原文或對話。
