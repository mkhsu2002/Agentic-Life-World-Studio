# v0.05 世界審核與核准入口

> 狀態：2026-10-27 封存。本文件為重新規劃前的既有文件，僅供查核既有資源與歷史版本；不代表新產品需求或繼續開發的授權。新規劃以 `docs/PRD.md` 的待確認提案為準。

狀態：2026-10-27，GitHub main 發布完成，dev／production 與正式 Studio 頁面已讀回驗證。產品 `0.05`、npm `0.0.5`，API 契約維持 `utsp-studio/0.03`。

## 修正

- 原作閱讀完成、世界整理尚在執行時，舊介面已顯示「待核准」並只有停用的建表按鈕。各分頁現在顯示真正的整理進度、等待原因與後續入口，不把閱讀覆蓋完成誤當審核表已完成。
- 完成後顯示開啟審核表入口；審核表頂部可直達核准區、補全與待處理事項。設定核准後指向視覺校準，同版視覺核准後指向最後啟用。
- 移除只存在本次元件生命週期的「已再儲存一次」條件。條件齊全且已持久化的版本可由作者勾選並核准；核准仍預設不勾選，仍以 revision／recordVersion／hash 檢查競態。未儲存、重大事項、待決補全、無效起點與關係、缺少視覺方向均不得核准，並列出具體原因及入口。
- 原作已讀完、無進行中工作卻缺少審核表時，可由本人手動復原，不再因 reading 狀態永久停用；有進行中工作時仍禁止重送。
- 後端欄位、核准 API 與 schema 沒有變更；不新增 migration，不自動回答疑義、核准、啟用或重跑原作。

## 驗證

- 本機 156 個測試、typecheck、production build、Prettier 格式檢查通過，npm audit 為 0 vulnerabilities。
- FlyPig canonical lane 已讀回正確帳戶；中性本機 fixture 於 393px 手機尺寸驗證：整理進度／分頁標記、禁止重送、核准快速跳轉、缺漏清單、視覺分頁導引、未儲存禁止核准及切換分頁保留草稿，無水平溢出。
- 隔離 fixture 驗證已儲存設定不需額外 save，預設不勾選，勾選後只提交一次 framework-approval，再顯示視覺校準入口。此操作僅作用於中性 fixture，沒有提交任何正式世界核准。
- GitHub [run 40615043503](https://github.com/mkhsu2002/Agentic-Life-World-Studio/actions/runs/40615043503) 成功，依序部署 dev／production。兩環境 health 讀回 `0.05`、契約 `utsp-studio/0.03`、程式 commit `2abd693bc21c578a8c36a5d5e19c98f6aa413989`；Git tag `v0.05` 指向此程式 commit。
- 部署後再次查核兩環境 BUILD_REVISION、ASSETS／DB／R2／Queue、必要 secret 名稱與 migrations 0001–0005；私人 overview 保持 401，前端 bundle 可正常讀取。
- 正式 Studio 已實際讀回「正在整理世界設定」、「世界審核 整理中」及更新中的步驟進度。這是作者先前已啟動的工作；本輪沒有代送分析、核准或啟用。
- 桌面 1440px 與手機 393px 皆無水平溢出；手機核准捷徑可將核准區帶入可見範圍。
