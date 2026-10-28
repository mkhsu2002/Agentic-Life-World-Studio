import { useEffect, useState, type FormEvent } from "react";
import { Check, CheckCircle2, ShieldCheck, RefreshCw } from "lucide-react";
import type { WorldDetail, WorldDraft } from "../shared/contracts";
import {
  frameworkSchema,
  moduleLabels,
  type WorldFramework,
} from "../shared/world-framework";
import { patch, post } from "./api";
import type { RunAction } from "./studio";

const worldPath = (id: string) => `/api/worlds/${encodeURIComponent(id)}`;
const basisNames = {
  source_explicit: "原文明示",
  source_inferred: "依原文推論",
  author_supplied: "本人補充",
  proposed_extension: "建議補全",
};
const statusNames = {
  known: "已知",
  unknown: "原作未交代",
  not_applicable: "不適用",
};
const decisionNames = {
  pending: "待本人決定",
  accepted: "接受",
  rejected: "拒絕",
};
const namingLabels = {
  world: "世界命名原則",
  places: "地點命名",
  life: "生命與行動者命名",
  objects: "物件命名",
  translation: "跨語系名稱原則",
};
const audienceLabels = { intent: "讀者與體驗目的", tone: "敘述語氣" };
const explorationLabels = {
  observer: "觀察者身分",
  knowledgeBoundary: "可知範圍",
  disclosure: "資訊揭露方式",
  intervention: "介入程度",
  startTime: "探索起始時間",
  startPlace: "探索起始地點",
  initialConditions: "初始條件",
  allowedTransitions: "允許的移動與轉換",
};

