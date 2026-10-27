# v0.02 解析對話與首次確認

狀態：2026-10-27 程式與兩環境部署驗證完成；真實 IP 待作者確認。產品版本 `0.02`，資料契約 `utsp-studio/0.02`，npm 工具版本 `0.0.2`。

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
- GitHub dev run [40599077244](https://github.com/mkhsu2002/Agentic-Life-World-Studio/actions/runs/40599077244) 與 main run [40599277685](https://github.com/mkhsu2002/Agentic-Life-World-Studio/actions/runs/40599277685) 均成功；兩環境讀回程式 commit `428acc88c40660da14c6586319d49e58acc3ab64`、product `0.02`、contract `utsp-studio/0.02`。
- 兩環境實際 migrations 0001–0004、D1／R2／Queue／assets bindings 與三個必要 secret 名稱均讀回；health、私人 API 401、HTML／JS bundle 由 CI 讀回。
- live 舊工作已由 failed 轉 waiting_user：dev 保留 4/15、6 個疑義；production 保留 6/15、5 個疑義。原文 hash 均維持 `aa8e6b91ac4652999aefa66932358fb242d6afc3d0f80c3e84ba90140eed2fa4`。
- 兩環境各有 1 筆 open review、1 筆 import.needs_input audit、1 則 assistant 對話；原 usage ledger 仍保存（dev 9 筆、production 14 筆）。復原只讀取既有候選，沒有代替作者做決定或新增模型請求。
- 隔離 UI fixture 已實查桌面／393px 手機，無水平溢出、Escape 關閉／重開與失敗保留輸入；原生 dialog 保持背景不可操作。未在真實 IP 上提交測試決定。
- 首次 feature 提交漏納入 migration0004，CI check 失敗且該 run 已取消，dev／production 部署步驟均 skipped；補齊後才通過並部署。未使用本機 wrangler deploy。
- 不代替作者回答 NEO BABYLON 的疑義或核准風格／翻譯；未宣稱公開世界已完成上線。
