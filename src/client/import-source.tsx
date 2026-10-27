import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, FileText, Link, Upload, X } from "lucide-react";
import type { SourceKind } from "../shared/contracts";
import { post, errorMessage } from "./api";

export function ImportSource({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const lockedRef = useRef(false);
  const [method, setMethod] = useState<"text" | "url" | "file">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [kind, setKind] = useState<SourceKind>("text");
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  lockedRef.current = busy || parsing;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current
      ?.querySelector<HTMLInputElement>("input:not([type=file])")
      ?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !lockedRef.current) {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const controls = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
      );
      if (!controls?.length) return;
      const first = controls[0],
        last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !panelRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  async function readFile(file?: File) {
    if (!file) return;
    setError("");
    setText("");
    setFileName("");
    setParsing(true);
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("檔案超過 25 MB，請先分割內容再匯入。");
      const ext = file.name.split(".").pop()?.toLowerCase();
      let result = "";
      if (ext === "docx") {
        const mammoth = await import("mammoth/mammoth.browser");
        result = (
          await mammoth.extractRawText({
            arrayBuffer: await file.arrayBuffer(),
          })
        ).value;
        setKind("docx");
      } else if (ext === "pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).href;
        const loadingTask = pdfjs.getDocument({
          data: await file.arrayBuffer(),
        });
        const pdf = await loadingTask.promise;
        const pages: string[] = [];
        try {
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(
              content.items
                .map((item) =>
                  "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
                )
                .join(""),
            );
          }
        } finally {
          await loadingTask.destroy();
        }
        result = pages.join("\n\n");
        setKind("pdf");
      } else if (["txt", "md"].includes(ext || "")) {
        result = await file.text();
        setKind("text");
      } else
        throw new Error(
          "請上傳 DOCX、可選取文字的 PDF、TXT 或 Markdown。舊版 DOC 請先轉存為 DOCX。",
        );
      if (!result.trim())
        throw new Error(
          "沒有擷取到文字。掃描 PDF 請先完成文字辨識，或改貼上原文。",
        );
      setText(result);
      setFileName(file.name);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setParsing(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const sourceKind: SourceKind =
        method === "url"
          ? /docs\.google\.com/.test(url)
            ? "google-doc"
            : "url"
          : method === "file"
            ? kind
            : "text";
      const result = await post<{ worldId: string; jobId: string }>(
        "/api/sources",
        {
          title: title.trim(),
          kind: sourceKind,
          ...(method === "url" ? { url: url.trim() } : { text }),
        },
      );
      onCreated(result.worldId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="import-overlay">
      <section
        className="import-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">A NEW BEGINNING</p>
            <h2 id="import-title">從一篇原作，開始一個世界。</h2>
          </div>
          <button
            className="icon-button"
            aria-label="關閉匯入"
            onClick={onClose}
            disabled={busy || parsing}
          >
            <X size={20} />
          </button>
        </div>
        <p className="muted">
          匯入你有權使用的內容。原作與草稿只在私人 Studio
          中供你檢視，公開前由你確認。
        </p>
        <div className="segmented" aria-label="匯入方式">
          {(
            [
              ["text", FileText, "貼上文字"],
              ["url", Link, "網址"],
              ["file", Upload, "上傳檔案"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={method === id}
              className={method === id ? "selected" : ""}
              onClick={() => {
                setMethod(id);
                setError("");
              }}
              disabled={busy || parsing}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="form-stack">
          <label>
            原作名稱
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="為這份原作命名"
              required
              maxLength={200}
              autoFocus
            />
          </label>
          {method === "text" && (
            <label>
              原作內容
              <textarea
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="在這裡貼上你的故事、設定或世界片段⋯"
                required
              />
            </label>
          )}
          {method === "url" && (
            <>
              <label>
                原文網址
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  required
                />
              </label>
              <p className="field-note">
                支援網頁與 Google
                文件。私人文件需要已授權的讀取權限；無法讀取時可改上傳 DOCX
                或貼上完整內容。
              </p>
            </>
          )}
          {method === "file" && (
            <>
              <label className="file-drop">
                <Upload size={28} />
                <strong>
                  {parsing ? "正在擷取全文⋯" : fileName || "選擇原作檔案"}
                </strong>
                <span>DOCX · PDF · TXT · MD ／ 最大 25 MB</span>
                <input
                  type="file"
                  accept=".docx,.pdf,.txt,.md"
                  disabled={parsing || busy}
                  onChange={(e) => void readFile(e.target.files?.[0])}
                />
              </label>
              {fileName && (
                <label>
                  擷取文字預覽 · {text.length.toLocaleString()} 字元
                  <textarea
                    rows={6}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <div className="form-footer">
            <span className="field-note">
              完整閱讀後，再一起確認世界的樣貌。
            </span>
            <button
              className="primary"
              disabled={
                busy ||
                parsing ||
                !title.trim() ||
                (method === "url" ? !url.trim() : !text.trim())
              }
            >
              {busy ? "正在建立⋯" : "匯入並開始閱讀"}
              <ArrowUpRight size={17} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
