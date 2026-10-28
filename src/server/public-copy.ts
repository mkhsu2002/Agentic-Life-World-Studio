import { z } from "zod";
import type { StudioLocale } from "../shared/conversation";
const entry = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  caption: z.string().trim().min(1),
});
const editorial = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  entries: z.array(entry).min(1),
});
const translation = z.object({
  locales: z
    .array(
      editorial.extend({
        locale: z.enum(["en", "zh-Hant", "ja"]),
        terms: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string().trim().min(1),
            definition: z.string().trim().min(1),
          }),
        ),
      }),
    )
    .length(3),
});
const privateLanguage =
  /(?:DRAFT_CANON|CANON_ANCHOR|system prompt|muse-spark|muse-image|MODEL_API_KEY|原著核心錨點|作者裁定|內部提示詞|生成規格|補全提案|原文明示|並非出自原文|不出自原文|建議新增|(?:延伸|補全)創作(?:的)?(?:提議|建議|提案)|(?:等待|待|尚待)(?:作者)?(?:確認|核准)|(?:公開|私人)預覽(?:的)?草稿|柔和水彩中的|private preview|preview draft|draft (?:only|for (?:author )?approval)|(?:added )?imaginative proposals?|(?:extension|worldbuilding|generated) proposals?|(?:not|absent) (?:from|in) the original (?:pages|text|work|novel)|(?:the )?original (?:pages|manuscript) (?:state|say|describe)|(?:awaiting|waiting for|pending) (?:the )?author(?:'s)? (?:approval|confirmation)|left open to keep,? revise or drop|soft watercolor look:|no self-running activity|プライベート(?:な)?プレビュー|(?:作者|著者)の(?:確認|承認)待ち|補完提案|原作には(?:登場|記載)しない)/i;
export function publicTextIssues(
  text: string,
  locale?: StudioLocale,
): string[] {
  const issues: string[] = [];
  if (privateLanguage.test(text))
    issues.push(
      "公開文字包含原作比對、待確認提案、私稿或製作註記；請只保留讀者能直接理解的世界內容。",
    );
  if (locale === "en" && text.trim()) {
    const prose = text.replace(/《[^》]*》|「[^」]*」|『[^』]*』/g, "");
    const han = (prose.match(/\p{Script=Han}/gu) || []).length;
    const kana = (
      prose.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []
    ).length;
    const latin = (prose.match(/[A-Za-z]/g) || []).length;
    if (han + kana > 2 && latin < (han + kana) * 2)
      issues.push(
        "英文公開文字仍含未翻譯的說明，請使用英文，保留必要專名即可。",
      );
  }
  if (locale && locale !== "en" && text.length >= 24) {
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const local = (
      text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ||
      []
    ).length;
    if (
      (latin > 20 && local < latin / 5) ||
      (locale === "ja" &&
        local >= 24 &&
        !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))
    )
      issues.push("公開段落仍有未完成的語系翻譯，不能只翻譯標題或問候。");
  }
  return issues;
}
function prose(value: z.infer<typeof editorial>) {
  return [
    value.title,
    value.summary,
    ...value.entries.flatMap((e) => [e.title, e.body, e.caption]),
  ];
}
export function publicLocaleIssues(texts: string[], locale: StudioLocale) {
  const issues = texts.flatMap((text) => publicTextIssues(text, locale));
  const joined = texts.join(" ");
  if (locale === "zh-Hant" && !/\p{Script=Han}/u.test(joined))
    issues.push("繁體中文公開內容尚未完成翻譯。");
  if (
    locale === "ja" &&
    !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(joined)
  )
    issues.push("日文公開內容尚未完成翻譯。");
  return issues;
}
export function publicEditorialIssues(candidate: unknown): string[] {
  const parsed = editorial.safeParse(candidate);
  if (!parsed.success) return ["公開內容需要完整標題、介紹與日誌樣本。"];
  return [...new Set(publicLocaleIssues(prose(parsed.data), "en"))];
}
export function publicTranslationIssues(candidate: unknown): string[] {
  const parsed = translation.safeParse(candidate);
  if (
    !parsed.success ||
    new Set(parsed.data.locales.map((l) => l.locale)).size !== 3
  )
    return ["公開內容需要完整中英日三語。"];
  return [
    ...new Set(
      parsed.data.locales.flatMap((l) =>
        publicLocaleIssues(
          [...prose(l), ...l.terms.map((t) => t.definition)],
          l.locale,
        ).concat(l.terms.flatMap((t) => publicTextIssues(t.name))),
      ),
    ),
  ];
}
