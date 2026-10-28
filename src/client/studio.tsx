import { PRODUCT_VERSION, PRODUCT_LABEL } from "../shared/version";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Globe2,
  Layers,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import type {
  AuditEvent,
  Job,
  StudioOverview,
  WorldDetail,
} from "../shared/contracts";
import { api, post, ApiError, errorMessage } from "./api";
import { ImportSource } from "./import-source";
import { reviewTabStatus } from "./world-workflow";
import { WorldPanels } from "./world-panels";
import { ImportReviewDialog } from "./import-dialogue";

export const date = (value: string) =>
  new Intl.DateTimeFormat("zh-TW", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const activeJob = (job: Job) =>
  job.status === "queued" || job.status === "running";
export const statusName = (status: string) =>
  ({
    reading: "整理中",
    draft: "待確認",
    confirmed: "已確認",
    queued: "等待中",
    running: "進行中",
    waiting_user: "需要你確認",
    succeeded: "已完成",
    failed: "失敗",
    approved: "已核准",
    review: "待審核",
    stale: "需更新",
    verifying: "驗證中",
    active: "已發布",
    pass: "通過",
    revise: "待調整",
  })[status] || status;
export type RunAction = (
  label: string,
  operation: (detail: WorldDetail) => Promise<unknown>,
) => Promise<boolean>;

function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol" aria-hidden="true">
        <Globe2 size={24} strokeWidth={1.1} />
      </span>
      <span>
        Agentic Life<small>WORLD STUDIO</small>
      </span>
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function login(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      await post("/api/login", { password });
      setPassword("");
      onLogin();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-story">
        <Brand />
        <div>
          <p className="eyebrow">EVERY WORLD BEGINS WITH WORDS.</p>
          <h1>
            讓文字，
            <br />
            有了自己的
            <br />
            <em>世界。</em>
          </h1>
          <p>
            收藏原作裡的線索，描繪它的地貌與生命。
            <br />
            從你的第一個故事開始。
          </p>
        </div>
        <small>AGENTIC LIFE WORLD STUDIO · {PRODUCT_LABEL}</small>
      </div>
      <section className="login-form">
        <div className="form-stack">
          <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
          <h2>歡迎回到 Studio</h2>
          <p className="muted">輸入密碼，繼續編織你的世界。</p>
          <form onSubmit={login} className="form-stack">
            <label>
              Studio 密碼
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                autoFocus
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={pending}>
              {pending ? "登入中⋯" : "進入 Studio"}
              <ArrowUpRight size={18} />
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
export function JobList({
  jobs,
  retry,
  busy,
  openWorld,
}: {
  jobs: Job[];
  retry: (id: string) => void;
  busy: boolean;
  openWorld?: (id: string) => void;
}) {
  if (!jobs.length) return <p className="empty-inline">目前沒有工作。</p>;
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <div key={job.id} className="job-row">
          <div className={`status-dot ${job.status}`} />
          <div className="grow">
            <div className="job-title">
              <strong>
                {(
                  {
                    import: "原作閱讀",
                    ingest: "原作閱讀",
                    compile: "世界建構",
                    resolve: "世界設定",
                    visual: "視覺預覽",
                    translate: "語系翻譯",
                    translation: "語系翻譯",
                    translation_review: "翻譯審查",
                    "translation-review": "翻譯審查",
                  } as Record<string, string>
                )[job.kind] || "世界整理"}
              </strong>
              <span className={`badge ${job.status}`}>
                {statusName(job.status)}
              </span>
            </div>
            <p>
              {job.status === "waiting_user"
                ? "請開啟確認對話後繼續"
                : job.status === "succeeded"
                  ? "整理完成"
                  : (
                      {
                        reading: "逐段閱讀原作",
                        import: "開始閱讀原作",
                        resolve: "整理你的設定",
                        visual: "準備視覺預覽",
                        translate: "整理語系內容",
                        translation_review: "核對語系內容",
                        author_brief_updated: "套用最新補充",
                      } as Record<string, string>
                    )[job.stage] || "正在整理這份世界"}
            </p>
            {job.total > 0 && (
              <>
                <progress
                  max={job.total}
                  value={job.completed}
                  aria-label="工作進度"
                />
                <small>
                  {job.completed} / {job.total}
                </small>
              </>
            )}
            {job.error && <p className="error-text">{job.error}</p>}
          </div>
          {job.status === "waiting_user" && job.worldId && openWorld && (
            <button
              className="subtle"
              disabled={busy}
              onClick={() => openWorld(job.worldId!)}
            >
              前往確認
              <ArrowUpRight size={14} />
            </button>
          )}
          {job.status === "failed" && (
            <button
              className="subtle"
              onClick={() => retry(job.id)}
              disabled={busy}
            >
              <RefreshCw size={14} />
              重試
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
export function AuditList({ audit }: { audit: AuditEvent[] }) {
  return audit.length ? (
    <ol className="audit-list">
      {audit.map((event) => (
        <li key={event.id}>
          <span className="audit-point" />
          <div>
            <p>{event.message}</p>
            <time dateTime={event.createdAt}>{date(event.createdAt)}</time>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className="empty-inline">操作紀錄會在這裡留下足跡。</p>
  );
}

export function Studio() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [overview, setOverview] = useState<StudioOverview | null>(null);
  const [selected, setSelected] = useState<string | null>(
    new URLSearchParams(location.search).get("world"),
  );
  const [detail, setDetail] = useState<WorldDetail | null>(null);
  const [tab, setTab] = useState("source");
  const [importing, setImporting] = useState(false);
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const seenReviewIds = useRef(new Set<string>());
  const [pending, setPending] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  const session = useCallback(async () => {
    setSessionError("");
    try {
      setAuthenticated(
        (await api<{ authenticated: boolean }>("/api/session")).authenticated,
      );
    } catch (e) {
      setSessionError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void session();
  }, [session]);
  const loadOverview = useCallback(async () => {
    const result = await api<StudioOverview>("/api/overview");
    setOverview(result);
    return result;
  }, []);
  const loadWorld = useCallback(async (id: string) => {
    const result = await api<WorldDetail>(
      `/api/worlds/${encodeURIComponent(id)}`,
    );
    if (selectionRef.current === id)
      setDetail((current) =>
        current?.world.id === id &&
        (current.world.recordVersion ?? 0) > (result.world.recordVersion ?? 0)
          ? current
          : result,
      );
    return result;
  }, []);
  const handleError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) setAuthenticated(false);
    setError(errorMessage(e));
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    void loadOverview().catch(handleError);
  }, [authenticated, loadOverview, handleError]);
  useEffect(() => {
    if (!authenticated || !selected) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError("");
    void loadWorld(selected)
      .catch(handleError)
      .finally(() => {
        if (selectionRef.current === selected) setLoading(false);
      });
  }, [selected, authenticated, loadWorld, handleError]);
  useEffect(() => {
    const review = detail?.importReview;
    if (
      review &&
      review.kind !== "brief" &&
      !seenReviewIds.current.has(review.id)
    ) {
      seenReviewIds.current.add(review.id);
      setOpenReviewId(review.id);
    }
  }, [detail?.importReview?.id]);
  const polling = selected
    ? !!detail?.jobs.some(activeJob)
    : !!overview?.jobs.some(activeJob);
  useEffect(() => {
    if (!authenticated || !polling) return;
    let stopped = false,
      running = false;
    const timer = window.setInterval(async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        if (selected) await loadWorld(selected);
        await loadOverview();
      } catch (e) {
        if (!stopped) handleError(e);
      } finally {
        running = false;
      }
    }, 4500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [authenticated, polling, selected, loadWorld, loadOverview, handleError]);
  function select(id: string | null) {
    setOpenReviewId(null);
    setSelected(id);
    setDetail(null);
    setTab("source");
    setError("");
    setSuccess("");
    const url = new URL(location.href);
    id ? url.searchParams.set("world", id) : url.searchParams.delete("world");
    history.replaceState(null, "", url);
  }
  const run: RunAction = async (label, operation) => {
    if (!selected || pending) return false;
    const id = selected;
    setPending(label);
    setError("");
    setSuccess("");
    try {
      const latest = await loadWorld(id);
      await operation(latest);
      await loadWorld(id);
      await loadOverview();
      setSuccess(`${label}完成`);
      return true;
    } catch (e) {
      handleError(e);
      await loadWorld(id).catch(() => {});
      return false;
    } finally {
      setPending("");
    }
  };
  async function retry(id: string) {
    setPending("重試工作");
    setError("");
    try {
      await post(`/api/jobs/${encodeURIComponent(id)}/retry`);
      if (selected) await loadWorld(selected);
      await loadOverview();
      setSuccess("已重新排入工作");
    } catch (e) {
      handleError(e);
    } finally {
      setPending("");
    }
  }
  async function refresh() {
    setPending("重新整理");
    setError("");
    try {
      if (selected) await loadWorld(selected);
      await loadOverview();
    } catch (e) {
      handleError(e);
    } finally {
      setPending("");
    }
  }
  async function logout() {
    setPending("登出");
    try {
      await post("/api/logout");
      setAuthenticated(false);
      setOverview(null);
      setDetail(null);
    } catch (e) {
      handleError(e);
    } finally {
      setPending("");
    }
  }
  if (authenticated === null)
    return (
      <main className="center-screen">
        <Brand />
        {sessionError ? (
          <>
            <p className="notice error" role="alert">
              {sessionError}
            </p>
            <button onClick={() => void session()} className="primary">
              重新連線
            </button>
          </>
        ) : (
          <p className="muted" role="status">
            正在開啟 Studio⋯
          </p>
        )}
      </main>
    );
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  const worlds =
    overview?.worlds.filter((w) =>
      `${w.title} ${w.summary}`.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const tabs = [
    ["source", "原作與世界"],
    ["review", "世界審核"],
    ["registry", "元素登錄"],
    ["visual", "視覺方向"],
    ["chat", "AI 對話"],
    ["translations", "語系校準"],
    ["release", "網站發布"],
  ];
  return (
    <div className="studio-layout">
      <a className="skip-link" href="#main-content">
        跳到主要內容
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">
          PRIVATE WORKSPACE
          <span className="status-dot succeeded" />
        </div>
        <button
          className={`nav-main ${!selected ? "current" : ""}`}
          disabled={!!pending}
          onClick={() => select(null)}
        >
          <Layers size={18} />
          工作總覽
          <ChevronRight size={15} />
        </button>
        <div className="sidebar-section-title">
          你的世界
          <button
            aria-label="匯入新世界"
            className="icon-button"
            onClick={() => setImporting(true)}
          >
            <Plus size={17} />
          </button>
        </div>
        <label className="search-field sidebar-search">
          <Search size={15} />
          <input
            aria-label="搜尋世界"
            placeholder="尋找世界⋯"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <nav aria-label="世界列表" className="world-nav">
          {worlds.map((world, i) => (
            <button
              key={world.id}
              className={`world-nav-item ${selected === world.id ? "current" : ""}`}
              disabled={!!pending}
              onClick={() => select(world.id)}
            >
              <span className="world-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{world.title}</strong>
                <small>
                  {statusName(world.status)} · {world.elements.length} 個元素
                </small>
              </span>
            </button>
          ))}
          {overview && !worlds.length && (
            <p className="sidebar-empty">
              {search ? "沒有符合的世界。" : "每個世界，都從一篇原作開始。"}
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="studio-version">
            <span className="avatar">MK</span>
            <span>
              作者工作室
              <small>Studio · v{overview?.version || PRODUCT_VERSION}</small>
            </span>
            <button
              className="icon-button"
              disabled={!!pending}
              onClick={() => void logout()}
              aria-label="登出"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="muted">Studio</span>
            <ChevronRight size={13} />
            <span>{selected ? detail?.world.title || "世界" : "工作總覽"}</span>
          </div>
          <div>
            <button
              className="icon-button"
              aria-label="重新整理資料"
              title="重新整理"
              disabled={!!pending}
              onClick={() => void refresh()}
            >
              <RefreshCw
                size={16}
                className={pending === "重新整理" ? "spin" : ""}
              />
            </button>
            <span className="private-label">
              <span className="status-dot succeeded" />
              私人空間
            </span>
          </div>
        </header>
        <main id="main-content" className="studio-main">
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="關閉錯誤提示"
              >
                ×
              </button>
            </div>
          )}
          <div className="action-status" role="status" aria-live="polite">
            {pending ? (
              <>
                <span className="small-loader" />
                {pending}中⋯
              </>
            ) : success ? (
              <>
                <Check size={14} />
                {success}
              </>
            ) : null}
          </div>
          {!selected ? (
            <>
              <section className="overview-hero">
                <div>
                  <p className="eyebrow">THE WORLD IS WAITING TO BE WRITTEN.</p>
                  <h1>
                    故事之後，
                    <br />
                    <em>世界才正要開始。</em>
                  </h1>
                  <p>
                    讓原作裡的地貌、生命與規則，
                    <br />
                    成為一個可以走入的世界。
                  </p>
                  <button
                    className="primary"
                    onClick={() => setImporting(true)}
                  >
                    匯入新的原作
                    <Plus size={17} />
                  </button>
                </div>
                <div className="orbital-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="orbit orbit-three" />
                  <span className="orbit-center">W</span>
                  <span className="orbit-caption">WORDS → WORLDS</span>
                  <span className="orbit-coordinate">
                    01 / INFINITE POSSIBILITIES
                  </span>
                </div>
              </section>
              <section className="overview-stats" aria-label="工作室狀態">
                <div>
                  <span>世界收藏</span>
                  <strong>
                    {overview?.worlds.length ?? "—"}
                    <small>個世界</small>
                  </strong>
                </div>
                <div>
                  <span>進行中的工作</span>
                  <strong>
                    {overview?.jobs.filter(activeJob).length ?? "—"}
                    <small>個工作</small>
                  </strong>
                </div>
                <div>
                  <span>待確認草稿</span>
                  <strong>
                    {overview?.worlds.filter((w) => w.status === "draft")
                      .length ?? "—"}
                    <small>份草稿</small>
                  </strong>
                </div>
              </section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">YOUR COLLECTION</p>
                  <h2>正在成形的世界</h2>
                </div>
                <span className="muted small">
                  以原作為起點，由你決定方向。
                </span>
              </div>
              {!overview ? (
                <p className="empty-inline" role="status">
                  正在讀取世界⋯
                </p>
              ) : !overview.worlds.length ? (
                <section className="empty-world">
                  <BookOpen size={30} strokeWidth={1.2} />
                  <h3>第一個世界，留給你的故事。</h3>
                  <p>
                    匯入一份原作，Studio 會閱讀全文並整理元素與待確認的線索。
                  </p>
                  <button className="subtle" onClick={() => setImporting(true)}>
                    開始收藏
                    <ArrowUpRight size={16} />
                  </button>
                </section>
              ) : (
                <div className="world-grid">
                  {overview.worlds.map((world, i) => (
                    <button
                      className="world-card"
                      key={world.id}
                      disabled={!!pending}
                      onClick={() => select(world.id)}
                    >
                      <div className="world-card-top">
                        <span className="eyebrow">
                          WORLD / {String(i + 1).padStart(2, "0")}
                        </span>
                        <span
                          className={`badge ${overview.jobs.some((job) => job.worldId === world.id && job.status === "waiting_user") ? "waiting_user" : world.status}`}
                        >
                          {overview.jobs.some(
                            (job) =>
                              job.worldId === world.id &&
                              job.status === "waiting_user",
                          )
                            ? "需要你確認"
                            : statusName(world.status)}
                        </span>
                      </div>
                      <h3>{world.title}</h3>
                      <p>
                        {world.summary || "正在閱讀原作，世界的輪廓即將浮現。"}
                      </p>
                      <div className="world-card-footer">
                        <span>
                          {world.elements.length} 個元素 ·{" "}
                          {date(world.updatedAt)}
                        </span>
                        <ArrowUpRight size={20} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="two-column overview-bottom">
                <section className="panel">
                  <div className="section-heading">
                    <h2>工作進度</h2>
                    <ArrowDownLeft size={18} />
                  </div>
                  <JobList
                    jobs={overview?.jobs.slice(0, 8) || []}
                    retry={(id) => void retry(id)}
                    busy={!!pending}
                    openWorld={select}
                  />
                </section>
                <section className="panel">
                  <div className="section-heading">
                    <h2>最近動態</h2>
                    <Sparkles size={17} />
                  </div>
                  <AuditList audit={overview?.audit.slice(0, 8) || []} />
                </section>
              </div>
            </>
          ) : loading || !detail ? (
            <section className="empty-world" role="status">
              <span className="small-loader" />
              <p>
                {error
                  ? "暫時無法開啟世界，請重新整理。"
                  : "正在打開世界的篇章⋯"}
              </p>
            </section>
          ) : (
            <>
              <section className="world-heading">
                <div>
                  <p className="eyebrow">
                    WORLD / {detail.world.id.slice(0, 8)}
                  </p>
                  <h1>{detail.world.title}</h1>
                  <p className="muted">
                    {detail.world.summary ||
                      "原作閱讀中，完成後會在這裡呈現世界摘要。"}
                  </p>
                </div>
                <span className="badge">
                  {detail.importReview
                    ? "需要你確認"
                    : statusName(detail.world.status)}{" "}
                  · 第 {detail.world.revision} 版
                </span>
              </section>
              <nav className="tabs" aria-label="世界工作區">
                {tabs.map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setTab(id);
                      setSuccess("");
                    }}
                    aria-current={tab === id ? "page" : undefined}
                    className={tab === id ? "active" : ""}
                  >
                    {label}
                    {id === "review" && (
                      <span className="tab-count">
                        {reviewTabStatus(detail)}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
              <WorldPanels
                key={detail.world.id}
                tab={tab}
                detail={detail}
                run={run}
                busy={!!pending}
                retry={(id) => void retry(id)}
                onNavigate={setTab}
                onWorldUpdated={(world) => {
                  setDetail((current) =>
                    current?.world.id === world.id
                      ? { ...current, world, frameworkHash: null }
                      : current,
                  );
                  void loadWorld(world.id).catch(handleError);
                  void loadOverview().catch(handleError);
                }}
                openImportReview={() =>
                  setOpenReviewId(detail.importReview?.id || null)
                }
              />
            </>
          )}
          <footer className="studio-footer">
            <span>Agentic Life World Studio</span>
            <span>文字有邊界，世界有餘地。</span>
          </footer>
        </main>
      </div>
      {detail?.importReview && openReviewId === detail.importReview.id && (
        <ImportReviewDialog
          key={detail.importReview.id}
          detail={detail}
          review={detail.importReview}
          run={run}
          busy={!!pending}
          onClose={() => setOpenReviewId(null)}
        />
      )}
      {importing && (
        <ImportSource
          onClose={() => setImporting(false)}
          onCreated={(id) => {
            setImporting(false);
            select(id);
            void loadOverview().catch(handleError);
          }}
        />
      )}
    </div>
  );
}
