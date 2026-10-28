# v0.06 六項創作簡報 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this approved plan task-by-task. Each implementer owns separate files; root integrates and reviews before publishing.

**Goal:** AI 先填六段創作簡報，只問必要的作者裁定，保留顯式設定／視覺／啟用核准。

**Architecture:** 新增 world-brief/0.06 契約與簡報解析，不再用八模組萃取新匯入。舊 pipeline／snapshot 保留讀取相容；新簡報獨立 hash 與核准，公開投影延用既有安全 DTO。

**Tech Stack:** TypeScript／Zod、React、Hono、Cloudflare D1／R2／Queues；GitHub 發布。

- [ ] 先更新 PRD，封存歷史八模組設計並標示取代狀態。
- [ ] 根代理：先寫契約／核准失敗測試，再實作六項 schema、API、hash、owner-only 修改、原子 snapshot／audit。
- [ ] 解析實作者：先寫精簡萃取／必要裁定／checkpoint 測試，再實作分段閱讀、編輯、視覺、忠實度角色；每 delivery 一次模型呼叫，用量可恢復。
- [ ] 介面實作者：先寫六項／必要裁定／核准邊界測試，再替換八模組確認頁與導引，保留未存草稿、視覺與 legacy 入口。
- [ ] 根代理：串接新匯入與手動重新整理、對話、視覺／翻譯／發布相容；移除新流程對完整元素庫與起點 ID 的依賴。
- [ ] 規格與品質獨立複審，修復後跑完整測試、型別、build、format、audit，桌面／手機 fixture 操作。
- [ ] 同步 VERSION／npm／README／OPERATIONS／release 為 v0.06，檢查過期文案。
- [ ] GitHub commit／push，雙環境 schema／bindings／deployed code／frontend／live 驗證；不代替作者核准或重新解析既有 IP。
