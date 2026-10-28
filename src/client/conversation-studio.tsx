import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Globe2,
  LogOut,
  Menu,
  Paperclip,
  Plus,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import type {
  Conversation,
  ConversationEvent,
  ConversationProposal,
  ConversationSnapshot,
  StudioAttachment,
} from "../shared/conversation";
import { api, ApiError, errorMessage, post } from "./api";
import {
  mergeConversationSnapshot,
  proposalCommand,
  visualChoiceCommand,
  retryCommand,
  proposalDetails,
  currentProposal,
  mergeConversationEvents,
} from "./conversation-state";
import { readConversationFile } from "./conversation-files";
import { PRODUCT_LABEL } from "../shared/version";
import "./conversation.css";

const labels: Record<string, string> = {
  core: "原著核心",
  extension: "延伸範圍",
  exploration: "探索方式",
  continuity: "人物與時間",
  visual: "視覺方向",
  audience: "受眾與感受",
  summary: "世界樣貌",
  purpose: "這次探索",
  appearance: "外觀",
  definition: "特色",
};
const when = (value: string) =>
  new Intl.DateTimeFormat("zh-TW", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}
function ProposalContent({ proposal }: { proposal: ConversationProposal }) {
  const c = proposalDetails(proposal);
  const direction = c;
  const entries = Object.entries(direction).filter(
    ([key, value]) => labels[key] && typeof value === "string",
  );
  return (
    <div className="chat-proposal">
      <div className="chat-card-caption">
        {
          {
            direction: "創作方向提案",
            world: "世界提案",
            visual: "視覺提案",
            site: "網站預覽",
            operation: "自主更新提案",
          }[proposal.kind]
        }
      </div>
      {entries.map(([key, value]) => (
        <div className="chat-proposal-part" key={key}>
          <strong>{labels[key]}</strong>
          <Paragraphs text={String(value)} />
        </div>
      ))}
      {Array.isArray(c.elements) && (
        <div className="chat-element-grid">
          {(c.elements as Record<string, unknown>[]).map((e, i) => (
            <div key={String(e.id || i)}>
              <strong>
                {String(
                  (e.names as Record<string, string> | undefined)?.[
                    "zh-Hant"
                  ] ||
                    (e.names as Record<string, string> | undefined)?.en ||
                    "新發現",
                )}
              </strong>
              <p>{String(e.definition || e.appearance || "")}</p>
            </div>
          ))}
        </div>
      )}
      {proposal.kind === "operation" && (
        <p>
          {String(c.scope || "依已確認的創作範圍更新")} · 每{" "}
          {Number(c.frequencyHours || 24)} 小時，最多 {Number(c.maxCalls || 0)}{" "}
          次生成呼叫。
        </p>
      )}
    </div>
  );
}
function EventCard({
  event,
  snapshot,
  onSend,
  busy,
}: {
  event: ConversationEvent;
  snapshot: ConversationSnapshot;
  onSend: (message: string) => void;
  busy: boolean;
}) {
  const proposal = currentProposal(event.data, snapshot.proposals);
  const referenced = snapshot.proposals.find(
    (p) => p.id === event.data.proposalId,
  );
  const assetId = String(event.data.assetId || "");
  const image = snapshot.assets.find(
    (a) => a.id === assetId && a.kind === "image",
  );
  const imageIds =
    proposal?.kind === "visual"
      ? proposal.content.assetIds
      : event.data.assetIds;
  const images = (Array.isArray(imageIds) ? imageIds : [])
    .map((id) => snapshot.assets.find((a) => a.id === id))
    .filter(Boolean);
  const previewUrl =
    typeof event.data.previewUrl === "string"
      ? event.data.previewUrl
      : typeof event.data.url === "string"
        ? event.data.url
        : null;
  const safePreview =
    previewUrl && previewUrl.startsWith("/") && !previewUrl.startsWith("//")
      ? previewUrl
      : null;
  return (
    <article
      className={`chat-event chat-event-${event.type}`}
      data-event-id={event.id}
    >
      {event.type === "user" ? (
        <div className="chat-user-bubble">
          <Paragraphs text={event.content} />
          {Array.isArray(event.data.attachments) && (
            <small>
              {(event.data.attachments as { name: string }[])
                .map((a) => a.name)
                .join(" · ")}
            </small>
          )}
        </div>
      ) : (
        <>
          <div className="chat-speaker">
            <span className="chat-director-mark">✳</span>
            {event.type === "progress" ? "處理進度" : "世界創作總監"}
          </div>
          <div className="chat-prose">
            <Paragraphs text={event.content} />
          </div>
        </>
      )}
      {referenced && <ProposalContent proposal={referenced} />}
      {image && (
        <figure className="chat-image">
          <img
            src={image.url}
            alt={image.name || "世界視覺試稿"}
            loading="lazy"
          />
          <figcaption>{image.name}</figcaption>
        </figure>
      )}
      {images.map(
        (a, index) =>
          a && (
            <figure className="chat-image" key={a.id}>
              <img src={a.url} alt={a.name || "世界視覺試稿"} loading="lazy" />
              <figcaption>{a.name}</figcaption>
              <button
                disabled={busy || !proposal}
                onClick={() =>
                  proposal && onSend(visualChoiceCommand(proposal, index))
                }
              >
                <Check size={15} />
                採用這張
              </button>
            </figure>
          ),
      )}
      {typeof event.data.url === "string" &&
        /^https:\/\//.test(event.data.url) && (
          <a
            className="chat-inline-action"
            href={event.data.url}
            target="_blank"
            rel="noreferrer"
          >
            開啟公開網站 <ArrowUpRight size={15} />
          </a>
        )}
      {safePreview && (
        <div className="chat-site-preview">
          <iframe
            title="網站私人預覽"
            src={safePreview}
            sandbox="allow-same-origin"
            loading="lazy"
          />
          <a href={safePreview} target="_blank" rel="noreferrer">
            開啟完整預覽
            <ArrowUpRight size={15} />
          </a>
        </div>
      )}
      {proposal && (
        <button
          className="chat-inline-action"
          disabled={busy}
          onClick={() => onSend(proposalCommand(proposal))}
        >
          <Check size={15} />
          採用{proposal.kind === "direction" ? "這個方向" : "這份提案"}
        </button>
      )}
      {referenced?.status === "approved" && (
        <span className="chat-approved">
          <Check size={14} />
          已確認
        </span>
      )}
      {event.type === "error" && (
        <button
          className="chat-inline-action"
          disabled={busy}
          onClick={() => onSend(retryCommand)}
        >
          <RotateCcw size={14} />
          重試未完成工作
        </button>
      )}
    </article>
  );
}
function ConversationLogin({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/login", { password });
      setPassword("");
      onLogin();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="conversation-login">
      <div className="chat-login-brand">
        <Globe2 size={24} />
        WORLD STUDIO
      </div>
      <section>
        <span className="chat-kicker">A WORLD BEGINS WITH A CONVERSATION</span>
        <h1>
          把故事交給我，
          <br />
          一起走進它的世界。
        </h1>
        <p>閱讀原作，討論方向，讓新的風景與生命逐漸成形。</p>
        <form onSubmit={submit}>
          <label htmlFor="studio-password">Studio 密碼</label>
          <input
            id="studio-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button disabled={busy}>
            {busy ? "登入中…" : "開始對話"}
            <ArrowUpRight size={18} />
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      </section>
      <small>{PRODUCT_LABEL} · PRIVATE CREATIVE SPACE</small>
    </main>
  );
}
export function ConversationStudio() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [list, setList] = useState<Conversation[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [input, setInput] = useState(""),
    [attachments, setAttachments] = useState<StudioAttachment[]>([]),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false),
    [error, setError] = useState(""),
    [drawer, setDrawer] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [importWarnings, setImportWarnings] = useState<string[]>([]),
    [loadingOlder, setLoadingOlder] = useState(false);
  const [legacy, setLegacy] = useState<{ id: string; title: string }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null),
    snapshotRef = useRef<ConversationSnapshot | null>(null),
    selectedRef = useRef<string | null>(null),
    historyLoading = useRef(false),
    lock = useRef(false),
    loadSequence = useRef(0);
  const pending = useRef<{ id: string; hash: string } | null>(null),
    source = useRef<EventSource | null>(null),
    refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadList = useCallback(async () => {
    const data = await api<{ conversations: Conversation[] }>(
      "/api/studio/conversations",
    );
    setList(data.conversations);
    return data.conversations;
  }, []);
  const load = useCallback(async (id: string) => {
    const sequence = ++loadSequence.current;
    const data = await api<ConversationSnapshot>(
      `/api/studio/conversations/${id}`,
    );
    if (selectedRef.current !== id || sequence !== loadSequence.current) return;
    setSnapshot((previous) => mergeConversationSnapshot(previous, data));
  }, []);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    api<{ authenticated: boolean }>("/api/session")
      .then((s) => setAuth(s.authenticated))
      .catch((e) => {
        setError(errorMessage(e));
        setAuth(false);
      });
  }, []);
  useEffect(() => {
    if (!auth) return;
    let live = true;
    loadList()
      .then((items) => {
        if (!live) return;
        const saved = sessionStorage.getItem("studio-conversation");
        setSelected(
          items.find((i) => i.id === saved)?.id || items[0]?.id || null,
        );
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [auth, loadList]);
  useEffect(() => {
    if (!selected || !auth) {
      setSnapshot(null);
      return;
    }
    let live = true;
    selectedRef.current = selected;
    setSnapshot(null);
    setError("");
    sessionStorage.setItem("studio-conversation", selected);
    load(selected)
      .then(() => {
        if (!live) return;
        const cursor =
          snapshotRef.current?.conversation.id === selected
            ? snapshotRef.current.cursor
            : 0;
        const stream = new EventSource(
          `/api/studio/conversations/${selected}/stream?after=${cursor}`,
        );
        source.current = stream;
        stream.addEventListener("studio", (raw) => {
          const event = JSON.parse(
            (raw as MessageEvent).data,
          ) as ConversationEvent;
          if (event.conversationId !== selected) return;
          setSnapshot((previous) =>
            previous?.conversation.id === selected
              ? {
                  ...previous,
                  cursor: Math.max(previous.cursor, event.id),
                  events: mergeConversationEvents(
                    previous.events,
                    [event],
                    selected,
                  ),
                }
              : previous,
          );
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => {
            void load(selected).catch(() => {});
            void loadList().catch(() => {});
          }, 200);
        });
        stream.onerror = () => {
          if (live && selectedRef.current === selected)
            void load(selected).catch(() => {});
        };
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      live = false;
      source.current?.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [selected, auth, load, loadList]);
  useEffect(() => {
    if (!snapshot?.events.length) return;
    if (historyLoading.current) {
      historyLoading.current = false;
      return;
    }
    end.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [snapshot?.events.length]);
  async function ensureConversation() {
    if (selectedRef.current) return selectedRef.current;
    const r = await post<{ conversation: Conversation }>(
      "/api/studio/conversations",
      {},
    );
    selectedRef.current = r.conversation.id;
    setSelected(r.conversation.id);
    setSnapshot(null);
    await loadList();
    return r.conversation.id;
  }
  async function send(message = input, files = attachments) {
    if (lock.current || (!message.trim() && !files.length)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await ensureConversation();
      const body = {
        message:
          message.trim() ||
          "請閱讀這些附件，先告訴我你理解的核心與建議創作方向。",
        attachments: files,
      };
      if (files.length && importWarnings.length)
        body.message +=
          "\n\n文件讀取備註：" +
          importWarnings.join("；") +
          "。請據實說明已取得的文字與參考圖片範圍。";
      const hash = id + JSON.stringify(body);
      if (!pending.current || pending.current.hash !== hash)
        pending.current = { id: crypto.randomUUID(), hash };
      await api(`/api/studio/conversations/${id}/turns`, {
        method: "POST",
        headers: { "Idempotency-Key": pending.current.id },
        body: JSON.stringify({ clientMessageId: pending.current.id, ...body }),
      });
      pending.current = null;
      setInput("");
      setAttachments([]);
      setImportWarnings([]);
      await load(id);
      await loadList();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth(false);
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setReading(true);
    setError("");
    try {
      const id = await ensureConversation();
      let imageCount = attachments.filter((a) => a.kind === "image").length;
      const save = async (file: File) => {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch(`/api/studio/conversations/${id}/files`, {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        const result = (await response.json()) as {
          originalKey?: string;
          error?: { message?: string };
        };
        if (!response.ok || !result.originalKey)
          throw new Error(
            result.error?.message || "附件尚未保存，請再試一次。",
          );
        return result.originalKey;
      };
      for (const file of Array.from(files)) {
        const parsed = await readConversationFile(file);
        const totalImages =
          (parsed.source.kind === "image" ? 1 : 0) + parsed.references.length;
        if (imageCount + totalImages > 6)
          throw new Error(
            "每次最多送出六張參考圖片。請先送出目前附件，再補上這份文件或下一批圖片。",
          );
        const originalKey = await save(file);
        const source = { ...parsed.source, originalKey };
        if (source.kind === "image") delete source.dataUrl;
        const incoming: StudioAttachment[] = [source];
        for (const reference of parsed.references) {
          const response = await fetch(reference.dataUrl!);
          const blob = await response.blob();
          const imageFile = new File([blob], reference.name, {
            type: blob.type,
          });
          const key = await save(imageFile);
          incoming.push({
            name: reference.name,
            kind: "image",
            originalKey: key,
          });
        }
        setAttachments((previous) => [...previous, ...incoming]);
        setImportWarnings((previous) => [
          ...new Set([...previous, ...parsed.warnings]),
        ]);
        imageCount += totalImages;
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function loadOlder() {
    if (!snapshot?.olderCursor || !selected || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const id = selected;
      const old = await api<{
        events: ConversationEvent[];
        olderCursor: number | null;
      }>(
        `/api/studio/conversations/${id}/events?before=${snapshot.olderCursor}`,
      );
      if (selectedRef.current !== id) return;
      historyLoading.current = true;
      setSnapshot((previous) =>
        previous?.conversation.id === id
          ? {
              ...previous,
              events: mergeConversationEvents(old.events, previous.events, id),
              olderCursor: old.olderCursor,
            }
          : previous,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoadingOlder(false);
    }
  }
  async function cancel() {
    if (!selected) return;
    try {
      await post(`/api/studio/conversations/${selected}/cancel`);
      await load(selected);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function openLegacy() {
    setDrawer(true);
    try {
      const r = await api<{ worlds: { id: string; title: string }[] }>(
        "/api/overview",
      );
      setLegacy(r.worlds);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function copyLegacy(id: string, title: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/worlds/${id}/source`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("這份原作暫時無法讀取。");
      const text = await response.text();
      const created = await post<{ conversation: Conversation }>(
        "/api/studio/conversations",
        { title },
      );
      selectedRef.current = created.conversation.id;
      setSelected(created.conversation.id);
      setAttachments([{ name: title, kind: "text", text }]);
      setInput("請重新閱讀這份原作，先和我討論創作方向。");
      setDrawer(false);
      await loadList();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (auth === null)
    return (
      <div className="chat-loading" role="status">
        正在開啟你的創作空間…
      </div>
    );
  if (!auth) return <ConversationLogin onLogin={() => setAuth(true)} />;
  const running = snapshot?.tasks.some(
    (t) => t.status === "queued" || t.status === "running",
  );
  return (
    <main className={`chat-studio ${sidebar ? "chat-sidebar-open" : ""}`}>
      <a className="chat-skip" href="#conversation-input">
        跳至訊息輸入
      </a>
      <aside className="chat-sidebar">
        <div className="chat-brand">
          <Globe2 size={23} />
          <span>
            WORLD
            <br />
            <b>STUDIO</b>
          </span>
          <button
            className="chat-mobile-close"
            onClick={() => setSidebar(false)}
            aria-label="關閉對話清單"
          >
            <X size={19} />
          </button>
        </div>
        <button
          className="chat-new"
          onClick={() => {
            setSelected(null);
            selectedRef.current = null;
            setSnapshot(null);
            setInput("");
            setAttachments([]);
            setSidebar(false);
          }}
        >
          <Plus size={17} />
          新的世界對話
        </button>
        <div className="chat-sidebar-label">你的世界</div>
        <nav aria-label="世界對話">
          {list.map((c) => (
            <button
              key={c.id}
              className={selected === c.id ? "selected" : ""}
              onClick={() => {
                setSelected(c.id);
                setSidebar(false);
              }}
            >
              <span>{c.title || "新的世界"}</span>
              <small>{when(c.updatedAt)}</small>
            </button>
          ))}
          {!list.length && (
            <p className="chat-muted">第一個世界，從這裡開始。</p>
          )}
        </nav>
        <div className="chat-sidebar-bottom">
          <button onClick={() => void openLegacy()}>
            <BookOpen size={16} />
            資料與原作
          </button>
          <button
            onClick={async () => {
              await post("/api/logout");
              setAuth(false);
              source.current?.close();
            }}
          >
            <LogOut size={16} />
            登出
          </button>
          <small>{PRODUCT_LABEL}</small>
        </div>
      </aside>
      <section className="chat-workspace">
        <header className="chat-topbar">
          <button
            className="chat-mobile-menu"
            onClick={() => setSidebar(true)}
            aria-label="開啟對話清單"
          >
            <Menu size={20} />
          </button>
          <div>
            <strong>{snapshot?.conversation.title || "新的世界對話"}</strong>
            <span>
              {running ? "正在處理，仍可繼續留言" : "與世界創作總監一起創作"}
            </span>
          </div>
          <button
            onClick={() => setDrawer(true)}
            className="chat-details-button"
          >
            目前設定
            <ChevronDown size={14} />
          </button>
        </header>
        <div className="chat-scroll">
          <div
            className="chat-transcript"
            role="log"
            aria-label="創作對話"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {snapshot?.olderCursor && (
              <button
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
                className="chat-inline-action"
              >
                {loadingOlder ? "正在取得更早的對話…" : "查看更早的對話"}
              </button>
            )}
            {!snapshot?.events.length ? (
              <div className="chat-welcome">
                <span className="chat-welcome-mark">✳</span>
                <span className="chat-kicker">
                  YOUR STORY, A WORLD TO DISCOVER
                </span>
                <h1>
                  我們從哪個
                  <br />
                  世界開始？
                </h1>
                <p>
                  把原稿、網址或圖片交給我。
                  <br />
                  我會先讀懂作品，再和你討論它可以如何延伸。
                </p>
                <div className="chat-starters">
                  {[
                    "我想從一份小說建立探索網站",
                    "我有一個故事宇宙網站，想一起整理方向",
                  ].map((t) => (
                    <button key={t} onClick={() => setInput(t)}>
                      {t}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              snapshot.events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  snapshot={snapshot}
                  onSend={(m) => void send(m, [])}
                  busy={busy}
                />
              ))
            )}
            <div ref={end} />
          </div>
        </div>
        <div className="chat-composer-area">
          {error && (
            <div className="chat-error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="關閉提示">
                <X size={16} />
              </button>
            </div>
          )}
          {importWarnings.length > 0 && (
            <div className="chat-import-notice" role="status">
              {importWarnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="chat-attachments">
              {attachments.map((a, i) => (
                <span key={`${a.name}-${i}`}>
                  <Paperclip size={13} />
                  {a.name}
                  <button
                    aria-label={`移除${a.name}`}
                    onClick={() =>
                      setAttachments((old) => old.filter((_, n) => n !== i))
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="conversation-input">
              和世界創作總監交談
            </label>
            <textarea
              id="conversation-input"
              placeholder="貼上原文、提供網址，或告訴我你想怎麼調整…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={3}
            />
            <div className="chat-composer-toolbar">
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".txt,.md,.docx,.pdf,.png,.jpg,.jpeg,.webp"
                  multiple
                  hidden
                  onChange={(e) => void upload(e.target.files)}
                />
                <button
                  type="button"
                  aria-label="上傳原稿或圖片"
                  disabled={reading || busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip size={19} />
                </button>
                <span>
                  {reading ? "正在讀取與保存附件…" : "原稿 · 網址 · 參考圖片"}
                </span>
              </div>
              <div>
                {running && (
                  <button
                    type="button"
                    aria-label="停止目前工作"
                    onClick={() => void cancel()}
                  >
                    <Square size={14} />
                    停止
                  </button>
                )}
                <button
                  className="chat-send"
                  type="submit"
                  disabled={
                    busy || reading || (!input.trim() && !attachments.length)
                  }
                  aria-label="送出訊息"
                >
                  <ArrowUp size={20} />
                </button>
              </div>
            </div>
          </form>
          <p className="chat-composer-note">
            設定、圖片與發布，都可以直接在這裡討論。
          </p>
        </div>
      </section>
      {drawer && (
        <div className="chat-drawer-backdrop" onClick={() => setDrawer(false)}>
          <aside
            className="chat-drawer"
            aria-label="目前世界資料"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>目前世界資料</h2>
              <button
                aria-label="關閉世界資料"
                onClick={() => setDrawer(false)}
              >
                <X size={20} />
              </button>
            </header>
            {snapshot ? (
              <>
                <p>
                  已保存原作 {snapshot.sourceStats.count} 份 ·{" "}
                  {snapshot.sourceStats.characters.toLocaleString()} 字 · 參考圖{" "}
                  {snapshot.sourceStats.images} 張
                </p>
                <h3>創作方向</h3>
                {snapshot.conversation.document.direction ? (
                  Object.entries(snapshot.conversation.document.direction).map(
                    ([key, value]) => (
                      <section key={key}>
                        <strong>{labels[key] || key}</strong>
                        <p>{value}</p>
                      </section>
                    ),
                  )
                ) : (
                  <p>還在討論中，尚未採用創作方向。</p>
                )}
                <h3>世界元素</h3>
                {snapshot.conversation.document.world?.elements.map((e) => (
                  <section key={e.id}>
                    <strong>{e.names["zh-Hant"] || e.names.en}</strong>
                    <p>{e.definition}</p>
                    <small>
                      EN {e.names.en} · 日本語 {e.names.ja}
                    </small>
                  </section>
                ))}
                <h3>生成用量</h3>
                <p>已記錄 {snapshot.usage?.requests || 0} 次生成請求。</p>
                {!!snapshot.usage?.uncertain && (
                  <p>
                    其中 {snapshot.usage.uncertain}{" "}
                    次結果仍待確認，可能已產生費用。
                  </p>
                )}
                <h3>自主更新</h3>
                <p>
                  {snapshot.conversation.document.operation?.enabled
                    ? "已啟動"
                    : "未啟動。網站發布後，也會等你另外下令。"}
                </p>
                {snapshot.conversation.document.operation && (
                  <p>
                    本次已用{" "}
                    {snapshot.conversation.document.operation.usedCalls}／
                    {snapshot.conversation.document.operation.maxCalls} 次；每{" "}
                    {snapshot.conversation.document.operation.frequencyHours}{" "}
                    小時更新。
                    <br />
                    {snapshot.conversation.document.operation.scope}
                  </p>
                )}
              </>
            ) : (
              <p>開始一段對話後，設定與原作會保存在這裡。</p>
            )}
            <h3>既有原作</h3>
            <p>保留既有資料。選擇建立新對話副本後，再由你送出開始閱讀。</p>
            {legacy.map((w) => (
              <button
                className="chat-legacy"
                key={w.id}
                disabled={busy}
                onClick={() => void copyLegacy(w.id, w.title)}
              >
                {w.title}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </aside>
        </div>
      )}
    </main>
  );
}
