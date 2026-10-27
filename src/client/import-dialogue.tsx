import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, MessageCircle, X } from "lucide-react";
import type {
  EvidenceDecision,
  ImportBrief,
  ImportReview,
  WorldDetail,
} from "../shared/contracts";
import { errorMessage, patch, post } from "./api";
import type { RunAction } from "./studio";

type BriefFieldsValue = Omit<ImportBrief, "confirmedAt">;
const emptyBrief: BriefFieldsValue = {
  timeframe: "",
  scope: "",
  visualStyle: "",
  notes: "",
};
const path = (id: string) => `/api/worlds/${encodeURIComponent(id)}`;
const briefValue = (brief?: ImportBrief): BriefFieldsValue => ({
  timeframe: brief?.timeframe || "",
  scope: brief?.scope || "",
  visualStyle: brief?.visualStyle || "",
  notes: brief?.notes || "",
});
function BriefFields({
  value,
  onChange,
  busy,
}: {
  value: BriefFieldsValue;
  onChange: (value: BriefFieldsValue) => void;
  busy: boolean;
}) {
  const id = useId();
  return (
    <div className="import-brief-fields">
      {(
        [
          [
            "timeframe",
            "故事的時代與時間範圍",
            "例如：故事開端到主角離開故鄉；未指定則依原作整理。",
          ],
          [
            "scope",
            "這次想展開的範圍",
            "例如：先整理一座城市，或涵蓋整個世界。",
          ],
          [
            "visualStyle",
            "期待的視覺氣質",
            "例如：寫實、繪本、版畫；也可以稍後再決定。",
          ],
          [
            "notes",
            "作者補充與提醒",
            "原作之外的設定、希望修正的理解，或暫時不想展開的部分。",
          ],
        ] as const
      ).map(([key, label, placeholder]) => (
        <label key={key} htmlFor={`${id}-${key}`}>
          {label}
          <span className="field-note">選填</span>
          <textarea
            id={`${id}-${key}`}
            rows={key === "notes" ? 3 : 2}
            value={value[key]}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.value })
            }
            placeholder={placeholder}
            disabled={busy}
            maxLength={key === "notes" ? 8000 : 4000}
            aria-describedby={`${id}-${key}-count`}
          />
          <span className="field-note" id={`${id}-${key}-count`}>
            {value[key].length.toLocaleString()} /{" "}
            {(key === "notes" ? 8000 : 4000).toLocaleString()} 字元
          </span>
        </label>
      ))}
    </div>
  );
}
export function ImportBriefForm({
  detail,
  run,
  busy,
}: {
  detail: WorldDetail;
  run: RunAction;
  busy: boolean;
}) {
  const [value, setValue] = useState<BriefFieldsValue>(() =>
    briefValue(detail.world.importBrief),
  );
  const [dirty, setDirty] = useState(false);
  const touched = useRef(new Set<keyof BriefFieldsValue>());
  const saved = JSON.stringify(detail.world.importBrief || emptyBrief);
  useEffect(() => {
    if (!dirty) setValue(briefValue(detail.world.importBrief));
  }, [saved, dirty]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      await run("確認匯入方向", (latest) => {
        const brief = briefValue(latest.world.importBrief);
        for (const key of touched.current) brief[key] = value[key];
        const body = {
          revision: latest.world.revision,
          recordVersion: latest.world.recordVersion,
          brief,
        };
        return latest.importReview?.kind === "brief"
          ? post(
              `${path(latest.world.id)}/import-reviews/${encodeURIComponent(latest.importReview.id)}/resolve`,
              { ...body, decisions: {} },
            )
          : patch(`${path(latest.world.id)}/import-brief`, body);
      })
    ) {
      touched.current.clear();
      setDirty(false);
    }
  }
  return (
    <section className="panel import-brief-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">A WORLD IN YOUR WORDS</p>
          <h2>先一起確認這次的方向。</h2>
        </div>
        {detail.world.importBrief?.confirmedAt && (
          <span className="badge succeeded">已確認</span>
        )}
      </div>
      <p className="muted">
        {detail.importReview
          ? "先前的閱讀進度已保存。處理待確認項目後會接續進行。"
          : "閱讀會繼續進行。"}
        你可以先補充期待，也可以保留空白，讓世界依原作展開。
      </p>
      <p className="field-note">
        原作證據與作者補充會分別保留；這裡的補充不會被當成原文引句。
      </p>
      {detail.importSuggestions?.length > 0 && (
        <div className="import-suggestions">
          <h3>閱讀中的發現</h3>
          <ul>
            {detail.importSuggestions.map((suggestion, index) => (
              <li key={index}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={submit} className="form-stack">
        <BriefFields
          value={value}
          onChange={(next) => {
            for (const key of Object.keys(next) as (keyof BriefFieldsValue)[])
              if (next[key] !== value[key]) touched.current.add(key);
            setValue(next);
            setDirty(true);
          }}
          busy={busy}
        />
        <div className="form-footer">
          <span className="field-note">不確定的細節，可以留待後續對話。</span>
          <button
            className="primary"
            disabled={
              busy || (!!detail.world.importBrief?.confirmedAt && !dirty)
            }
          >
            {detail.world.importBrief?.confirmedAt ? "儲存補充" : "確認方向"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </section>
  );
}
export function ImportConversation({
  review,
  onOpen,
  busy,
}: {
  review: ImportReview | null;
  onOpen: () => void;
  busy: boolean;
}) {
  if (!review) return null;
  return (
    <section className="import-conversation" aria-label="待確認的閱讀對話">
      <span className="import-conversation-icon">
        <MessageCircle size={23} />
      </span>
      <div className="grow">
        <span className="badge waiting_user">需要你確認</span>
        <h3>
          {review.kind === "brief"
            ? "世界的方向，等你點頭。"
            : "有一處線索，想和你一起確認。"}
        </h3>
        <p>
          {review.kind === "evidence"
            ? "部分敘述還找不到可靠的原文依據。請協助更正引句、補充設定，或略過這項敘述。"
            : review.kind === "brief"
              ? "閱讀已完成。確認匯入方向後，就能繼續整理世界。"
              : "閱讀暫時停在這裡。你可以補充說明後，接續閱讀。"}
        </p>
        <button className="subtle" onClick={onOpen} disabled={busy}>
          繼續確認對話
          <ArrowUpRight size={15} />
        </button>
      </div>
    </section>
  );
}
export function ImportReviewDialog({
  detail,
  review,
  run,
  busy,
  onClose,
}: {
  detail: WorldDetail;
  review: ImportReview;
  run: RunAction;
  busy: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [decisions, setDecisions] = useState<Record<string, EvidenceDecision>>(
    {},
  );
  const [brief, setBrief] = useState<BriefFieldsValue>(() =>
    briefValue(detail.world.importBrief),
  );
  const briefTouched = useRef(new Set<keyof BriefFieldsValue>());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    title.current?.focus();
    return () => {
      dialog.current?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const complete =
    review.kind !== "evidence" ||
    review.problems.every((problem) => {
      const decision = decisions[problem.id];
      return (
        decision &&
        (decision.action === "exclude" ||
          ((decision.text ?? problem.claim).trim() &&
            (decision.action !== "replace_quote" || decision.quote?.trim())))
      );
    });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete || busy) return;
    setError("");
    let failure = "";
    const ok = await run("儲存確認並繼續閱讀", async (latest) => {
      try {
        const currentBrief = briefValue(latest.world.importBrief);
        for (const key of briefTouched.current) currentBrief[key] = brief[key];
        return await post(
          `${path(latest.world.id)}/import-reviews/${encodeURIComponent(review.id)}/resolve`,
          {
            revision: latest.world.revision,
            recordVersion: latest.world.recordVersion,
            decisions,
            ...(review.kind === "brief" ? { brief: currentBrief } : {}),
            ...(message.trim() ? { message: message.trim() } : {}),
          },
        );
      } catch (err) {
        failure = errorMessage(err);
        throw err;
      }
    });
    if (ok) closeRef.current();
    else
      setError(
        failure || "尚未儲存成功，請確認連線後重試。你的選擇仍保留在這裡。",
      );
  }
  return (
    <dialog
      ref={dialog}
      className="import-review-dialog"
      aria-labelledby="review-dialog-title"
      aria-describedby="review-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) closeRef.current();
      }}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">LET’S READ THIS TOGETHER</p>
          <h2 id="review-dialog-title" ref={title} tabIndex={-1}>
            {review.kind === "brief"
              ? "確認方向，讓世界繼續展開。"
              : "這一處，需要你的理解。"}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="暫時關閉確認對話"
          onClick={onClose}
          disabled={busy}
        >
          <X size={20} />
        </button>
      </div>
      <p id="review-dialog-description" className="muted">
        {review.message}
      </p>
      {review.segmentOrdinal !== null && (
        <p className="field-note">
          原作第 {review.segmentOrdinal + 1} 個片段 · 已完成的閱讀仍然保留。
        </p>
      )}
      <form onSubmit={submit} className="form-stack">
        {review.kind === "brief" && (
          <>
            <p className="field-note">
              各欄位皆為選填。空白代表依原作判斷；作者補充會與原文證據分開記錄。
            </p>
            <BriefFields
              value={brief}
              onChange={(next) => {
                for (const key of Object.keys(
                  next,
                ) as (keyof BriefFieldsValue)[])
                  if (next[key] !== brief[key]) briefTouched.current.add(key);
                setBrief(next);
              }}
              busy={busy}
            />
          </>
        )}
        {review.kind === "evidence" && (
          <>
            <p className="field-note">
              請逐項選擇。只有能在這個片段找到的原文，才能作為來源證據。
            </p>
            {review.problems.map((problem, index) => {
              const decision = decisions[problem.id];
              const update = (next: EvidenceDecision) =>
                setDecisions((current) => ({ ...current, [problem.id]: next }));
              return (
                <fieldset
                  className="evidence-question"
                  key={problem.id}
                  disabled={busy}
                >
                  <legend>
                    {String(index + 1).padStart(2, "0")} ·{" "}
                    {problem.elementName || "世界敘述"}
                  </legend>
                  <h3>{problem.claim}</h3>
                  <div className="unverified-quote">
                    <span>待核對引句 · 尚未驗證</span>
                    {problem.quote ? (
                      <blockquote>{problem.quote}</blockquote>
                    ) : (
                      <p>目前沒有可核對的引句。</p>
                    )}
                  </div>
                  <div className="evidence-choices">
                    {(
                      [
                        [
                          "replace_quote",
                          "更正原文引句",
                          "提供這個片段中確實存在、且支持敘述的原句。",
                        ],
                        [
                          "author_confirm",
                          "作為作者補充",
                          "我確認這項設定；它會標記為作者資訊，不作為原文證據。",
                        ],
                        ["exclude", "略過這項敘述", "這次不將它納入世界設定。"],
                      ] as const
                    ).map(([action, label, note]) => (
                      <label
                        className={
                          decision?.action === action
                            ? "evidence-choice selected"
                            : "evidence-choice"
                        }
                        key={action}
                      >
                        <input
                          type="radio"
                          name={`decision-${problem.id}`}
                          checked={decision?.action === action}
                          onChange={() =>
                            update({
                              action,
                              text: decision?.text ?? problem.claim,
                              ...(action === "replace_quote"
                                ? { quote: decision?.quote || "" }
                                : {}),
                            })
                          }
                          required
                        />
                        <span>
                          <strong>{label}</strong>
                          <small>{note}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {decision && decision.action !== "exclude" && (
                    <label>
                      確認後的敘述
                      <textarea
                        rows={2}
                        value={decision.text ?? problem.claim}
                        onChange={(event) =>
                          update({ ...decision, text: event.target.value })
                        }
                        required
                        maxLength={5000}
                      />
                    </label>
                  )}
                  {decision?.action === "replace_quote" && (
                    <label>
                      正確的原文引句
                      <textarea
                        rows={3}
                        value={decision.quote || ""}
                        onChange={(event) =>
                          update({ ...decision, quote: event.target.value })
                        }
                        placeholder="從下方原文複製對應引句"
                        required
                        maxLength={10000}
                      />
                      <span className="field-note">
                        請保留原文用字；儲存時會再次核對。
                      </span>
                    </label>
                  )}
                </fieldset>
              );
            })}
          </>
        )}
        {review.sourceText && (
          <details className="review-source">
            <summary>展開這個片段的完整原文</summary>
            <pre>{review.sourceText}</pre>
          </details>
        )}
        {review.kind !== "brief" && (
          <label>
            給這次確認的補充
            <span className="field-note">選填；這段說明會保留在對話中。</span>
            <textarea
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={busy}
              maxLength={8000}
              placeholder="補充你希望如何理解這一處⋯"
            />
          </label>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer review-footer">
          <span className="field-note">
            也可以暫時關閉，稍後從原作頁或對話繼續。
          </span>
          <button className="primary" disabled={busy || !complete}>
            {busy
              ? "正在儲存⋯"
              : review.kind === "processing"
                ? "接續閱讀"
                : "確認並繼續"}
            <ArrowUpRight size={17} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
