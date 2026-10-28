> 狀態：2026-10-27 封存。本文件為重新規劃前的既有文件，僅供查核既有資源與歷史版本；不代表新產品需求或繼續開發的授權。新規劃以 `docs/PRD.md` 的待確認提案為準。

> 歷史設計：2026-10-27 起由 [PRD 1.2](../PRD.md) 的六項創作簡報取代。舊契約僅保留歷史資料與進行中工作的相容，不得用作新匯入規格。

# 世界資料契約｜v0.03 設計草案

狀態：2026-10-27，框架已由使用者確認並進入 v0.03 實作。本文保留完整邏輯設計；實際 runtime 使用 `src/shared/world-framework.ts` 的模組摘要、核心錨點、元素關係、補全／生成邊界與審核契約，並非把每個概念表格各建一張 SQL 表。部署與實測狀態以 [v0.03 release](../RELEASE-v0.03.md) 為準。

世界參數以 [世界框架](WORLD-FRAMEWORK-v0.03.md) 為準。結構化資料的目的，是保存定義與關係、限制生成並支援版本化審核，不是將每段原文轉成必填欄位。

## 1. 世界根結構

| 結構 | 核心欄位 | 用途 |
|---|---|---|
| `WorldDefinitionDraft` | `world_id`、`revision`、`parent_revision`、`source_manifest_id`、`framework_modules`、`registry_revision`、`naming_policy_revision`、`visual_bible_revision`、`exploration_policy_revision`、`extension_manifest_revision` | 串起八個世界模組及其私有提案。草稿不能充當執行世界。 |
| `FrameworkModule` | `module_key`、`relevance`、`summary`、`field_ids`、`entity_ids`、`constraint_ids`、`open_issue_ids` | 八個固定判讀面向；模組內容與類型動態。`relevance` 區分核心、支援、目前無關與不適用。 |
| `DefinitionField` | `field_id`、`key`、`value_type`、`value`、`knowledge_status`、`basis`、`evidence_ids`、`dependency_ids`、`scope`、`valid_time`、`impact`、`review_status` | 共用欄位封套，保留局部依據、適用時間與影響。模組摘要也必須由可回查欄位支持。 |
| `ApprovedWorldVersion` | `world_id`、`revision`、`definition_hash`、`approval_id`、`source_manifest_hash`、`initial_state_hash`、`approved_at` | 不可變執行基準。資料及其依賴版本須與本人核准的內容完全相同。 |

`knowledge_status` 為 `known / unknown / not_applicable`。`basis` 分開保存 `source_explicit / source_inferred / author_supplied / proposed_extension`；作者核准只改審核狀態，不把推論或補全改寫為原作明示。角色傳聞、夢境、否定與假設另存敘述立場，不能當作世界真值。

`review_status` 為 `draft / needs_confirmation / accepted / rejected / stale`；`accepted` 只表示該欄位已依流程處理，不足以單獨啟動世界，仍需完整版本核准。

`value_type` 只接受允許的結構化型別：文字、具單位數值、布林、時間／範圍、實體引用與上述型別的受限集合。空集合不是「未知」的替代值；不得允許任意可執行程式或無契約 JSON 作為法則。

## 2. 中央元素庫與關係

| 結構 | 核心欄位 | 約束 |
|---|---|---|
| `ElementDefinition` | `element_id`、`world_id`、`revision`、`kind_id`、`original_name`、`aliases`、`definition_field_ids`、`visual_feature_ids`、`variant_constraints` | 穩定 ID 不隨語言變更；物種、個體、地點、設施等透過動態類型區別，不能混用共同特徵與一次觀察。 |
| `WorldRelation` | `relation_id`、`subject_id`、`predicate_id`、`object_id_or_value`、`scope`、`conditions`、`valid_time`、`basis`、`evidence_ids` | 述詞有明確定義與值型別；所有引用必須同世界且在指定版本存在。 |
| `NamingPolicy` | `policy_id`、`revision`、`scope_selector`、`formation_rules`、`translation_strategy`、`forbidden_forms`、`basis` | 命名規範按動態類型、區域或文化套用，不從展示案例複製字首、數量或音節。 |
| `LocalizedElementText` | `element_id`、`definition_revision`、`locale`、`name`、`aliases`、`description`、`term_policy_revision`、`source_hash`、`review_status` | 初期目標 en／zh-Hant／ja；版本或語意依賴變更即 stale，不能引用其他語系舊特色繼續發布。 |

區域層級、棲地、資源、互動與文明影響使用同一組有型別的關係。硬約束與可疑推論分開，未知位置不強制補經緯度。關係圖是邏輯設計，不要求新增圖資料庫。

## 3. 視覺與探索設定

`VisualBible` 保存 `reference_asset_ids`、`reference_read_status`、`text_evidence_ids`、`medium`、`form_material_scale`、`color_light_atmosphere`、`regional_variants`、`invariants`、`forbidden_motifs`、`preview_asset_ids`、`revision`。引用圖片必須能回查檢視狀態；圖片未讀到時不可產生已觀察視覺證據。

