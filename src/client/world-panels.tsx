import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  ImagePlus,
  Languages,
  MessageCircle,
  PencilLine,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import type {
  Locale,
  Translation,
  WorldDetail,
  WorldDraft,
} from "../shared/contracts";
import { patch, post } from "./api";
import { AuditList, JobList, date, statusName, type RunAction } from "./studio";

type Props = {
  tab: string;
  detail: WorldDetail;
  run: RunAction;
  busy: boolean;
  retry: (id: string) => void;
};
const worldPath = (id: string) => `/api/worlds/${encodeURIComponent(id)}`;
const localeNames: Record<Locale, string> = {
  en: "English",
  "zh-Hant": "繁體中文",
  ja: "日本語",
};
const blank = "原作未交代";

export function WorldPanels(props: Props) {
  if (props.tab === "registry") return <Registry {...props} />;
  if (props.tab === "questions") return <Questions {...props} />;
  if (props.tab === "visual") return <Visual {...props} />;
  if (props.tab === "chat") return <Chat {...props} />;
  if (props.tab === "translations") return <Translations {...props} />;
  if (props.tab === "release") return <Release {...props} />;
  return <Source {...props} />;
}
function Source({
  detail: { world, source, jobs, audit },
  run,
  busy,
  retry,
}: Props) {
  const [mode, setMode] = useState(world.mode);
  return (
    <div className="tab-content">
      <div className="two-column">
        <section className="panel">
          <p className="eyebrow">THE ORIGINAL</p>
          <h2>{source.title}</h2>
          <dl className="metadata">
            <div>
              <dt>來源格式</dt>
              <dd>
                {
                  {
                    text: "文字",
                    url: "網頁",
                    docx: "Word 文件",
                    pdf: "PDF 文件",
                    "google-doc": "Google 文件",
                  }[source.kind]
                }
              </dd>
            </div>
            <div>
              <dt>全文字元</dt>
              <dd>{source.charCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>閱讀覆蓋</dt>
              <dd>
                {source.processedCount} / {source.segmentCount} 個片段
              </dd>
            </div>
            <div>
              <dt>匯入時間</dt>
              <dd>{date(source.createdAt)}</dd>
            </div>
            {source.url && (
              <div>
                <dt>來源連結</dt>
                <dd>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    開啟原作
                    <ExternalLink size={13} />
                  </a>
                </dd>
              </div>
            )}
          </dl>
          {source.segmentCount > 0 && (
            <progress
              max={source.segmentCount}
              value={source.processedCount}
              aria-label="原作閱讀覆蓋"
            />
          )}
          <a
            className="source-readback"
            href={`${worldPath(world.id)}/source`}
            target="_blank"
            rel="noreferrer"
          >
            檢視保存的完整原文
            <ExternalLink size={14} />
          </a>
          <details className="technical-detail">
            <summary>
              檢視來源指紋
              <ChevronDown size={14} />
            </summary>
            <code>{source.sha256}</code>
          </details>
        </section>
        <section className="panel">
          <p className="eyebrow">WORLD PORTRAIT</p>
          <h2>世界的輪廓</h2>
          <dl className="world-facts">
            <div>
              <dt>時代</dt>
              <dd>{world.era || blank}</dd>
            </div>
            <div>
              <dt>地理</dt>
              <dd>{world.geography || blank}</dd>
            </div>
            <div>
              <dt>生態</dt>
              <dd>{world.ecology || blank}</dd>
            </div>
          </dl>
          {world.rules.length > 0 && (
            <>
              <h3 className="minor-heading">世界規則</h3>
              <ol className="rules">
                {world.rules.map((rule, i) => (
                  <li key={i}>{rule}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">EXPLORATION DIRECTION</p>
            <h2>你想如何看見這個世界？</h2>
          </div>
          <button
            className="subtle"
            disabled={busy || mode === world.mode || world.status === "reading"}
            onClick={() =>
              void run("儲存探索方向", (d) =>
                patch(worldPath(world.id), {
                  revision: d.world.revision,
                  mode,
                }),
              )
            }
          >
            儲存方向
            <Check size={15} />
          </button>
        </div>
        <div className="mode-options">
          {(
            [
              ["landscape", "地貌與風景", "從空間、建築與自然景觀觀察世界。"],
              ["ecology", "生命與生態", "跟隨物種、生命與環境之間的連結。"],
              ["mixed", "地貌與生命", "並置風景與生態，保留原作的重心。"],
            ] as const
          ).map(([id, name, text]) => (
            <label
              key={id}
              className={mode === id ? "mode-card selected" : "mode-card"}
            >
              <input
                type="radio"
                name="mode"
                value={id}
                checked={mode === id}
                onChange={() => setMode(id)}
              />
              <span>
                <strong>{name}</strong>
                <small>{text}</small>
              </span>
            </label>
          ))}
        </div>
      </section>
      <div className="two-column">
        <section className="panel">
          <h2>閱讀與建構進度</h2>
          <JobList jobs={jobs} retry={retry} busy={busy} />
        </section>
        <section className="panel">
          <h2>世界的足跡</h2>
          <AuditList audit={audit} />
        </section>
      </div>
    </div>
  );
}
function Registry({ detail: { world }, run, busy }: Props) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [features, setFeatures] = useState<Record<string, string>>({});
  const kinds = [...new Set(world.elements.map((element) => element.kind))];
  const translatedName = (id: string, locale: Locale) =>
    world.translations[locale]?.elements[id]?.name;
  const elements = world.elements.filter(
    (el) =>
      (kind === "all" || kind === el.kind) &&
      JSON.stringify({
        ...el,
        translatedNames: (["en", "zh-Hant", "ja"] as const).map((locale) =>
          translatedName(el.id, locale),
        ),
      })
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function edit(id: string) {
    const el = world.elements.find((element) => element.id === id);
    if (!el) return;
    setEditingId(id);
    setName(el.names.en);
    setDefinition(el.definition);
    setFeatures(
      Object.fromEntries(
        el.features.map((feature) => [feature.id, feature.text]),
      ),
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    if (
      await run("校準元素", (d) =>
        patch(
          `${worldPath(world.id)}/elements/${encodeURIComponent(editingId)}`,
          {
            revision: d.world.revision,
            name: name.trim(),
            definition: definition.trim(),
            features,
          },
        ),
      )
    )
      setEditingId(null);
  }
  return (
    <section className="tab-content">
      <div className="section-heading">
        <div>
          <p className="eyebrow">THE ELEMENT REGISTRY</p>
          <h2>每一個名字，都有來處。</h2>
        </div>
        <span className="muted">{world.elements.length} 個登錄元素</span>
      </div>
      <div className="registry-tools">
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="搜尋元素與原文證據"
            placeholder="搜尋名稱、特色或原文證據⋯"
          />
        </label>
        <label className="inline-label">
          種類
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">所有種類</option>
            {kinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>
      {!elements.length ? (
        <div className="empty-world">
          <Search size={28} />
          <h3>
            {search || kind !== "all" ? "沒有符合的元素" : "等待世界展開"}
          </h3>
          <p>
            {search || kind !== "all"
              ? "試試不同的關鍵字或種類。"
              : "原作閱讀完成後，元素與來源證據會出現在這裡。"}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="registry-table">
            <thead>
              <tr>
                <th>元素 / 原名</th>
                <th>三語名稱</th>
                <th>定義、特色與校準</th>
              </tr>
            </thead>
            <tbody>
              {elements.map((el) => (
                <tr key={el.id}>
                  <td>
                    <span className="badge">{el.kind}</span>
                    <h3>{el.sourceName}</h3>
                    <code>{el.id}</code>
                    {el.aliases.length > 0 && (
                      <p className="field-note">
                        別名：{el.aliases.join("、")}
                      </p>
                    )}
                  </td>
                  <td>
                    <dl className="locale-names">
                      {(["en", "zh-Hant", "ja"] as const).map((locale) => (
                        <div key={locale}>
                          <dt>
                            {localeNames[locale]}
                            {world.translations[locale]?.status === "stale" && (
                              <span className="stale-name">待更新</span>
                            )}
                          </dt>
                          <dd lang={locale}>
                            {world.translations[locale]?.sourceRevision ===
                            world.revision
                              ? translatedName(el.id, locale) ||
                                el.names[locale] ||
                                "尚未命名"
                              : el.names[locale] ||
                                translatedName(el.id, locale) ||
                                "尚未命名"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                  <td>
                    {editingId === el.id ? (
                      <form
                        onSubmit={save}
                        className="element-editor form-stack"
                      >
                        <div className="section-heading">
                          <h3>校準元素描述</h3>
                          <PencilLine size={16} />
                        </div>
                        <p className="field-note">
                          修改後會建立新版本，視覺與翻譯需重新確認。原名與原文證據將保留。
                        </p>
                        <label>
                          英文名稱
                          <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            lang="en"
                            required
                            maxLength={300}
                          />
                        </label>
                        <label>
                          英文定義
                          <textarea
                            value={definition}
                            onChange={(e) => setDefinition(e.target.value)}
                            rows={4}
                            lang="en"
                            required
                            maxLength={5000}
                          />
                        </label>
                        {el.features.map((feature, i) => (
                          <label key={feature.id}>
                            特色 {i + 1}
                            <textarea
                              value={features[feature.id] || ""}
                              onChange={(e) =>
                                setFeatures({
                                  ...features,
                                  [feature.id]: e.target.value,
                                })
                              }
                              lang="en"
                              rows={3}
                              required
                              maxLength={5000}
                            />
                            <span className="source-quote">
                              原文：「{feature.quote || "無直接引句"}」
                            </span>
                          </label>
                        ))}
                        <div className="button-row">
                          <button
                            type="button"
                            className="subtle"
                            disabled={busy}
                            onClick={() => setEditingId(null)}
                          >
                            取消
                          </button>
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              !name.trim() ||
                              !definition.trim() ||
                              el.features.some((f) => !features[f.id]?.trim())
                            }
                          >
                            儲存校準
                            <Check size={14} />
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="element-definition">
                          <p>{el.definition}</p>
                          <button
                            className="icon-button"
                            disabled={busy}
                            onClick={() => edit(el.id)}
                            aria-label={`校準${el.sourceName}`}
                            title="校準名稱、定義與特色"
                          >
                            <PencilLine size={15} />
                          </button>
                        </div>
                        {el.features.map((feature) => (
                          <details className="feature" key={feature.id}>
                            <summary>
                              <span>{feature.text}</span>
                              <span
                                className={`feature-origin ${feature.origin}`}
                              >
                                {feature.origin === "source"
                                  ? "原文明示"
                                  : feature.origin === "inferred"
                                    ? "推論"
                                    : "作者校準"}
                                {feature.locked && " · 已鎖定"}
                              </span>
                              <ChevronDown size={14} />
                            </summary>
                            <blockquote>
                              {feature.quote || "此特色尚無直接原文引句。"}
                            </blockquote>
                            <span className="field-note">
                              來源片段：{feature.segmentId || "無"} · 特色 ID：
                              {feature.id}
                            </span>
                          </details>
                        ))}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function Questions({ detail: { world, source }, run, busy }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(world.questions.map((q) => [q.id, q.answer || ""])),
  );
  const unanswered = world.questions.filter((q) => !q.answer?.trim()).length;
  const dirty = world.questions.some(
    (q) => (answers[q.id] ?? q.answer ?? "") !== (q.answer ?? ""),
  );
  const clearingAnswer = world.questions.some(
    (q) => q.answer && !(answers[q.id] ?? q.answer).trim(),
  );
  const readComplete =
    source.segmentCount > 0 &&
    source.processedCount === source.segmentCount &&
    world.status !== "reading";
  const visualApproved =
    world.visualApproval?.revision === world.revision &&
    world.previews.some(
      (p) =>
        p.id === world.visualApproval?.previewId &&
        p.revision === world.revision &&
        p.styleId === world.selectedStyleId &&
        p.review.verdict === "pass",
    );
  const confirmReady = readComplete && !unanswered && visualApproved && !dirty;
  async function save(e: FormEvent) {
    e.preventDefault();
    await run("儲存回答", (d) =>
      patch(worldPath(world.id), {
        revision: d.world.revision,
        answers: Object.fromEntries(
          Object.entries(answers).filter(([, answer]) => answer.trim()),
        ),
      }),
    );
  }
  return (
    <div className="tab-content">
      <div className="section-heading">
        <div>
          <p className="eyebrow">AUTHOR’S DECISIONS</p>
          <h2>重要的留白，由你決定。</h2>
        </div>
        <span className="badge">{unanswered} 個待確認問題</span>
      </div>
      <p className="muted intro-copy">
        確認原作沒有說盡的地方，讓後續的世界有一致的起點。回答會保存在這個世界的版本中。
      </p>
      <form className="form-stack" onSubmit={save}>
        {world.questions.map((q, i) => (
          <section className="panel question-card" key={q.id}>
            <span className="question-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="grow">
              <h3>{q.question}</h3>
              <p className="muted">{q.context}</p>
              {q.options.length > 0 && (
                <div className="answer-options">
                  {q.options.map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={
                        answers[q.id] === option ? "choice selected" : "choice"
                      }
                      onClick={() => setAnswers({ ...answers, [q.id]: option })}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              <label>
                你的決定
                <textarea
                  rows={3}
                  value={answers[q.id] ?? q.answer ?? ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.id]: e.target.value })
                  }
                  placeholder="選擇建議，或直接補充你的設定。"
                  maxLength={4000}
                />
              </label>
            </div>
          </section>
        ))}
        {!world.questions.length && (
          <div className="panel">
            <p className="muted">
              {world.status === "reading"
                ? "閱讀完成後會列出需要確認的問題。"
                : "目前沒有待釐清的問題。"}
            </p>
          </div>
        )}
        {world.questions.length > 0 && (
          <div className="align-end">
            <button
              className="primary"
              disabled={
                busy || !dirty || !!clearingAnswer || world.status === "reading"
              }
            >
              儲存所有回答
              <Check size={16} />
            </button>
          </div>
        )}
      </form>
      <section className="confirmation-panel">
        <div>
          <ShieldCheck size={25} />
          <h2>封存世界的起點</h2>
          <p>確認內容與視覺方向後，便可準備語系與公開網站。</p>
          <ul className="checklist">
            <li className={readComplete ? "done" : ""}>
              <CheckCircle2 size={16} />
              原作已完整閱讀
            </li>
            <li className={!unanswered ? "done" : ""}>
              <CheckCircle2 size={16} />
              確認問答已儲存
            </li>
            <li className={visualApproved ? "done" : ""}>
              <CheckCircle2 size={16} />
              視覺預覽已核准
            </li>
          </ul>
        </div>
        <button
          className="primary"
          disabled={busy || !confirmReady || world.status === "confirmed"}
          onClick={() =>
            void run("確認世界", (d) =>
              post(`${worldPath(world.id)}/confirm`, {
                revision: d.world.revision,
              }),
            )
          }
        >
          {world.status === "confirmed" ? "世界已確認" : "確認這個世界"}
          <Check size={17} />
        </button>
      </section>
    </div>
  );
}
function Visual({ detail: { world, jobs }, run, busy, retry }: Props) {
  const [choice, setChoice] = useState(world.selectedStyleId || "");
  const [elementId, setElementId] = useState(world.elements[0]?.id || "");
  const [feedback, setFeedback] = useState("");
  const styleId = choice || world.selectedStyleId || world.styles[0]?.id || "";
  const targetElementId = elementId || world.elements[0]?.id || "";
  return (
    <div className="tab-content">
      <div className="section-heading">
        <div>
          <p className="eyebrow">A VISUAL LANGUAGE</p>
          <h2>尋找這個世界的觀看方式。</h2>
        </div>
        <span className="muted">{world.styles.length} 個視覺提案</span>
      </div>
      {!world.styles.length ? (
        <section className="empty-world">
          <ImagePlus size={30} />
          <h3>視覺方向仍在成形</h3>
          <p>完成原作閱讀後，這裡會顯示依原作提出的風格。</p>
        </section>
      ) : (
        <>
          <div className="style-grid">
            {world.styles.map((style, i) => (
              <button
                key={style.id}
                aria-pressed={styleId === style.id}
                className={`style-card ${styleId === style.id ? "selected" : ""}`}
                onClick={() => setChoice(style.id)}
              >
                <div className="style-palette">
                  {style.palette.map((color, j) => (
                    <span key={j} style={{ backgroundColor: color }} />
                  ))}
                  <span className="style-index">0{i + 1}</span>
                </div>
                <div className="style-card-body">
                  <div className="section-heading">
                    <p className="eyebrow">DIRECTION 0{i + 1}</p>
                    {styleId === style.id && <CheckCircle2 size={17} />}
                  </div>
                  <h3>{style.name}</h3>
                  <p>{style.description}</p>
                  <dl>
                    <div>
                      <dt>媒介</dt>
                      <dd>{style.medium}</dd>
                    </div>
                    <div>
                      <dt>光線</dt>
                      <dd>{style.lighting}</dd>
                    </div>
                    <div>
                      <dt>質感</dt>
                      <dd>{style.materials.join("、")}</dd>
                    </div>
                  </dl>
                  {style.evidence.length > 0 && (
                    <p className="style-evidence">
                      原作線索：{style.evidence.join("；")}
                    </p>
                  )}
                  {style.forbidden.length > 0 && (
                    <p className="field-note">
                      避免：{style.forbidden.join("、")}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
          <div className="align-end">
            <button
              className="subtle"
              disabled={busy || styleId === world.selectedStyleId}
              onClick={() =>
                void run("儲存視覺方向", (d) =>
                  patch(worldPath(world.id), {
                    revision: d.world.revision,
                    selectedStyleId: styleId,
                  }),
                )
              }
            >
              {styleId === world.selectedStyleId
                ? "已選定此方向"
                : "設為視覺方向"}
              <Check size={16} />
            </button>
          </div>
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">FROM WORDS TO AN IMAGE</p>
                <h2>讓風格遇見一個元素</h2>
              </div>
              <ImagePlus size={22} />
            </div>
            <div className="preview-form">
              <label>
                觀看的元素
                <select
                  value={targetElementId}
                  onChange={(e) => setElementId(e.target.value)}
                >
                  <option value="">選擇元素</option>
                  {world.elements.map((el) => (
                    <option key={el.id} value={el.id}>
                      {el.sourceName} · {el.kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                這次想調整的地方
                <textarea
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="例如：保留建築的粗糙質感，讓光線更柔和。"
                  maxLength={4000}
                />
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  !styleId ||
                  !targetElementId ||
                  styleId !== world.selectedStyleId ||
                  jobs.some(
                    (j) =>
                      j.kind.includes("visual") &&
                      ["queued", "running"].includes(j.status),
                  )
                }
                onClick={() =>
                  void run("建立視覺預覽", (d) =>
                    post(`${worldPath(world.id)}/visual-previews`, {
                      revision: d.world.revision,
                      styleId,
                      elementId: targetElementId,
                      feedback,
                    }),
                  )
                }
              >
                生成視覺預覽
                <ImagePlus size={17} />
              </button>
              {styleId !== world.selectedStyleId && (
                <p className="field-note">
                  先將選取提案設為視覺方向，再產生預覽。
                </p>
              )}
            </div>
          </section>
        </>
      )}
      <JobList
        jobs={jobs.filter(
          (j) => j.kind.includes("visual") || j.kind.includes("image"),
        )}
        retry={retry}
        busy={busy}
      />
      {world.previews.length > 0 && (
        <>
          <div className="section-heading">
            <h2>影像與校準</h2>
            <span className="muted">核對原作，再選擇要留下的版本。</span>
          </div>
          <div className="preview-grid">
            {[...world.previews].reverse().map((preview) => (
              <article className="preview-card" key={preview.id}>
                <a
                  href={`/media/${encodeURIComponent(preview.assetId)}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="開啟完整預覽圖片"
                >
                  <img
                    src={`/media/${encodeURIComponent(preview.assetId)}`}
                    alt={`${world.elements.find((el) => el.id === preview.elementId)?.sourceName || world.title}的視覺預覽`}
                    loading="lazy"
                  />
                </a>
                <div className="preview-body">
                  <div className="section-heading">
                    <h3>
                      {world.styles.find(
                        (style) => style.id === preview.styleId,
                      )?.name || "視覺預覽"}
                    </h3>
                    <span className={`badge ${preview.review.verdict}`}>
                      {statusName(preview.review.verdict)}
                    </span>
                  </div>
                  <p className="field-note">
                    第 {preview.revision} 版 · {date(preview.createdAt)}
                  </p>
                  {preview.feedback && <p>{preview.feedback}</p>}
                  <p className="field-note">
                    {preview.revision !== world.revision
                      ? "世界設定已更新，請產生新的預覽。"
                      : preview.styleId !== world.selectedStyleId
                        ? "此影像不屬於目前選定的視覺方向。"
                        : ""}
                  </p>
                  <ul className="review-notes">
                    {preview.review.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                  <button
                    className={
                      world.visualApproval?.previewId === preview.id
                        ? "subtle"
                        : "primary"
                    }
                    disabled={
                      busy ||
                      preview.review.verdict !== "pass" ||
                      preview.revision !== world.revision ||
                      preview.styleId !== world.selectedStyleId ||
                      world.visualApproval?.previewId === preview.id
                    }
                    onClick={() =>
                      void run("核准視覺預覽", (d) =>
                        post(`${worldPath(world.id)}/visual-approval`, {
                          revision: d.world.revision,
                          previewId: preview.id,
                        }),
                      )
                    }
                  >
                    {world.visualApproval?.previewId === preview.id
                      ? "已核准此影像"
                      : "選定並核准"}
                    <Check size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function Chat({ detail: { world, messages }, run, busy }: Props) {
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() || world.status === "reading") return;
    const ok = await run("傳送訊息", (d) =>
      post(`${worldPath(world.id)}/chat`, {
        message: message.trim(),
        revision: d.world.revision,
      }),
    );
    if (ok) setMessage("");
  }
  return (
    <section className="tab-content chat-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">A CONVERSATION WITH YOUR WORLD</p>
          <h2>一起把世界說清楚。</h2>
        </div>
        <MessageCircle size={24} />
      </div>
      <p className="muted">
        討論原作、修正誤讀，或補充你的決定。世界內容更新後，請重新確認受影響的視覺與翻譯。
      </p>
      {world.status === "reading" && (
        <p role="status">原作仍在閱讀中，完成全文分析後即可討論與調整設定。</p>
      )}
      <div className="chat-messages" role="log" aria-label="世界對話">
        {!messages.length ? (
          <div className="empty-world">
            <MessageCircle size={28} />
            <h3>從一個問題開始。</h3>
            <p>你可以詢問原文證據，或說明這個世界應該如何被理解。</p>
          </div>
        ) : (
          messages.map((msg) => (
            <article key={msg.id} className={`chat-message ${msg.role}`}>
              <span className="chat-avatar">
                {msg.role === "user" ? "你" : "W"}
              </span>
              <div>
                <div className="chat-meta">
                  <strong>
                    {msg.role === "user" ? "作者" : "World Studio"}
                  </strong>
                  <time dateTime={msg.createdAt}>{date(msg.createdAt)}</time>
                </div>
                <p>{msg.content}</p>
              </div>
            </article>
          ))
        )}
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-message">
          對話訊息
        </label>
        <textarea
          id="chat-message"
          disabled={world.status === "reading"}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="告訴 Studio 你想調整的設定⋯"
          rows={3}
          required
          maxLength={8000}
        />
        <button
          className="primary"
          disabled={busy || !message.trim() || world.status === "reading"}
          aria-label="傳送訊息"
        >
          <Send size={18} />
          <span>傳送</span>
        </button>
      </form>
    </section>
  );
}
function Translations(props: Props) {
  const [locale, setLocale] = useState<Locale>("en");
  const translation = props.detail.world.translations[locale];
  return (
    <div className="tab-content">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ONE WORLD, MANY VOICES</p>
          <h2>讓每一種語言，看見同一個世界。</h2>
        </div>
        <Languages size={23} />
      </div>
      <div className="segmented locale-tabs">
        {(["en", "zh-Hant", "ja"] as const).map((l) => (
          <button
            key={l}
            className={locale === l ? "selected" : ""}
            aria-pressed={locale === l}
            onClick={() => setLocale(l)}
          >
            {localeNames[l]}
            {props.detail.world.translations[l] && (
              <span className="badge">
                {statusName(props.detail.world.translations[l]!.status)}
              </span>
            )}
          </button>
        ))}
      </div>
      <TranslationEditor
        key={`${locale}-${translation?.sourceRevision}-${translation?.status}-${translation?.approvedAt}`}
        {...props}
        locale={locale}
        translation={translation}
      />
    </div>
  );
}
function TranslationEditor({
  detail: { world, jobs },
  run,
  busy,
  retry,
  locale,
  translation,
}: Props & { locale: Locale; translation?: Translation }) {
  const [draft, setDraft] = useState<Translation | null>(
    translation ? structuredClone(translation) : null,
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(translation ? structuredClone(translation) : null);
  }, [translation, dirty]);
  const reference = world.translations.en;
  const localePath = `${worldPath(world.id)}/translations/${encodeURIComponent(locale)}`;
  const processing = jobs.some(
    (job) =>
      ["queued", "running"].includes(job.status) &&
      job.kind.includes("translat"),
  );
  function update(value: Partial<Translation>) {
    if (draft) {
      setDraft({ ...draft, ...value });
      setDirty(true);
    }
  }
  function updateElement(
    id: string,
    value: Partial<NonNullable<Translation["elements"][string]>>,
  ) {
    if (draft) {
      setDraft({
        ...draft,
        elements: {
          ...draft.elements,
          [id]: { ...draft.elements[id], ...value },
        },
      });
      setDirty(true);
    }
  }
  async function save() {
    if (
      draft &&
      (await run("儲存語系內容", (d) =>
        patch(localePath, { revision: d.world.revision, translation: draft }),
      ))
    )
      setDirty(false);
  }
  return (
    <>
      <div className="translation-toolbar">
        <div>
          {translation ? (
            <>
              <span className={`badge ${translation.status}`}>
                {statusName(translation.status)}
              </span>
              <span className="field-note">
                來源第 {translation.sourceRevision} 版
                {translation.status === "stale"
                  ? " · 世界內容已更新，請重新產生"
                  : ""}
              </span>
            </>
          ) : (
            <p className="muted">尚未建立 {localeNames[locale]} 內容。</p>
          )}
        </div>
        <button
          className="subtle"
          disabled={busy || processing || world.status !== "confirmed" || dirty}
          onClick={() =>
            void run("建立語系翻譯", (d) =>
              post(`${worldPath(world.id)}/translations`, {
                revision: d.world.revision,
                locale,
              }),
            )
          }
        >
          {translation ? "重新產生語系" : "建立語系內容"}
          <Languages size={16} />
        </button>
      </div>
      {world.status !== "confirmed" && (
        <p className="notice">
          先完成問答、視覺核准與世界確認，再準備公開語系。
        </p>
      )}
      <JobList
        jobs={jobs.filter((j) => j.kind.includes("translat"))}
        busy={busy}
        retry={retry}
      />
      {draft && (
        <>
          <div className="translation-compare-heading">
            <span>{locale === "en" ? "世界原始設定" : "English · 對照"}</span>
            <span>{localeNames[locale]} · 編輯</span>
          </div>
          <div className="translation-fields">
            {(["title", "tagline", "introduction"] as const).map((field) => (
              <div className="translation-row" key={field}>
                <div className="reference-text">
                  <span className="field-label">
                    {
                      {
                        title: "世界名稱",
                        tagline: "短標語",
                        introduction: "世界簡介",
                      }[field]
                    }
                  </span>
                  <p>
                    {locale === "en"
                      ? field === "title"
                        ? world.title
                        : field === "introduction"
                          ? world.summary
                          : "依世界內容撰寫簡短介紹。"
                      : reference?.[field] || "英文內容尚未建立。"}
                  </p>
                </div>
                <label>
                  <span className="sr-only">
                    {localeNames[locale]} {field}
                  </span>
                  <textarea
                    lang={locale}
                    rows={field === "introduction" ? 6 : 2}
                    maxLength={
                      field === "introduction"
                        ? 12000
                        : field === "tagline"
                          ? 1000
                          : 300
                    }
                    value={draft[field]}
                    onChange={(e) => update({ [field]: e.target.value })}
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="section-heading">
            <h3>元素與特色</h3>
            <span className="field-note">同一元素 ID，對應各語系名稱。</span>
          </div>
          {world.elements.map((el) => {
            const localized = draft.elements[el.id];
            const en = reference?.elements[el.id];
            return (
              <section className="translation-element panel" key={el.id}>
                <div className="section-heading">
                  <h3>{el.sourceName}</h3>
                  <code>{el.id}</code>
                </div>
                <div className="translation-row">
                  <div className="reference-text">
                    <span className="field-label">名稱</span>
                    <p>
                      {locale === "en"
                        ? el.names.en || el.sourceName
                        : en?.name || el.names.en}
                    </p>
                  </div>
                  <label>
                    譯名
                    <input
                      lang={locale}
                      maxLength={300}
                      value={localized?.name || ""}
                      onChange={(e) =>
                        updateElement(el.id, { name: e.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="translation-row">
                  <div className="reference-text">
                    <span className="field-label">定義</span>
                    <p>
                      {locale === "en"
                        ? el.definition
                        : en?.definition || el.definition}
                    </p>
                  </div>
                  <label>
                    定義
                    <textarea
                      lang={locale}
                      rows={3}
                      maxLength={5000}
                      value={localized?.definition || ""}
                      onChange={(e) =>
                        updateElement(el.id, { definition: e.target.value })
                      }
                    />
                  </label>
                </div>
                {el.features.map((feature) => (
                  <div className="translation-row" key={feature.id}>
                    <div className="reference-text">
                      <span className="field-label">特色</span>
                      <p>
                        {locale === "en"
                          ? feature.text
                          : en?.features[feature.id] || feature.text}
                      </p>
                    </div>
                    <label>
                      特色譯文
                      <textarea
                        rows={2}
                        maxLength={5000}
                        lang={locale}
                        value={localized?.features?.[feature.id] || ""}
                        onChange={(e) =>
                          updateElement(el.id, {
                            features: {
                              ...localized?.features,
                              [feature.id]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
              </section>
            );
          })}
          {translation?.issues.length ? (
            <div className="notice error">
              <strong>審查待調整</strong>
              <ul>
                {translation.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : translation?.status === "review" ? (
            <p className="notice success">
              審查沒有列出待調整事項，請檢視譯文後核准。
            </p>
          ) : null}
          <div className="translation-actions">
            <span className="field-note">
              {dirty
                ? "有尚未儲存的修改，請先儲存再審查。"
                : "修改後需重新審查，核准後才可發布。"}
            </span>
            <div className="button-row">
              <button
                className="subtle"
                disabled={busy || !dirty}
                onClick={() => void save()}
              >
                儲存修改
                <Check size={16} />
              </button>
              <button
                className="subtle"
                disabled={
                  busy || dirty || processing || translation?.status === "stale"
                }
                onClick={() =>
                  void run("審查語系內容", (d) =>
                    post(`${localePath}/review`, {
                      revision: d.world.revision,
                    }),
                  )
                }
              >
                重新審查
                <ShieldCheck size={16} />
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  dirty ||
                  processing ||
                  translation?.status !== "review" ||
                  !!translation.issues.length
                }
                onClick={() =>
                  void run("核准語系", (d) =>
                    post(`${localePath}/approve`, {
                      revision: d.world.revision,
                    }),
                  )
                }
              >
                核准語系
                <Check size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
type SitePreview = {
  id: string;
  url: string;
  hash: string;
  revision: number;
  locales: Locale[];
  fingerprint: string;
};
function releaseFingerprint(
  world: WorldDraft,
  slug: string,
  locales: Locale[],
) {
  return JSON.stringify({
    revision: world.revision,
    slug,
    locales: [...locales].sort(),
    translations: world.translations,
    visualApproval: world.visualApproval,
  });
}
function Release({ detail: { world, releases, audit }, run, busy }: Props) {
  const [slug, setSlug] = useState(releases[0]?.slug || "");
  const [selectedLocales, setSelectedLocales] = useState<Locale[]>(["en"]);
  const [candidate, setCandidate] = useState<SitePreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<{ url: string; status: string } | null>(
    null,
  );
  const fingerprint = releaseFingerprint(world, slug, selectedLocales);
  const currentCandidate =
    candidate?.fingerprint === fingerprint ? candidate : null;
  useEffect(() => {
    setCandidate((previous) =>
      previous?.fingerprint === fingerprint ? previous : null,
    );
    setReviewed(false);
    setResult(null);
  }, [fingerprint]);
  const ready =
    world.status === "confirmed" &&
    world.visualApproval?.revision === world.revision &&
    selectedLocales.every(
      (l) =>
        world.translations[l]?.status === "approved" &&
        world.translations[l]?.sourceRevision === world.revision,
    );
  async function preview(e: FormEvent) {
    e.preventDefault();
    setCandidate(null);
    setReviewed(false);
    setResult(null);
    await run("建立網站預覽", async (d) => {
      const response = await post<{
        preview: Omit<SitePreview, "fingerprint">;
      }>(`${worldPath(world.id)}/site-previews`, {
        revision: d.world.revision,
        slug,
        locales: selectedLocales,
      });
      setCandidate({
        ...response.preview,
        fingerprint: releaseFingerprint(d.world, slug, selectedLocales),
      });
    });
  }
  async function publish() {
    if (!currentCandidate || !reviewed) return;
    const approvedCandidate = currentCandidate;
    setResult(null);
    await run("發布網站", async (d) => {
      if (
        approvedCandidate.revision !== d.world.revision ||
        approvedCandidate.fingerprint !==
          releaseFingerprint(d.world, slug, selectedLocales)
      ) {
        setCandidate(null);
        setReviewed(false);
        throw new Error("世界內容或發布設定已更新，請建立並檢視新的網站預覽。");
      }
      const response = await post<{ release: { url: string; status: string } }>(
        `${worldPath(world.id)}/releases`,
        {
          revision: d.world.revision,
          slug,
          locales: selectedLocales,
          previewId: approvedCandidate.id,
        },
      );
      setResult(response.release);
    });
  }
  const previewHref = (locale: Locale) =>
    currentCandidate
      ? `/preview/${encodeURIComponent(currentCandidate.id)}/${locale}?world=${encodeURIComponent(world.id)}`
      : "#";
  return (
    <div className="tab-content">
      <div className="section-heading">
        <div>
          <p className="eyebrow">OPEN THE DOOR TO YOUR WORLD</p>
          <h2>把世界，交給下一位旅人。</h2>
        </div>
        <ArrowUpRight size={25} />
      </div>
      <div className="two-column">
        <section className="panel">
          <h3>先預覽，再打開世界。</h3>
          <p className="muted">
            以核准的內容建立私人網站預覽。檢視實際頁面後，再決定正式發布。
          </p>
          <form className="form-stack" onSubmit={preview}>
            <label>
              網址名稱
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                disabled={busy}
                placeholder="your-world-name"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                title="使用小寫英文字母、數字與連字號"
                required
                maxLength={63}
              />
              <span className="field-note">
                /en/worlds/{slug || "your-world-name"}
              </span>
            </label>
            <fieldset>
              <legend>發布語系</legend>
              {(["en", "zh-Hant", "ja"] as const).map((locale) => (
                <label className="locale-checkbox" key={locale}>
                  <input
                    type="checkbox"
                    checked={selectedLocales.includes(locale)}
                    disabled={
                      locale === "en" ||
                      busy ||
                      world.translations[locale]?.status !== "approved"
                    }
                    onChange={(e) =>
                      setSelectedLocales(
                        e.target.checked
                          ? [...selectedLocales, locale]
                          : selectedLocales.filter((l) => l !== locale),
                      )
                    }
                  />
                  <span>
                    {localeNames[locale]}
                    {locale === "en" && " · 預設"}
                  </span>
                  <span className="badge">
                    {world.translations[locale]
                      ? statusName(world.translations[locale]!.status)
                      : "未建立"}
                  </span>
                </label>
              ))}
            </fieldset>
            <button className="subtle" disabled={busy || !ready}>
              {currentCandidate ? "重新建立網站預覽" : "建立網站預覽"}
              <ExternalLink size={16} />
            </button>
            {!ready && (
              <p className="field-note">
                請完成世界確認、視覺核准，以及所有選定語系的審查與核准。
              </p>
            )}
          </form>
          {currentCandidate ? (
            <section
              className="site-preview-candidate"
              aria-labelledby="candidate-heading"
            >
              <div className="section-heading">
                <h4 id="candidate-heading">私人網站預覽</h4>
                <span className="badge">尚未發布</span>
              </div>
              <p className="field-note">
                第 {currentCandidate.revision} 版 ·{" "}
                {currentCandidate.locales
                  .map((l) => localeNames[l])
                  .join(" / ")}
                。請開啟各語系頁面，檢視影像、介紹與元素內容。
              </p>
              <div className="preview-language-links">
                {currentCandidate.locales.map((locale) => (
                  <a
                    key={locale}
                    className="subtle"
                    href={previewHref(locale)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {localeNames[locale]} 預覽
                    <ExternalLink size={14} />
                  </a>
                ))}
              </div>
              <details className="technical-detail">
                <summary>
                  預覽內容指紋
                  <ChevronDown size={14} />
                </summary>
                <code>{currentCandidate.hash}</code>
              </details>
              <label className="preview-confirmation">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                  disabled={busy}
                />
                <span>我已檢視這份預覽，確認發布以上內容與語系。</span>
              </label>
              <button
                className="primary"
                disabled={busy || !ready || !reviewed}
                onClick={() => void publish()}
              >
                正式發布世界網站
                <ArrowUpRight size={17} />
              </button>
            </section>
          ) : (
            ready && (
              <p className="notice">
                請先建立並檢視網站預覽。世界內容、網址或語系改變後，需重新建立預覽。
              </p>
            )
          )}
          {result && (
            <div
              className={`notice ${result.status === "active" ? "success" : ""}`}
            >
              <strong>
                {result.status === "active"
                  ? "世界已正式公開"
                  : `發布狀態：${statusName(result.status)}`}
              </strong>
              {result.status === "active" && (
                <a href={result.url} target="_blank" rel="noreferrer">
                  開啟正式世界網站
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
          )}
        </section>
        <section className="release-note">
          <span className="eyebrow">A WORLD WORTH EXPLORING</span>
          <div className="release-monogram" aria-hidden="true">
            W.
          </div>
          <h3>
            每一個入口，
            <br />
            都連向一個完整的世界。
          </h3>
          <p>原作留在你的工作室。讀者看見的是你確認的介紹、元素與影像。</p>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>發布紀錄</h2>
          <span className="muted">{releases.length} 個版本</span>
        </div>
        {!releases.length ? (
          <p className="empty-inline">還沒有發布紀錄。</p>
        ) : (
          <div className="release-list">
            {releases.map((release) => (
              <article key={release.id}>
                <div>
                  <h3>{release.slug}</h3>
                  <p className="field-note">
                    第 {release.revision} 版 · {date(release.createdAt)} ·{" "}
                    {release.locales.map((l) => localeNames[l]).join(" / ")}
                  </p>
                  <code className="hash">{release.hash}</code>
                </div>
                <span className={`badge ${release.status}`}>
                  {statusName(release.status)}
                </span>
                {release.status === "active" && (
                  <a
                    className="subtle"
                    href={release.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    開啟網站
                    <ExternalLink size={15} />
                  </a>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h2>核准與發布足跡</h2>
        <AuditList audit={audit} />
      </section>
    </div>
  );
}