export function assertReviewSnapshot(latest: WorldDetail, shown: WorldDetail) {
  if (
    latest.world.id !== shown.world.id ||
    latest.world.revision !== shown.world.revision ||
    latest.world.recordVersion !== shown.world.recordVersion ||
    latest.frameworkHash !== shown.frameworkHash
  ) {
    throw new Error(
      "世界版本已更新；你的表單內容仍保留。請先檢查最新版本，再重新儲存或核准。",
    );
  }
}
export function frameworkReviewReady(world: WorldDraft) {
  const f = world.framework;
  return (
    !!f &&
    frameworkSchema.safeParse(f).success &&
    ![...f.extensions, ...f.envelopes].some(
      (item) => item.decision === "pending",
    ) &&
    !f.issues.some((issue) => issue.blocking && !issue.resolution.trim()) &&
    world.elements.some((element) => element.id === f.exploration.startPlace) &&
    f.relations.every(
      (relation) =>
        world.elements.some((element) => element.id === relation.subjectId) &&
        world.elements.some((element) => element.id === relation.objectId),
    )
  );
}
export function isFrameworkApproved(detail: WorldDetail) {
  return (
    !!detail.world.framework &&
    !!detail.frameworkHash &&
    detail.world.frameworkApproval?.revision === detail.world.revision &&
    detail.world.frameworkApproval.hash === detail.frameworkHash
  );
}
function TextField({
  label,
  value,
  onChange,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <textarea
        aria-label={label}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        maxLength={6000}
      />
    </label>
  );
}
function LinesField({
  label,
  values,
  onChange,
  required = false,
}: {
  label: string;
  values: string[];
  onChange: (value: string[]) => void;
  required?: boolean;
}) {
  return (
    <TextField
      label={`${label}（每行一項）`}
      value={values.join("\n")}
      required={required}
      onChange={(value) => onChange(value ? value.split("\n") : [])}
    />
  );
}
function Evidence({
  items,
}: {
  items: { segmentId: string; quote: string }[];
}) {
  return items.length ? (
    <details className="review-evidence">
      <summary>查看原文依據（{items.length}）</summary>
      {items.map((item, index) => (
        <blockquote key={index}>
          {item.quote}
          <small>來源片段：{item.segmentId}</small>
        </blockquote>
      ))}
    </details>
  ) : (
    <p className="field-note">此項沒有直接原文引句，請依標示的依據核對。</p>
  );
}
function DecisionField({
  value,
  onChange,
}: {
  value: keyof typeof decisionNames;
  onChange: (value: keyof typeof decisionNames) => void;
}) {
  return (
    <label>
      本人的決定
      <select
        aria-label="本人的決定"
        value={value}
        onChange={(event) =>
          onChange(event.target.value as keyof typeof decisionNames)
        }
      >
        {Object.entries(decisionNames).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function WorldReview({
  detail,
  run,
  busy,
  onNavigate,
}: {
  detail: WorldDetail;
  run: RunAction;
  busy: boolean;
  onNavigate?: (tab: string) => void;
}) {
  const { world, source } = detail;
  const [draft, setDraft] = useState<WorldFramework | undefined>(
    () => world.framework && structuredClone(world.framework),
  );
  const [shown, setShown] = useState(detail);
  const [dirty, setDirty] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    if (dirty) return;
    setDraft(detail.world.framework && structuredClone(detail.world.framework));
    setShown(detail);
    setAcknowledged(false);
  }, [
    detail.world.revision,
    detail.world.recordVersion,
    detail.frameworkHash,
    dirty,
  ]);
  const stale =
    shown.world.revision !== world.revision ||
    shown.world.recordVersion !== world.recordVersion ||
    shown.frameworkHash !== detail.frameworkHash;
  const coverageComplete =
    source.segmentCount > 0 && source.processedCount === source.segmentCount;
  const readComplete = coverageComplete && world.status !== "reading";
  const approved = !dirty && !stale && isFrameworkApproved(detail);
  const visualApproved =
    world.visualApproval?.revision === world.revision &&
    world.previews.some(
      (preview) =>
        preview.id === world.visualApproval?.previewId &&
        preview.revision === world.revision &&
        preview.styleId === world.selectedStyleId &&
        preview.review.verdict === "pass",
    );
  const unresolved = draft
    ? [...draft.extensions, ...draft.envelopes].filter(
        (item) => item.decision === "pending",
      ).length +
      draft.issues.filter((issue) => issue.blocking && !issue.resolution.trim())
        .length
    : 0;
  const ready =
    !dirty &&
    !stale &&
    !!draft &&
    frameworkReviewReady({ ...world, framework: draft }) &&
    readComplete &&
    world.styles.some((style) => style.id === world.selectedStyleId) &&
    !!shown.frameworkHash;
  function change(next: WorldFramework) {
    setDraft(next);
    setDirty(true);
    setAcknowledged(false);
    setFormError("");
  }
  function field<K extends keyof WorldFramework>(
    key: K,
    value: WorldFramework[K],
  ) {
    if (draft) change({ ...draft, [key]: value });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = frameworkSchema.safeParse(draft);
    if (!parsed.success) {
      setFormError(
        `請檢查表單：${parsed.error.issues.map((issue) => `${issue.path.join(" / ")}：${issue.message}`).join("；")}`,
      );
      return;
    }
    let savedWorld: WorldDraft | undefined;
    const ok = await run("儲存世界設定", async (latest) => {
      assertReviewSnapshot(latest, shown);
      const result = await patch<{ world: WorldDraft }>(
        `${worldPath(world.id)}/framework`,
        {
          revision: shown.world.revision,
          recordVersion: shown.world.recordVersion,
          framework: parsed.data,
        },
      );
      savedWorld = result.world;
      return result;
    });
    if (ok && savedWorld) {
      setDirty(false);
      setAcknowledged(false);
      setFormError("");
    }
  }
  async function approve() {
    if (!ready || !acknowledged || approved) return;
    await run("核准世界設定", (latest) => {
      assertReviewSnapshot(latest, shown);
      return post(`${worldPath(world.id)}/framework-approval`, {
        revision: shown.world.revision,
        recordVersion: shown.world.recordVersion,
        hash: shown.frameworkHash,
      });
    });
    setAcknowledged(false);
  }
  if (!draft)
    return (
      <div className="tab-content">
        <section className="panel">
          <p className="eyebrow">WORLD REVIEW</p>
          <h2>建立世界的八模組審核表</h2>
          <p className="muted">
            整理完成後，這裡會顯示核心設定、補全與探索範圍的確認表。進行中的整理不需要重複送出；若已停止且原作閱讀完成，可以手動建立審核表。
          </p>
          <button
            className="primary"
            disabled={
              busy ||
              !coverageComplete ||
              detail.jobs.some((job) =>
                ["queued", "running"].includes(job.status),
              )
            }
            onClick={() =>
              void run("整理八模組審核表", (latest) => {
                assertReviewSnapshot(latest, shown);
                return post(`${worldPath(world.id)}/analyze`, {
                  revision: shown.world.revision,
                  recordVersion: shown.world.recordVersion,
                });
              })
            }
          >
            建立八模組審核表
            <RefreshCw size={16} />
          </button>
          {!readComplete && (
            <p className="field-note">
              請先完成原作閱讀及必要的來源確認。原作會自動開始解析，無須先填寫方向。
            </p>
          )}
        </section>
      </div>
    );
  return (
    <div className="tab-content world-review">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR WORLD, YOUR DECISIONS</p>
          <h2>先確認設定，再讓世界開始。</h2>
        </div>
        <span className="badge">
          {approved ? "本人已核准" : `${unresolved} 項待決定`}
        </span>
      </div>
      <p className="muted intro-copy">
        依序核對八個模組、核心設定與補全提案。如有修改，請先儲存再親自核准。接著到「視覺方向」核准試稿，最後回到此處啟用世界。
      </p>
      <nav className="review-shortcuts" aria-label="審核表快速導覽">
        <a href="#world-review-modules">核對世界設定</a>
        <a href="#world-review-decisions">補全與探索範圍</a>
        <a href="#world-review-issues">待處理事項</a>
        <a href="#world-review-approval">核准與啟用</a>
      </nav>
      {dirty && (
        <p className="notice" role="status">
          有尚未儲存的修改。背景更新與操作失敗都會保留此表單；切換分頁也不會清除。
        </p>
      )}
      {dirty && stale && (
        <div className="notice error" role="alert">
          <p>
            已儲存的世界版本已變更。你的修改仍保留，為避免覆蓋另一個操作，請先複製需要保留的文字，再重新載入核對。
          </p>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => {
              setDirty(false);
              setFormError("");
            }}
          >
            放棄未儲存內容，載入最新版本
          </button>
        </div>
      )}
      <form className="form-stack" onSubmit={save}>
        <fieldset className="review-fields" disabled={busy}>
          <section className="panel" id="world-review-modules">
            <div className="section-heading">
              <h2>01 · 世界八模組</h2>
              <span className="field-note">已知、未交代與不適用分別保留</span>
            </div>
            <div className="review-modules">
              {draft.modules.map((module, index) => (
                <article key={module.key} className="review-module">
                  <h3>{moduleLabels[module.key]}</h3>
                  <div className="review-field-pair">
                    <label>
                      資訊狀態
                      <select
                        value={module.status}
                        onChange={(event) =>
                          field(
                            "modules",
                            draft.modules.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    status: event.target
                                      .value as typeof module.status,
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        {Object.entries(statusNames).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <p className="field-note">
                        判斷依據：
                        <span className="badge">
                          {basisNames[module.basis]}
                        </span>
                      </p>
                      <p className="field-note">
                        修改摘要後，儲存時會標記為本人補充。
                      </p>
                    </div>
                  </div>
                  <TextField
                    label="模組摘要"
                    value={module.summary}
                    onChange={(summary) =>
                      field(
                        "modules",
                        draft.modules.map((item, i) =>
                          i === index ? { ...item, summary } : item,
                        ),
                      )
                    }
                  />
                  <Evidence items={module.evidence} />
                </article>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>02 · 核心設定</h2>
            <p className="muted">
              這些定義是世界的一致起點。請確認原意與邊界，再決定是否保留。
            </p>
            <div className="form-stack">
              {draft.anchors.map((anchor, index) => (
                <article className="review-item" key={anchor.id}>
                  <h3>
                    {index + 1}. {moduleLabels[anchor.module]}
                  </h3>
                  <TextField
                    label="核心定義"
                    value={anchor.definition}
                    onChange={(definition) =>
                      field(
                        "anchors",
                        draft.anchors.map((item, i) =>
                          i === index ? { ...item, definition } : item,
                        ),
                      )
                    }
                  />
                  <Evidence items={anchor.evidence} />
                </article>
              ))}
            </div>
          </section>
          <section className="panel" id="world-review-decisions">
            <h2>03 · 補全提案與探索範圍</h2>
            <p className="muted">
              逐項接受或拒絕。只有接受的補全與範圍才會進入後續探索；拒絕的提案仍保留供核對。
            </p>
            <div className="form-stack">
              {draft.extensions.map((extension, index) => (
                <article className="review-item" key={extension.id}>
                  <div className="section-heading">
                    <h3>{extension.title}</h3>
                    <span className="badge">
                      {moduleLabels[extension.module]}
                    </span>
                  </div>
                  <DecisionField
                    value={extension.decision}
                    onChange={(decision) =>
                      field(
                        "extensions",
                        draft.extensions.map((item, i) =>
                          i === index ? { ...item, decision } : item,
                        ),
                      )
                    }
                  />
                  <TextField
                    label="補全定義"
                    value={extension.definition}
                    onChange={(definition) =>
                      field(
                        "extensions",
                        draft.extensions.map((item, i) =>
                          i === index ? { ...item, definition } : item,
                        ),
                      )
                    }
                  />
                  <p className="field-note">提出理由：{extension.reason}</p>
                  <TextField
                    label="補全邊界"
                    value={extension.limits}
                    onChange={(limits) =>
                      field(
                        "extensions",
                        draft.extensions.map((item, i) =>
                          i === index ? { ...item, limits } : item,
                        ),
                      )
                    }
                  />
                </article>
              ))}
              {!draft.extensions.length && (
                <p className="field-note">目前沒有額外補全提案。</p>
              )}
              {draft.envelopes.map((envelope, index) => (
                <article className="review-item" key={envelope.id}>
                  <h3>{envelope.title}</h3>
                  <DecisionField
                    value={envelope.decision}
                    onChange={(decision) =>
                      field(
                        "envelopes",
                        draft.envelopes.map((item, i) =>
                          i === index ? { ...item, decision } : item,
                        ),
                      )
                    }
                  />
                  <TextField
                    label="探索範圍定義"
                    value={envelope.scope}
                    onChange={(scope) =>
                      field(
                        "envelopes",
                        draft.envelopes.map((item, i) =>
                          i === index ? { ...item, scope } : item,
                        ),
                      )
                    }
                  />
                  {(
                    ["allowedChanges", "limits", "prohibitedChanges"] as const
                  ).map((key) => (
                    <LinesField
                      key={key}
                      label={
                        {
                          allowedChanges: "允許變動",
                          limits: "範圍限制",
                          prohibitedChanges: "禁止變動",
                        }[key]
                      }
                      values={envelope[key]}
                      required
                      onChange={(values) =>
                        field(
                          "envelopes",
                          draft.envelopes.map((item, i) =>
                            i === index ? { ...item, [key]: values } : item,
                          ),
                        )
                      }
                    />
                  ))}
                </article>
              ))}
              {!draft.envelopes.length && (
                <p className="field-note">目前沒有額外探索範圍提案。</p>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>04 · 命名、讀者與探索方式</h2>
            <div className="review-modules">
              <article className="review-module">
                <h3>命名原則</h3>
                {(
                  Object.keys(namingLabels) as (keyof typeof namingLabels)[]
                ).map((key) => (
                  <TextField
                    key={key}
                    label={namingLabels[key]}
                    value={draft.naming[key]}
                    onChange={(value) =>
                      field("naming", { ...draft.naming, [key]: value })
                    }
                  />
                ))}
              </article>
              <article className="review-module">
                <h3>讀者與語氣</h3>
                {(
                  Object.keys(audienceLabels) as (keyof typeof audienceLabels)[]
                ).map((key) => (
                  <TextField
                    key={key}
                    label={audienceLabels[key]}
                    value={draft.audience[key]}
                    onChange={(value) =>
                      field("audience", { ...draft.audience, [key]: value })
                    }
                  />
                ))}
                <p className="field-note">
                  個別地點、生命與物件的名稱、定義和特色，請在「元素登錄」校準。這裡保存整體原則。
                </p>
              </article>
              <article className="review-module review-full-width">
                <h3>探索起點與邊界</h3>
                <div className="review-field-pair">
                  {(
                    Object.keys(
                      explorationLabels,
                    ) as (keyof typeof explorationLabels)[]
                  ).map((key) =>
                    key === "startPlace" ? (
                      <label key={key}>
                        {explorationLabels[key]}
                        <select
                          value={
                            world.elements.some(
                              (element) =>
                                element.id === draft.exploration.startPlace,
                            )
                              ? draft.exploration.startPlace
                              : ""
                          }
                          required
                          onChange={(event) =>
                            field("exploration", {
                              ...draft.exploration,
                              startPlace: event.target.value,
                            })
                          }
                        >
                          <option value="">請選擇已登錄的起始地點</option>
                          {world.elements.map((element) => (
                            <option key={element.id} value={element.id}>
                              {element.sourceName} · {element.kind}
                            </option>
                          ))}
                        </select>
                        {!world.elements.some(
                          (element) =>
                            element.id === draft.exploration.startPlace,
                        ) && (
                          <span className="field-note">
                            探索起點尚未對應已登錄的元素，請選擇後儲存。
                          </span>
                        )}
                      </label>
                    ) : (
                      <TextField
                        key={key}
                        label={explorationLabels[key]}
                        value={draft.exploration[key]}
                        onChange={(value) =>
                          field("exploration", {
                            ...draft.exploration,
                            [key]: value,
                          })
                        }
                      />
                    ),
                  )}
                </div>
              </article>
            </div>
          </section>
          <section className="panel">
            <h2>05 · 視覺依據與規範</h2>
            <p className="notice">
              {draft.visual.referenceStatus === "not_provided"
                ? "未提供參考圖：目前視覺提案僅依文字，尚未核對任何原作圖片。"
                : draft.visual.referenceStatus === "unread"
                  ? "參考圖尚未讀取：目前不能視為已核對圖片內容。"
                  : "已核對提供的參考圖；請確認下方整理是否符合你的原意。"}
            </p>
            {world.sourceImages && world.sourceImages.length > 0 && (
              <ul className="review-image-status">
                {world.sourceImages.map((image) => (
                  <li key={image.id}>
                    {image.label} ·{" "}
                    {image.status === "reviewed" ? "已核對" : "已提供，待核對"}
                  </li>
                ))}
              </ul>
            )}
            {world.imageCoverageNote && (
              <p className="field-note">{world.imageCoverageNote}</p>
            )}
            <TextField
              label="視覺特徵"
              value={draft.visual.characteristics}
              onChange={(characteristics) =>
                field("visual", { ...draft.visual, characteristics })
              }
            />
            <div className="review-field-pair">
              <LinesField
                label="必須保留"
                values={draft.visual.invariants}
                onChange={(invariants) =>
                  field("visual", { ...draft.visual, invariants })
                }
              />
              <LinesField
                label="避免出現"
                values={draft.visual.forbidden}
                onChange={(forbidden) =>
                  field("visual", { ...draft.visual, forbidden })
                }
              />
            </div>
            <p className="field-note">
              目前選定：
              {world.styles.find((style) => style.id === world.selectedStyleId)
                ?.name || "尚未選定視覺方向"}
              。請先至「視覺方向」選擇並儲存，再回來核准此表。之後變更方向，設定與視覺核准都需重做。
            </p>
          </section>
          <section className="panel" id="world-review-issues">
            <h2>06 · 忠實度與待處理事項</h2>
            <p className="field-note">
              忠實度檢查：
              {draft.fidelity.verdict === "pass"
                ? "目前未發現需特別確認的偏離"
                : "有需要本人確認的內容"}
            </p>
            <div className="review-fidelity-notes">
              <h3>忠實度備註</h3>
              {draft.fidelity.notes.length > 0 ? (
                <ul className="review-notes">
                  {draft.fidelity.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="field-note">目前沒有額外備註。</p>
              )}
              <p className="field-note">
                以上為核對結果。若需要回應，請填寫下方待處理事項中的本人決定。
              </p>
            </div>
            <div className="form-stack">
              {draft.issues.map((issue, index) => (
                <article className="review-item" key={issue.id}>
                  <div className="section-heading">
                    <h3>{issue.message}</h3>
                    <span className="badge">
                      {issue.blocking ? "重大 · 核准前必填" : "建議確認"}
                    </span>
                  </div>
                  <p className="field-note">
                    {moduleLabels[issue.module]} · 建議：{issue.recommendation}
                  </p>
                  <TextField
                    label={
                      issue.blocking
                        ? "本人的處理決定（核准前必填）"
                        : "本人的處理決定"
                    }
                    value={issue.resolution}
                    required={false}
                    onChange={(resolution) =>
                      field(
                        "issues",
                        draft.issues.map((item, i) =>
                          i === index ? { ...item, resolution } : item,
                        ),
                      )
                    }
                  />
                </article>
              ))}
              {!draft.issues.length && (
                <p className="field-note">目前沒有額外待處理事項。</p>
              )}
            </div>
          </section>
        </fieldset>
        {formError && (
          <p className="notice error" role="alert">
            {formError}
          </p>
        )}
        <div className="review-save-row">
          <p className="field-note">
            儲存修改會建立新版本，並清除先前的設定與視覺核准。
          </p>
          <button
            className="primary"
            disabled={busy || !dirty || stale || !readComplete}
          >
            儲存世界設定
            <Check size={16} />
          </button>
        </div>
      </form>
      <section className="panel review-approval" id="world-review-approval">
        <div className="section-heading">
          <div>
            <p className="eyebrow">FIRST · PERSONAL REVIEW</p>
            <h2>親自核准目前設定</h2>
          </div>
          <ShieldCheck size={24} />
        </div>
        <p className="muted">
          請核對本表所有內容，包含核心定義、接受或拒絕的補全，以及探索範圍。如有修改請先儲存；已儲存且條件齊全的版本可直接勾選並核准。
        </p>
        <label className="preview-confirmation">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy || !ready || approved}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            我已親自檢查核心設定、補全決定與探索範圍，並核准目前儲存的第{" "}
            {world.revision} 版。
          </span>
        </label>
        <button
          type="button"
          className="primary"
          disabled={busy || !ready || !acknowledged || approved}
          onClick={() => void approve()}
        >
          {approved ? "目前設定已核准" : "核准目前設定"}
          <Check size={16} />
        </button>
        {!ready && !approved && (
          <div className="notice" aria-label="核准前待完成事項">
            <p>完成以下事項後，即可勾選並核准：</p>
            <ul>
              {dirty && <li>請先儲存修改。</li>}
              {stale && <li>世界版本已更新，請載入並核對最新版本。</li>}
              {!readComplete && <li>請先完成原作閱讀與世界整理。</li>}
              {!world.styles.some(
                (style) => style.id === world.selectedStyleId,
              ) && (
                <li>
                  請先選定並儲存視覺方向。
                  {onNavigate && (
                    <button
                      type="button"
                      className="subtle"
                      disabled={busy}
                      onClick={() => onNavigate("visual")}
                    >
                      前往選擇視覺方向
                    </button>
                  )}
                </li>
              )}
              {[...draft.extensions, ...draft.envelopes].some(
                (item) => item.decision === "pending",
              ) && (
                <li>
                  <a href="#world-review-decisions">
                    {
                      [...draft.extensions, ...draft.envelopes].filter(
                        (item) => item.decision === "pending",
                      ).length
                    }{" "}
                    項補全或探索範圍尚未決定
                  </a>
                </li>
              )}
              {draft.issues.some(
                (issue) => issue.blocking && !issue.resolution.trim(),
              ) && (
                <li>
                  <a href="#world-review-issues">
                    {
                      draft.issues.filter(
                        (issue) => issue.blocking && !issue.resolution.trim(),
                      ).length
                    }{" "}
                    項重大事項尚未填寫處理決定
                  </a>
                </li>
              )}
              {!frameworkSchema.safeParse(draft).success && (
                <li>請補齊表單中的必填內容，再儲存。</li>
              )}
              {!world.elements.some(
                (element) => element.id === draft.exploration.startPlace,
              ) && <li>請在探索方式選擇有效的起始地點。</li>}
              {draft.relations.some(
                (relation) =>
                  !world.elements.some(
                    (element) => element.id === relation.subjectId,
                  ) ||
                  !world.elements.some(
                    (element) => element.id === relation.objectId,
                  ),
              ) && <li>元素關係需要重新核對，請透過 AI 對話處理。</li>}
              {!shown.frameworkHash && (
                <li>正在讀取目前設定，請稍候或重新整理資料。</li>
              )}
            </ul>
          </div>
        )}
        {approved && (
          <p className="field-note">
            下一步：到「視覺方向」產生並核准目前版本的試稿，再回此處啟用世界。
          </p>
        )}
      </section>
      <section className="confirmation-panel" id="world-activation">
        <div>
          <ShieldCheck size={25} />
          <h2>最後 · 啟用這個世界</h2>
          <p>
            啟用前，設定與視覺試稿都必須是你核准的同一版本。啟用後即可準備語系與網站。
          </p>
          <ul className="checklist">
            <li className={readComplete ? "done" : ""}>
              <CheckCircle2 size={16} />
              原作已完整閱讀
            </li>
            <li className={approved ? "done" : ""}>
              <CheckCircle2 size={16} />
              本人已核准設定
            </li>
            <li className={visualApproved ? "done" : ""}>
              <CheckCircle2 size={16} />
              同版本視覺試稿已核准
            </li>
          </ul>
        </div>
        <button
          className="primary"
          disabled={
            busy ||
            !readComplete ||
            !approved ||
            !visualApproved ||
            world.status === "confirmed"
          }
          onClick={() =>
            void run("啟用世界", (latest) => {
              assertReviewSnapshot(latest, shown);
              return post(`${worldPath(world.id)}/confirm`, {
                revision: shown.world.revision,
                recordVersion: shown.world.recordVersion,
                hash: shown.frameworkHash,
              });
            })
          }
        >
          {world.status === "confirmed" ? "世界已啟用" : "啟用這個世界"}
          <Check size={17} />
        </button>
      </section>
    </div>
  );
}
