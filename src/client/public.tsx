import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, Globe2 } from "lucide-react";
import type { Locale, PublicWorld } from "../shared/contracts";
import { api, ApiError } from "./api";

const copy = {
  en: {
    skip: "Skip to the world",
    loading: "Opening a new world…",
    unavailable: "This world is not available yet.",
    unavailableText:
      "The page may have moved, or its story is still taking shape.",
    retry: "Try again",
    title: "A world of its own",
    journal: "THE WORLD COLLECTION",
    enter: "Step into the world",
    about: "A STORY TO INHABIT",
    introduction: "Beyond the first page.",
    explore: "THE FIELD GUIDE",
    elements: "Meet the world.",
    element: "Element",
    inThisWorld: "In this world",
    features: "A closer look",
    colors: "THE COLOURS OF THIS WORLD",
    language: "Language",
    image: "A view of",
    top: "Back to the beginning",
    footer: "Every world begins with words.",
    index: "INDEX",
    notFound: "World unavailable",
    view: "Explore",
    preview: "PRIVATE PREVIEW",
    previewNotice: "This world has not been published.",
    returnStudio: "Back to Studio",
    previewUnavailable: "This preview is not available.",
    previewErrorText:
      "Return to Studio to create a new preview, or sign in again.",
    previewLogin: "Sign in to Studio to view this preview.",
  },
  "zh-Hant": {
    skip: "跳到世界內容",
    loading: "正在開啟一個世界⋯",
    unavailable: "這個世界尚未開放。",
    unavailableText: "頁面可能已移動，或它的故事仍在成形。",
    retry: "重新載入",
    title: "一個屬於自己的世界",
    journal: "世界收藏",
    enter: "走進這個世界",
    about: "可以走入的故事",
    introduction: "書頁之後，還有世界。",
    explore: "世界手記",
    elements: "遇見這個世界。",
    element: "元素",
    inThisWorld: "在這個世界裡",
    features: "再靠近一些",
    colors: "世界的色彩",
    language: "語言",
    image: "世界景觀：",
    top: "回到起點",
    footer: "每一個世界，都從文字開始。",
    index: "目錄",
    notFound: "世界尚未開放",
    view: "探索",
    preview: "私人預覽",
    previewNotice: "此內容尚未正式發布。",
    returnStudio: "返回 Studio",
    previewUnavailable: "暫時無法開啟此預覽。",
    previewErrorText: "請返回 Studio 重新建立預覽，或重新登入。",
    previewLogin: "請先登入 Studio，再開啟這份預覽。",
  },
  ja: {
    skip: "世界の内容へ移動",
    loading: "新しい世界を開いています…",
    unavailable: "この世界はまだ公開されていません。",
    unavailableText: "ページが移動したか、物語がまだ形づくられているようです。",
    retry: "もう一度読み込む",
    title: "ひとつの世界",
    journal: "世界のコレクション",
    enter: "この世界へ",
    about: "物語の中で過ごす",
    introduction: "最初のページの、その先へ。",
    explore: "世界の手帖",
    elements: "この世界と出会う。",
    element: "要素",
    inThisWorld: "この世界の中で",
    features: "もう少し近くで",
    colors: "この世界の色彩",
    language: "言語",
    image: "世界の風景：",
    top: "はじまりに戻る",
    footer: "すべての世界は、言葉からはじまる。",
    index: "目次",
    notFound: "世界は準備中です",
    view: "探訪",
    preview: "非公開プレビュー",
    previewNotice: "この内容はまだ公開されていません。",
    returnStudio: "Studio に戻る",
    previewUnavailable: "このプレビューを開けません。",
    previewErrorText:
      "Studio に戻り、新しいプレビューを作成するか、再度ログインしてください。",
    previewLogin: "プレビューを見るには Studio にログインしてください。",
  },
};
const localeNames: Record<Locale, string> = {
  en: "EN",
  "zh-Hant": "繁中",
  ja: "日本語",
};
function setMeta(name: string, content: string, property = false) {
  const key = property ? "property" : "name";
  let node = document.querySelector<HTMLMetaElement>(`meta[${key}="${name}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(key, name);
    document.head.appendChild(node);
  }
  node.content = content;
}
export function PublicSite({
  locale,
  slug = "",
  previewId,
  returnWorldId,
}: {
  locale: Locale;
  slug?: string;
  previewId?: string;
  returnWorldId?: string;
}) {
  const t = copy[locale];
  const studioUrl = returnWorldId
    ? `/?world=${encodeURIComponent(returnWorldId)}`
    : "/";
  const previewQuery = returnWorldId
    ? `?world=${encodeURIComponent(returnWorldId)}`
    : "";
  const previewBanner = previewId ? (
    <aside className="private-preview-bar" aria-label={t.preview}>
      <div>
        <span className="preview-mark">{t.preview}</span>
        <span>{t.previewNotice}</span>
      </div>
      <a href={studioUrl} target="_top">
        {t.returnStudio}
        <ArrowUpRight size={14} />
      </a>
    </aside>
  ) : null;
  const [world, setWorld] = useState<PublicWorld | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loginRequired, setLoginRequired] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setWorld(null);
    setFailed(false);
    setLoginRequired(false);
    setMeta(
      "robots",
      previewId ? "noindex, nofollow, noarchive" : "index, follow",
    );
    if (previewId) document.querySelector('link[rel="canonical"]')?.remove();
    document.documentElement.lang = locale;
    document.title = `${t.title} · Agentic Life`;
    void api<PublicWorld>(
      previewId
        ? `/api/site-previews/${encodeURIComponent(previewId)}/${locale}`
        : `/api/public/${locale}/${encodeURIComponent(slug)}`,
    )
      .then((data) => {
        if (cancelled) return;
        setWorld(data);
        document.title = previewId
          ? `${t.preview} · ${data.title}`
          : `${data.title} · Agentic Life`;
        if (previewId) {
          setMeta("description", t.previewNotice);
          return;
        }
        setMeta("description", data.tagline || data.introduction.slice(0, 160));
        setMeta("og:title", data.title, true);
        setMeta(
          "og:description",
          data.tagline || data.introduction.slice(0, 160),
          true,
        );
        setMeta("og:type", "website", true);
        setMeta("og:url", location.href, true);
        if (data.imageUrl)
          setMeta(
            "og:image",
            new URL(data.imageUrl, location.origin).href,
            true,
          );
        let canonical = document.querySelector<HTMLLinkElement>(
          'link[rel="canonical"]',
        );
        if (!canonical) {
          canonical = document.createElement("link");
          canonical.rel = "canonical";
          document.head.appendChild(canonical);
        }
        canonical.href = `${location.origin}/${locale}/worlds/${encodeURIComponent(slug)}`;
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailed(true);
          setLoginRequired(error instanceof ApiError && error.status === 401);
          document.title = `${t.notFound} · Agentic Life`;
          setMeta("description", t.unavailableText);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locale, slug, previewId, attempt, t]);
  if (!world)
    return (
      <div lang={locale} className="public-site">
        {previewBanner}
        <main className="public-loading">
          <Globe2 size={35} strokeWidth={1} />
          <p className="eyebrow">AGENTIC LIFE · WORLD COLLECTION</p>
          {failed ? (
            <>
              <h1>{previewId ? t.previewUnavailable : t.unavailable}</h1>
              <p>
                {previewId
                  ? loginRequired
                    ? t.previewLogin
                    : t.previewErrorText
                  : t.unavailableText}
              </p>
              <button
                className="public-button"
                onClick={() => setAttempt(attempt + 1)}
              >
                {t.retry}
                <ArrowUpRight size={17} />
              </button>
            </>
          ) : (
            <p role="status">{t.loading}</p>
          )}
        </main>
      </div>
    );
  return (
    <div className="public-site" lang={locale} id="top">
      {previewBanner}
      <a className="skip-link" href="#world-content">
        {t.skip}
      </a>
      <header className="public-header">
        <a href="#top" className="public-brand" aria-label="Agentic Life">
          <Globe2 size={25} strokeWidth={1.15} />
          <span>
            Agentic Life<small>WORLD COLLECTION</small>
          </span>
        </a>
        <span className="public-header-label">{t.journal}</span>
        <nav aria-label={t.language} className="public-languages">
          {world.locales.map((l) => (
            <a
              key={l}
              lang={l}
              href={
                previewId
                  ? `/preview/${encodeURIComponent(previewId)}/${l}${previewQuery}`
                  : `/${l}/worlds/${encodeURIComponent(slug)}`
              }
              aria-current={l === locale ? "page" : undefined}
            >
              {localeNames[l]}
            </a>
          ))}
        </nav>
      </header>
      <main id="world-content">
        <section
          className={`public-hero ${world.imageUrl ? "with-image" : "typographic"}`}
        >
          {world.imageUrl && (
            <img
              className="public-hero-image"
              src={world.imageUrl}
              alt={`${t.image} ${world.title}`}
              fetchPriority="high"
            />
          )}
          <div className="public-hero-content">
            <p className="eyebrow">{t.journal}</p>
            <h1>{world.title}</h1>
            {world.tagline && <p className="public-tagline">{world.tagline}</p>}
            <a className="public-entry" href="#introduction">
              {t.enter}
              <ArrowDown size={18} />
            </a>
          </div>
          <span className="public-hero-number" aria-hidden="true">
            01 — ∞
          </span>
        </section>
        <section id="introduction" className="public-introduction">
          <div>
            <p className="eyebrow">{t.about}</p>
            <h2>{t.introduction}</h2>
          </div>
          <div className="public-intro-prose">
            {world.introduction
              .split(/\n\s*\n/)
              .filter(Boolean)
              .map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
          </div>
        </section>
        {world.elements.length > 0 && (
          <section className="public-field-guide" id="field-guide">
            <div className="public-section-heading">
              <div>
                <p className="eyebrow">{t.explore}</p>
                <h2>{t.elements}</h2>
              </div>
              <span>
                {String(world.elements.length).padStart(2, "0")} /{" "}
                {t.inThisWorld}
              </span>
            </div>
            <div className="public-guide-layout">
              <nav className="public-element-index" aria-label={t.index}>
                <p className="eyebrow">{t.index}</p>
                {world.elements.map((element, i) => (
                  <a key={element.id} href={`#element-${element.id}`}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {element.name}
                    <ArrowUpRight size={13} />
                  </a>
                ))}
              </nav>
              <div className="public-element-list">
                {world.elements.map((element, i) => (
                  <article
                    id={`element-${element.id}`}
                    key={element.id}
                    className="public-element"
                  >
                    <div className="public-element-heading">
                      <span className="public-element-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <p className="eyebrow">{t.element}</p>
                        <h3>{element.name}</h3>
                      </div>
                    </div>
                    <p className="public-element-definition">
                      {element.definition}
                    </p>
                    {element.features.length > 0 && (
                      <div className="public-element-features">
                        <h4>{t.features}</h4>
                        <ul>
                          {element.features.map((feature, index) => (
                            <li key={index}>{feature}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
        {world.palette.length > 0 && (
          <section className="public-palette">
            <p className="eyebrow">{t.colors}</p>
            <div aria-hidden="true">
              {world.palette.map((color, i) => (
                <span key={i} style={{ backgroundColor: color }} />
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="public-footer">
        <div className="public-brand">
          <Globe2 size={26} strokeWidth={1.1} />
          <span>
            Agentic Life<small>{t.footer}</small>
          </span>
        </div>
        <a href="#top">
          {t.top}
          <ArrowUpRight size={17} />
        </a>
      </footer>
    </div>
  );
}
