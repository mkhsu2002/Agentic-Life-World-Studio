import { expect, it } from "vitest";
import {
  validateSiteCode,
  renderSiteHtml,
} from "../src/server/conversation-site-code";
const code = {
  html: '<main><h1 data-slot="title"></h1><p data-slot="summary"></p><section id="journal"><article data-repeat="entries"><h2 data-slot="entry.title"></h2><p data-slot="entry.body"></p></article></section><img data-slot="hero" alt=""></main>',
  css: "body {color:#243025;background:#faf9f5} @media(max-width:600px){main{padding:20px}}",
};
const content = {
  locale: "en" as const,
  title: "A <world>",
  summary: "An & island",
  entries: [
    {
      title: "A day",
      body: "<script>private()</script>",
      caption: "A landscape",
    },
  ],
  elements: [],
  imageUrl: "/api/public/studio/artwork/r/a",
  caption: "Landscape",
};
it("accepts independent layouts and substitutes only escaped public data", () => {
  validateSiteCode(code);
  const html = renderSiteHtml(code, content);
  expect(html).toContain("A &lt;world&gt;");
  expect(html).toContain("&lt;script&gt;private()&lt;/script&gt;");
  expect(html).not.toContain("<script>private");
  expect(html).toContain("A day");
});
it.each([
  "<script>alert(1)</script>",
  '<img src="https://x.test/pixel">',
  '<a href="javascript:alert(1)">Explore</a>',
  "<iframe></iframe>",
  '<div onclick="run()"></div>',
  "<p>Unapproved original story</p>",
])("rejects unsafe or story-bearing generated markup %s", (html) => {
  expect(() => validateSiteCode({ ...code, html })).toThrow();
});
it.each([
  '@import "https://x.test/a.css";',
  "body{background:url(https://x.test)}",
  "body{background:u\\72l(https://x.test)}",
  "</style><script>alert(1)</script>",
])("rejects external requests and CSS escapes", (css) => {
  expect(() => validateSiteCode({ ...code, css })).toThrow();
});
it("requires a title slot and a usable content section", () => {
  expect(() => validateSiteCode({ html: "<main></main>", css: "" })).toThrow();
});
it.each([
  'body::before{content:"PRIVATE_AUTHOR_NOTES"}',
  'body{--hidden:"private"}',
  "body{font-family:秘密設定}",
])("rejects CSS literal copy or hidden private strings", (css) => {
  expect(() => validateSiteCode({ ...code, css })).toThrow();
});
it.each(['role="private-author-note"', 'loading="private"', 'width="private"'])(
  "restricts non-text attributes to semantic values",
  (attr) => {
    expect(() =>
      validateSiteCode({
        ...code,
        html: code.html.replace("<main>", `<main ${attr}>`),
      }),
    ).toThrow();
  },
);
it("localizes navigation and accessibility text across Chinese and Japanese", () => {
  const layout = {
    ...code,
    html: code.html.replace(
      "<main>",
      '<main><nav aria-label="Menu"><a href="#journal">Journal</a></nav>',
    ),
  };
  const zh = renderSiteHtml(layout, { ...content, locale: "zh-Hant" }),
    ja = renderSiteHtml(layout, { ...content, locale: "ja" });
  expect(zh).toContain('aria-label="選單"');
  expect(zh).toContain(">日誌</a>");
  expect(ja).toContain('aria-label="メニュー"');
  expect(ja).toContain(">日誌</a>");
});
it("allows layout alignment and scroll properties while rejecting generated content and legacy behavior declarations", () => {
  const safe =
    "main{display:flex;justify-content:space-between;align-content:center;scroll-behavior:smooth}main > section{min-width:0}";
  expect(validateSiteCode({ ...code, css: safe }).css).toBe(safe);
  for (const css of [
    "main{content:attr(id)}",
    "main{behavior:custom}",
    "main{/* separator */content:attr(id)}",
  ]) {
    expect(() => validateSiteCode({ ...code, css })).toThrow();
  }
});
