# v0.02 解析對話與首次確認

狀態：2026-10-27 實作與驗收中，尚待 GitHub 自動部署。產品版本 `0.02`，資料契約 `utsp-studio/0.02`，npm 工具版本 `0.0.2`。

## 變更

- 首次解析方向表單：年代／範圍／視覺／作者補充，原文與補充分開；閱讀中可儲存，編譯前須本人確認。
- 閱讀產生建議；引句無法驗證時保存候選並進入待確認視窗，逐項更正引句、作者確認或排除後續跑。
- 一般 import 錯誤轉為待確認對話；待確認不重複呼叫模型，不重讀完成片段，不冒充全讀完成。
- Migration 0004 新增私人 import_reviews、waiting_user 去重，並將既有 failed import 恢復成對話；已有 repair checkpoint 可直接恢復疑義。
- 使用者決定、source coverage、job、messages、audit 與 outbox 原子提交；作者補充使用 user provenance，不捏造引句。
- Studio 與 API 共用產品版本常數；版本測試核對 VERSION／npm metadata；CI 讀回實際 product version／contract／commit。

## 已驗證與待驗證

- 修改前 live：dev 原作完成 4/15，production 6/15；均遇到 EVIDENCE_QUOTE_INVALID。原始全文仍保存，不需重匯。
- 本機 68 個測試、typecheck、production build、format 與 npm audit（0 vulnerabilities）通過；規格與品質複審均 PASS。涵蓋證據排除定義殘留、一般錯誤候選復原、延遲 worker、完成交易切點、無效 compiler cache 與 legacy migration。
- 已以 FlyPig canonical lane 及隔離前端 fixture 讀回待確認 dialog、明確選擇、可編輯主張／引句、表單欄長、送出失敗保留輸入；該 QA 不會修改真實 IP。瀏覽器背景視窗使 RAF 等待逾時，改以 DOM 狀態讀回核對；不將此視為 live 作者確認。
- GitHub run、dev／production deployed schema/code/API 及實際舊工作轉換仍待部署後讀回。
- 不代替作者回答 NEO BABYLON 的疑義或核准風格／翻譯；未宣稱公開世界已完成上線。
