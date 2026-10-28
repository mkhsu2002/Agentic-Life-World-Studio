import {
  parseFragment,
  serialize,
  serializeOuter,
  type DefaultTreeAdapterTypes as Tree,
} from "parse5";
import { DomainError } from "./domain";
export type SiteCode = { html: string; css: string };
export type SiteContent = {
  locale: "en" | "zh-Hant" | "ja";
  title: string;
  summary: string;
  entries: {
    title: string;
    body: string;
    caption: string;
    imageUrl?: string | null;
  }[];
  languages?: { locale: "en" | "zh-Hant" | "ja"; url: string }[];
  elements: {
    id: string;
    name: string;
    definition: string;
    appearance: string;
  }[];
  imageUrl: string | null;
  caption: string;
};
const tags = new Set(
  "main header footer nav section article aside div span p h1 h2 h3 h4 a img figure figcaption ul ol li strong em small br hr blockquote details summary".split(
    " ",
  ),
);
const slots = new Set(
  "title summary hero caption entries elements entry.title entry.body entry.caption entry.image element.name element.definition element.appearance".split(
    " ",
  ),
);
const copy = new Set([
  "Explore",
  "Journal",
  "World",
  "Discover",
  "Field Notes",
  "Gallery",
  "About",
  "Read more",
  "EN",
  "繁中",
  "日本語",
  "Menu",
  "Close",
  "Next",
  "Previous",
  "Back",
  "Home",
]);
function fail(
  message = "網站設計未通過安全與內容檢查，會保留原有網站。",
): never {
  throw new DomainError("SITE_CODE_INVALID", message, 422);
}
export function validateSiteCode(code: SiteCode): SiteCode {
  if (code.html.length > 120000 || code.css.length > 80000) fail();
  if (
    /@import|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|\bcontent\s*:|[<>\\\x22\x27\x80-\uFFFF]/i.test(
      code.css,
    )
  )
    fail();
  const root = parseFragment(code.html);
  let title = false,
    content = false;
  function walk(node: Tree.Node) {
    if (node.nodeName === "#comment") fail();
    if (node.nodeName === "#text") {
      const value = (node as Tree.TextNode).value.trim();
      if (value && !copy.has(value))
        fail("網站版型只能包含通用導覽文字，作品內容須由已確認的資料提供。");
      return;
    }
    if ("tagName" in node) {
      if (!tags.has(node.tagName)) fail();
      for (const a of node.attrs) {
        if (
          ![
            "class",
            "id",
            "data-slot",
            "data-repeat",
            "href",
            "alt",
            "aria-label",
            "role",
            "loading",
            "width",
            "height",
          ].includes(a.name)
        )
          fail();
        if (
          a.name === "role" &&
          ![
            "navigation",
            "main",
            "region",
            "list",
            "listitem",
            "img",
            "presentation",
            "none",
            "banner",
            "contentinfo",
            "complementary",
          ].includes(a.value)
        )
          fail();
        if (a.name === "loading" && !["lazy", "eager"].includes(a.value))
          fail();
        if (
          ["width", "height"].includes(a.name) &&
          (!/^\d{1,4}$/.test(a.value) || Number(a.value) > 8000)
        )
          fail();
        if (a.name === "href" && !/^#[a-z][a-z0-9_-]*$/i.test(a.value)) fail();
        if (
          ["class", "id"].includes(a.name) &&
          !/^[a-zA-Z0-9_ -]{0,180}$/.test(a.value)
        )
          fail();
        if (a.name === "data-slot") {
          if (!slots.has(a.value)) fail();
          if (a.value === "title") title = true;
          if (
            ["summary", "entries", "elements", "entry.body"].includes(a.value)
          )
            content = true;
        }
        if (
          a.name === "data-repeat" &&
          !["entries", "elements"].includes(a.value)
        )
          fail();
        if (
          ["alt", "aria-label"].includes(a.name) &&
          a.value &&
          !copy.has(a.value)
        )
          fail();
      }
      if (
        node.tagName === "img" &&
        !node.attrs.some(
          (a) =>
            a.name === "data-slot" && ["hero", "entry.image"].includes(a.value),
        )
      )
        fail();
    }
    if ("childNodes" in node) node.childNodes.forEach(walk);
  }
  root.childNodes.forEach(walk);
  if (!title || !content) fail("網站設計需要完整呈現世界標題及內容。");
  return {
    html: serialize(root),
    css: code.css.replace(/\/\*[\s\S]*?\*\//g, ""),
  };
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function textNode(value: string, parent: Tree.ParentNode): Tree.TextNode {
  return { nodeName: "#text", value, parentNode: parent };
}
function slot(node: Tree.Element) {
  return node.attrs.find((a) => a.name === "data-slot")?.value;
}
const navigationCopy: Record<string, [string, string]> = {
  Explore: ["探索", "探索"],
  Journal: ["日誌", "日誌"],
  World: ["世界", "世界"],
  Discover: ["發現", "発見"],
  "Field Notes": ["旅途筆記", "旅の記録"],
  Gallery: ["影像", "写真"],
  About: ["關於", "紹介"],
  "Read more": ["繼續閱讀", "続きを読む"],
  Menu: ["選單", "メニュー"],
  Close: ["關閉", "閉じる"],
  Next: ["下一頁", "次へ"],
  Previous: ["上一頁", "前へ"],
  Back: ["返回", "戻る"],
  Home: ["首頁", "ホーム"],
};
export function renderSiteHtml(input: SiteCode, content: SiteContent): string {
  const code = validateSiteCode(input),
    root = parseFragment(code.html);
  const localized = (text: string) => {
    const key = text.trim(),
      value = navigationCopy[key];
    return value && content.locale !== "en"
      ? text.replace(key, value[content.locale === "ja" ? 1 : 0])
      : text;
  };
  const replace = (
    node: Tree.ParentNode,
    entry?: SiteContent["entries"][number],
    element?: SiteContent["elements"][number],
  ) => {
    const next: Tree.ChildNode[] = [];
    for (const child of node.childNodes) {
      if (!("tagName" in child)) {
        if (child.nodeName === "#text") child.value = localized(child.value);
        next.push(child);
        continue;
      }
      for (const attr of child.attrs)
        if (["aria-label", "alt"].includes(attr.name))
          attr.value = localized(attr.value);
      const repeat = child.attrs.find((a) => a.name === "data-repeat")?.value;
      if (repeat) {
        const items = repeat === "entries" ? content.entries : content.elements;
        for (const item of items) {
          const clone = parseFragment(serializeOuter(child))
            .childNodes[0] as Tree.Element;
          clone.attrs = clone.attrs.filter((a) => a.name !== "data-repeat");
          clone.parentNode = node;
          replace(
            clone,
            repeat === "entries"
              ? (item as SiteContent["entries"][number])
              : undefined,
            repeat === "elements"
              ? (item as SiteContent["elements"][number])
              : undefined,
          );
          next.push(clone);
        }
        continue;
      }
      replace(child, entry, element);
      next.push(child);
    }
    node.childNodes = next;
    if ("tagName" in node) {
      const key = slot(node as Tree.Element);
      const values: Record<string, string> = {
        title: content.title,
        summary: content.summary,
        caption: content.caption,
        "entry.title": entry?.title || "",
        "entry.body": entry?.body || "",
        "entry.caption": entry?.caption || "",
        "element.name": element?.name || "",
        "element.definition": element?.definition || "",
        "element.appearance": element?.appearance || "",
      };
      if (key === "hero" || key === "entry.image") {
        const imageUrl = key === "hero" ? content.imageUrl : entry?.imageUrl;
        const e = node as Tree.Element;
        e.attrs = e.attrs.filter(
          (a) => !["src", "alt", "loading"].includes(a.name),
        );
        if (imageUrl && !/^\/(?!\/)[A-Za-z0-9/_?=.%&-]+$/.test(imageUrl))
          fail();
        if (imageUrl) e.attrs.push({ name: "src", value: imageUrl });
        e.attrs.push(
          {
            name: "alt",
            value:
              key === "entry.image"
                ? entry?.caption || entry?.title || ""
                : content.caption || content.title,
          },
          { name: "loading", value: "lazy" },
        );
      } else if (key === "entries" || key === "elements") {
        const generated =
          key === "entries"
            ? content.entries
                .map(
                  (e) =>
                    `<article>${e.imageUrl ? `<figure><img src="${escape(e.imageUrl)}" alt="${escape(e.caption || e.title)}" loading="lazy"><figcaption>${escape(e.caption)}</figcaption></figure>` : ""}<h2>${escape(e.title)}</h2><p>${escape(e.body)}</p></article>`,
                )
                .join("")
            : content.elements
                .map(
                  (e) =>
                    `<article><h2>${escape(e.name)}</h2><p>${escape(e.definition)}</p></article>`,
                )
                .join("");
        node.childNodes = parseFragment(generated).childNodes;
        for (const c of node.childNodes) c.parentNode = node;
      } else if (key && values[key] !== undefined)
        node.childNodes = [textNode(values[key], node)];
    }
  };
  replace(root);
  for (const item of content.entries)
    if (item.imageUrl && !/^\/(?!\/)[A-Za-z0-9/_?=.%&-]+$/.test(item.imageUrl))
      fail();
  const labels = { en: "EN", "zh-Hant": "繁中", ja: "日本語" };
  const languageLinks = (content.languages || [])
    .map((l) => {
      if (!/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(l.url)) fail();
      return `<a href="${escape(l.url)}" lang="${l.locale}" ${l.locale === content.locale ? 'aria-current="page"' : ""}>${labels[l.locale]}</a>`;
    })
    .join(" ");
  return `<!doctype html><html lang="${content.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(content.title)}</title><meta name="description" content="${escape(content.summary.slice(0, 180))}"><meta property="og:title" content="${escape(content.title)}"><meta property="og:description" content="${escape(content.summary.slice(0, 180))}"><style>*,*::before,*::after{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0}img{max-width:100%;height:auto}p{white-space:pre-line}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}${code.css}</style></head><body>${languageLinks ? `<nav class="studio-languages" aria-label="${content.locale === "ja" ? "言語" : content.locale === "zh-Hant" ? "語言" : "Language"}">${languageLinks}</nav>` : ""}${serialize(root)}</body></html>`;
}