`ExplorationPolicy` 保存 `audience_proposal`、`tone_and_intensity`、`focus`、`observer_profile`、`knowledge_boundary`、`disclosure_policy`、`intervention_policy`。受眾定位與幕後理由屬私人產品設定，不作世界事實。

`InitialState` 保存 `spec_revision`、`world_time`、`start_place_id`、`entity_states`、`observer_knowledge`。穩定定義留在元素庫；當下位置與狀態放在 state；觀察者所知不能直接複製全部 world truth。

`TransitionPolicy` 保存 `state_variable_definitions`、`trigger_conditions`、`allowed_operations`、`preconditions`、`invariants`。模型提出事件，runtime 依白名單操作、關係、版本及範圍檢查後才能提交。此處定義未來運行邊界，不表示 v0.03 同時交付自主模擬。

## 4. 忠實補全與本人核准

| 結構 | 核心欄位 |
|---|---|
| `CoreAnchor` | `anchor_id`、`target_field_ids`、`meaning`、`constraints`、`evidence_ids`、`author_decision_id` |
| `ExtensionProposal` | `proposal_id`、`target_scope`、`proposed_field_ids`、`supporting_anchor_ids`、`reason`、`dependencies`、`limits`、`review_status` |
| `GenerationEnvelope` | `envelope_id`、`allowed_scopes`、`allowed_kinds`、`allowed_operations`、`field_constraints`、`naming_policy_revision`、`visual_constraints`、`prohibited_changes`、`review_status` |
| `InitialReviewManifest` | `manifest_id`、`draft_revision`、`core_anchor_ids`、`extension_proposal_ids`、`generation_envelope_ids`、`visual_bible_revision`、`exploration_policy_revision`、`initial_state_hash`、`dependency_hashes`、`blocking_issue_ids`、`content_hash` |
| `HumanApproval` | `approval_id`、`actor_id`、`manifest_id`、`content_hash`、`decision`、`recorded_at` |

`GenerationEnvelope` 的所有邊界採預設拒絕：未列入的類型、操作、範圍或欄位不能自行生成。若某類實體只有少數已核准成員，不代表允許新增其他成員；若允許新增，必須明列形態、區域、關係與命名限制。不能只以「符合風格」「合乎常理」或一個相似度分數作為權限邊界。數量上限如有必要，由本世界的核准方案指定，不固定於通用 schema。

核准由 authenticated Studio 操作觸發；模型只能提出方案。伺服器在同一交易中核對 manifest、依賴版本與阻擋項，寫入決定、不可變版本、audit 及必要 outbox。重複送出沿用同一次核准結果；任一內容或依賴改變就不能沿用原 hash 的核准。部分核准只表示草稿進度，不產生虛假的完整世界核准。

作者若否決補全，移除該補全及其依賴成果，不必重讀未受影響的來源。已核准核心只允許作者明確發起新版本、審查差異後變更，Agent 不能替作者操作。

## 5. 疑義、可續跑與證據

`ReviewIssue` 保存 `issue_id`、`affected_field_ids`、`impact`、`source_locator_ids`、`summary`、`recommended_resolution`、`alternatives`、`blocking_scope`、`status`。確認請求以世界模組整合，避免把每個引句差異都交給作者。

`EvidenceReference` 保存原始來源版本、頁／段／圖片 locator 與閱讀狀態。引句是輔助呈現，來源定位與實際可支持的意義才是判斷依據。定位修復、推論依賴及作者補充各自留紀錄；無法驗證的證據不得標成已驗證。

`TaskCheckpoint` 固定記錄任務角色、輸入 revision/hash、覆蓋範圍、輸出參照、阻擋項與成本。依賴變更只使受影響產物 stale；錯誤恢復不可再次提交已成立的核准、事件或計費紀錄。

## 6. 公開資料投影

公開 `PublicWorldView` 只允許 `world_public_id`、`title`、`introduction`、`locale`、`places`、`elements`、`observations`、`published_assets` 及讀者所需的世界內資訊；每次查詢限定核准 release 與該 locale 的相容版本。

永遠不從 private draft 直接序列化公開資料。來源依據、basis、review status、extension 身分、私有信心、audience 推斷、prompt、Agent 輸出與 audit 都不在白名單。世界內傳聞可以依觀察與揭露政策公開，但不能把內部驗證失敗偽裝成傳聞來繞過核准。

發布 manifest 必須綁定 world、registry、visual、locale 與 renderer 版本。新核心設定只建立新候選 release，通過同步與公開讀回後才切換 active release；不能新前端配舊 API 或讓舊譯文繼續描述新定義。

## 7. 實作前需滿足的資料契約驗收

框架確認後，v0.03 實作須驗證：不同題材可使用相同結構；不適用與未知不混用；無權限的補全被拒絕；核心不能由 Agent 改寫；舊 hash 不能核准新內容；個體觀察不覆寫類型定義；翻譯不修改世界真值；公開投影不含私有欄位；失敗後保留進度且 audit、job、usage 與畫面一致。

這些是契約驗收要求，通過項目以 release 的實測紀錄為準。v0.03 實際新增 migration0005 與世界審核 API，所需兩環境同步狀態見 release。
