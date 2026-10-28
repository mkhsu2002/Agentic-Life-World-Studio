# v0.06 六項創作簡報

狀態：2026-10-27，GitHub main 發布完成，雙環境與真實模型中性原文 smoke 已驗證。產品 0.06／npm 0.0.6，API utsp-studio/0.06、簡報 world-brief/0.06。

## 本版改動

- 先更新 PRD 1.2，再以六項 AI 預填取代八模組、完整元素萃取、逐項補全／生成範圍與探索起點 ID 審核。舊 PRD／操作／設計已封存標記，不再代表新匯入。
- 精簡閱讀→編輯→一個視覺方向→獨立忠實度核對。只取會改變公開畫面、旅行敘述或創作界線的少量線索；原作可沒有生物／地點，未知合法。
- 必要裁定最多五題，無問題可直接確認。AI 建議與作者答案分離，模型答案會清空；合併重複問題，避免快取後無法完成。
- 簡報儲存／核准採版本、recordVersion 與內容 hash，原子保存 snapshot／approval／audit。對話修改僅更新六段草稿，不能代答或簽核准。
- 整體世界試稿不要求先有元素；選個別已知元素仍正確帶入生成 prompt／input hash。設定、視覺及最後啟用維持本人明確操作。
- 新簡報公開介紹只使用核准的基本樣貌改寫，保留 public DTO whitelist；私有六項、裁定、證據與核准不進公開資料。
- 舊原文、核准／發布快照及舊進行中 job 相容；作者手動重整才走新解析。沿用 JSON storage 與 migrations 0001–0005，不需新增 SQL migration；雙環境需同版 API／frontend。

## 本機驗證與限制

- 獨立規格與程式品質複審通過。修復選定元素未進生圖 prompt、重複裁定穩定 ID 碰撞兩項 P2，新增回歸測試。
- 解析測試涵蓋兩種不同中性原作、零裁定、清空 AI 回答、單 delivery 單模型、真原文／圖片依據、ledger／R2／checkpoint 重試、最終 CAS 與交易回滾。未使用真實作品作硬編範例。
- 既有翻譯／視覺沿用現行執行流程；六項解析的每 delivery 單角色與完整故障成本保證不擴大宣稱到所有出版工作。
- 每日自主探索、訂閱寄送與美術集排程仍屬後續。

- 完整 188 個測試（14 個檔案）、typecheck、production build、format 與 npm audit 通過，0 vulnerabilities。
- FlyPig canonical lane 帳戶已讀回；中性本機 fixture 的 DOM 互動驗證包含六段預填、零題核准預設否、採用建議後必須儲存、同版核准、未存內容跨 tab 保留、stale snapshot 在送出前阻擋且保留草稿。桌面 1440px／手機 393px 無水平溢出。
- fixture 測試只作用於 localhost，不核准正式作品。瀏覽器背景視窗的原生點擊穩定性檢查受到頁面暫停影響，因此改用 DOM 事件驗證狀態及 API；未宣稱完成所有原生滑鼠操作 e2e。

## 部署與線上讀回

- GitHub [run 40631355403](https://github.com/mkhsu2002/Agentic-Life-World-Studio/actions/runs/40631355403) 成功，dev／production 均部署程式 commit `bff78adb68cd4dfba4e9f5ed730dfb6fd624d9c3`；產品 `0.06`、契約 `utsp-studio/0.06`，Git tag `v0.06` 指向此測過的程式 commit。
- 重新查核兩環境 BUILD_REVISION、ASSETS／DB／R2／Queue／必要 secret 名稱、migrations 0001–0005，均一致。health／private overview 401／HTML／JS 讀回通過，前端同為 `/assets/index-ZTQk5li0.js` 且包含六項新流程文案。
- 正式 Studio 顯示 v0.06 與「用六項重新整理」手動入口，不再顯示舊八模組表；沒有替既有作品送出重新整理、裁定、核准或啟用。正式新 `/brief` API 無效輸入實測回 422，未寫入內容。
- dev 以一段獨立中性文字進行真實模型新匯入，完成 1/1 閱讀與 5/5 步驟：六段非空、零必要裁定、零預萃取元素、一個已預填風格，狀態 draft；無 framework、無任何設定或視覺核准。
- 真實執行 reader／editor／visual／fidelity 四筆 usage ledger 皆 incurred，四個 checkpoint、一筆 brief.compiled audit；approvals／world_snapshots／releases 都為零。錯誤 hash 的核准請求拒絕 409，沒有產生核准紀錄。
- 這個 smoke 只在 dev 新中性世界執行，不生成圖片、不啟用、不公開；未重跑正式原作。
