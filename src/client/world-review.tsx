import { useEffect, useState, type FormEvent } from "react";
import { Check, CheckCircle2, ShieldCheck, RefreshCw } from "lucide-react";
import type { WorldDetail, WorldDraft } from "../shared/contracts";
import { frameworkSchema } from "../shared/world-framework";
import {
  briefKeys,
  briefLabels,
  worldBriefSchema,
  type WorldBrief,
} from "../shared/world-brief";
import { patch, post } from "./api";
import type { RunAction } from "./studio";

const worldPath = (id: string) => `/api/worlds/${encodeURIComponent(id)}`;
export function assertReviewSnapshot(latest: WorldDetail, shown: WorldDetail) {
  if (
    latest.world.id !== shown.world.id ||
    latest.world.revision !== shown.world.revision ||
    latest.world.recordVersion !== shown.world.recordVersion ||
    latest.frameworkHash !== shown.frameworkHash ||
    latest.briefHash !== shown.briefHash
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
export function briefReviewReady(world: WorldDraft) {
  return (
    worldBriefSchema.safeParse(world.brief).success &&
    !!world.brief &&
    world.brief.decisions.every((decision) => decision.answer.trim())
  );
}
export function isFrameworkApproved(detail: WorldDetail) {
  if (detail.world.brief)
    return (
      !!detail.briefHash &&
      detail.world.briefApproval?.revision === detail.world.revision &&
      detail.world.briefApproval.hash === detail.briefHash
    );
  return (
    !!detail.world.framework &&
    !!detail.frameworkHash &&
    detail.world.frameworkApproval?.revision === detail.world.revision &&
    detail.world.frameworkApproval.hash === detail.frameworkHash
  );
}
function hasVisualApproval(world: WorldDraft) {
  return (
    world.visualApproval?.revision === world.revision &&
    world.previews.some(
      (preview) =>
        preview.id === world.visualApproval?.previewId &&
        preview.revision === world.revision &&
        preview.styleId === world.selectedStyleId &&
        preview.review.verdict === "pass",
    )
  );
}
function Activation({
  detail,
  shown,
  approved,
  readComplete,
  busy,
  run,
  onNavigate,
}: {
  detail: WorldDetail;
  shown: WorldDetail;
  approved: boolean;
  readComplete: boolean;
  busy: boolean;
  run: RunAction;
  onNavigate?: (tab: string) => void;
}) {
  const { world } = detail;
  const visualApproved = hasVisualApproval(world);
  return (
    <section className="confirmation-panel" id="world-activation">
      <div>
        <ShieldCheck size={25} />
        <h2>最後 · 啟用這個世界</h2>
        <p>設定與視覺試稿均由你核准後，即可啟用世界。</p>
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
        {approved && !visualApproved && onNavigate && (
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => onNavigate("visual")}
          >
            前往視覺校準
          </button>
        )}
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
              hash: shown.world.brief ? shown.briefHash : shown.frameworkHash,
            });
          })
        }
      >
        {world.status === "confirmed" ? "世界已啟用" : "啟用這個世界"}
        <Check size={17} />
      </button>
    </section>
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
  const [draft, setDraft] = useState<WorldBrief | undefined>(
    () => world.brief && structuredClone(world.brief),
  );
  const [shown, setShown] = useState(detail);
  const [dirty, setDirty] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    if (dirty) return;
    setDraft(detail.world.brief && structuredClone(detail.world.brief));
    setShown(detail);
    setAcknowledged(false);
  }, [
    detail.world.id,
    detail.world.revision,
    detail.world.recordVersion,
    detail.briefHash,
    detail.frameworkHash,
    dirty,
  ]);
  const stale =
    shown.world.id !== world.id ||
    shown.world.revision !== world.revision ||
    shown.world.recordVersion !== world.recordVersion ||
    shown.briefHash !== detail.briefHash ||
    shown.frameworkHash !== detail.frameworkHash;
  const active = detail.jobs.some((job) =>
    ["queued", "running"].includes(job.status),
  );
  const coverageComplete =
    source.segmentCount > 0 && source.processedCount === source.segmentCount;
  const readComplete = coverageComplete && world.status !== "reading";
  const approved = !dirty && !stale && isFrameworkApproved(detail);
  const unanswered =
    draft?.decisions.filter((decision) => !decision.answer.trim()).length || 0;
  const ready =
    !dirty &&
    !stale &&
    !!draft &&
    briefReviewReady({ ...world, brief: draft }) &&
    readComplete &&
    !active &&
    !!shown.briefHash;
  function change(next: WorldBrief) {
    setDraft(next);
    setDirty(true);
    setAcknowledged(false);
    setFormError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = worldBriefSchema.safeParse(draft);
    if (!parsed.success) {
      setFormError("請確認六項內容皆已填寫，且每項不超過 4,000 字元。");
      return;
    }
    const ok = await run("儲存創作簡報", (latest) => {
      assertReviewSnapshot(latest, shown);
      return patch(`${worldPath(world.id)}/brief`, {
        revision: shown.world.revision,
        recordVersion: shown.world.recordVersion,
        brief: parsed.data,
      });
    });
    if (ok) {
      setDirty(false);
      setAcknowledged(false);
      setFormError("");
    }
  }
  async function approve() {
    if (!ready || !acknowledged || approved) return;
    await run("核准世界設定", (latest) => {
      assertReviewSnapshot(latest, shown);
      return post(`${worldPath(world.id)}/brief-approval`, {
        revision: shown.world.revision,
        recordVersion: shown.world.recordVersion,
        hash: shown.briefHash,
      });
    });
    setAcknowledged(false);
  }
  if (!draft)
    return (
      <div className="tab-content world-review">
        <section className="panel" id="world-review-approval">
          <p className="eyebrow">WORLD REVIEW</p>
          <h2>六項創作簡報</h2>
          {approved ? (
            <p className="notice">
              目前設定已核准。你可以沿用原有設定，或選擇重新整理。
            </p>
          ) : (
            <p className="muted">
              將原作整理成六項預填內容，再確認需要你裁定的問題。
            </p>
          )}
          <button
            className="primary"
            disabled={
              busy || active || (!coverageComplete && !detail.importReview)
            }
            onClick={() =>
              void run("用六項重新整理", (latest) => {
                assertReviewSnapshot(latest, shown);
                return post(`${worldPath(world.id)}/analyze`, {
                  revision: shown.world.revision,
                  recordVersion: shown.world.recordVersion,
                });
              })
            }
          >
            用六項重新整理
            <RefreshCw size={16} />
          </button>
          <p className="field-note">
            重新整理會保留原作，並需要重新核准新的設定與視覺試稿。
          </p>
          {active && (
            <p className="field-note">正在整理中，完成後會顯示簡報。</p>
          )}
          {!coverageComplete && !detail.importReview && !active && (
            <p className="field-note">請先完成原作閱讀。</p>
          )}
        </section>
        {approved && (
          <Activation
            {...{
              detail,
              shown,
              approved,
              readComplete,
              busy,
              run,
              onNavigate,
            }}
          />
        )}
      </div>
    );
  return (
    <div className="tab-content world-review">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR WORLD, YOUR DECISIONS</p>
          <h2>六項創作簡報</h2>
        </div>
        <span className="badge">
          {approved
            ? "本人已核准"
            : unanswered
              ? `${unanswered} 項待裁定`
              : "待本人確認"}
        </span>
      </div>
      <p className="muted intro-copy">
        先讀過已整理的六項內容，直接修改需要調整的地方。確認後親自核准，再前往視覺校準。
      </p>
      <nav className="review-shortcuts" aria-label="世界確認快速導覽">
        <a href="#world-brief">六項內容</a>
        {draft.decisions.length > 0 && (
          <a href="#world-review-decisions">需要你的裁定</a>
        )}
        <a href="#world-review-approval">核准與啟用</a>
      </nav>
      {dirty && (
        <p className="notice" role="status">
          有尚未儲存的修改。切換分頁與背景更新都會保留內容。
        </p>
      )}
      {stale && (
        <div className="notice error" role="alert">
          <p>
            世界版本已更新。你的修改仍保留，請先複製需要保留的文字，再載入最新版本核對。
          </p>
          <button
            type="button"
            className="subtle"
            disabled={busy}
            onClick={() => {
              setDirty(false);
              setDraft(
                detail.world.brief && structuredClone(detail.world.brief),
              );
              setShown(detail);
              setAcknowledged(false);
              setFormError("");
            }}
          >
            放棄未儲存內容，載入最新版本
          </button>
        </div>
      )}
      <form className="form-stack" onSubmit={save}>
        <fieldset className="review-fields" disabled={busy || active}>
          <div className="brief-sections" id="world-brief">
            {briefKeys.map((key, index) => (
              <section className="panel brief-section" key={key}>
                <label>
                  <span className="brief-section-heading">
                    <span className="eyebrow">0{index + 1}</span>
                    {briefLabels[key]}
                  </span>
                  <textarea
                    aria-label={briefLabels[key]}
                    rows={5}
                    required
                    maxLength={4000}
                    value={draft[key]}
                    onChange={(event) =>
                      change({ ...draft, [key]: event.target.value })
                    }
                  />
                </label>
              </section>
            ))}
          </div>
          <section className="panel" id="world-review-decisions">
            <h2>需要你的裁定</h2>
            {!draft.decisions.length ? (
              <p className="muted">
                目前沒有需要你裁定的問題。核對六項內容後，即可直接核准。
              </p>
            ) : (
              <div className="form-stack">
                {draft.decisions.map((decision) => (
                  <article className="review-item" key={decision.id}>
                    <p className="eyebrow">{briefLabels[decision.section]}</p>
                    <h3>{decision.question}</h3>
                    {decision.suggestion && (
                      <div className="brief-suggestion">
                        <p>建議：{decision.suggestion}</p>
                        <button
                          type="button"
                          className="subtle"
                          onClick={() =>
                            change({
                              ...draft,
                              decisions: draft.decisions.map((item) =>
                                item.id === decision.id
                                  ? { ...item, answer: decision.suggestion }
                                  : item,
                              ),
                            })
                          }
                        >
                          採用建議
                        </button>
                      </div>
                    )}
                    <label>
                      我的回答
                      <textarea
                        aria-label={`我的回答：${decision.question}`}
                        rows={3}
                        maxLength={2000}
                        value={decision.answer}
                        onChange={(event) =>
                          change({
                            ...draft,
                            decisions: draft.decisions.map((item) =>
                              item.id === decision.id
                                ? { ...item, answer: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                  </article>
                ))}
              </div>
            )}
          </section>
        </fieldset>
        {draft.evidence.length > 0 && (
          <details className="panel review-evidence">
            <summary>查看已核對的原文依據</summary>
            {draft.evidence.map((item, index) => (
              <blockquote key={index}>
                {item.quote}
                <small>
                  {briefLabels[item.section]} · 來源片段：{item.segmentId}
                </small>
              </blockquote>
            ))}
          </details>
        )}
        <p className="field-note">
          {draft.referenceStatus === "reviewed"
            ? "已參照原作圖片。"
            : draft.referenceStatus === "not_provided"
              ? "未提供參考圖，視覺方向依文字整理。"
              : "參考圖尚待讀取，請核對視覺內容。"}
        </p>
        {formError && (
          <p className="notice error" role="alert">
            {formError}
          </p>
        )}
        <div className="review-save-row">
          <p className="field-note">修改儲存後，需重新核准設定與視覺試稿。</p>
          <button
            className="primary"
            disabled={busy || active || !dirty || stale || !readComplete}
          >
            儲存創作簡報
            <Check size={16} />
          </button>
        </div>
      </form>
      <section className="panel review-approval" id="world-review-approval">
        <div className="section-heading">
          <h2>親自核准目前設定</h2>
          <ShieldCheck size={24} />
        </div>
        <p className="muted">
          核對六項內容與裁定後，勾選確認。若沒有修改，無須額外儲存。
        </p>
        <label className="preview-confirmation">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy || !ready || approved}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            我已親自檢查六項內容與裁定，並核准目前儲存的第 {world.revision} 版。
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
            <ul>
              {dirty && <li>請先儲存修改。</li>}
              {stale && <li>請載入並核對最新世界版本。</li>}
              {(!readComplete || active) && (
                <li>請等候原作閱讀與世界整理完成。</li>
              )}
              {unanswered > 0 && (
                <li>
                  <a href="#world-review-decisions">
                    {unanswered} 項必要裁定尚未回答
                  </a>
                </li>
              )}
              {!worldBriefSchema.safeParse(draft).success && (
                <li>請補齊六項內容，再儲存。</li>
              )}
              {!shown.briefHash && <li>正在讀取目前設定，請稍候。</li>}
            </ul>
          </div>
        )}
      </section>
      <Activation
        {...{ detail, shown, approved, readComplete, busy, run, onNavigate }}
      />
    </div>
  );
}
