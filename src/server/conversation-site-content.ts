import { z } from "zod";
import type {
  ConversationDocument,
  StudioLocale,
} from "../shared/conversation";
import type { SiteContent } from "./conversation-site-code";
import { DomainError } from "./domain";
import { publicTextIssues, publicLocaleIssues } from "./public-copy";
const entry = z.object({
  title: z.string(),
  body: z.string(),
  caption: z.string(),
  elementIds: z.array(z.string()).optional(),
});
export const publicEditorialSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  entries: z.array(entry).min(1),
});
const localeSchema = z.object({
  locale: z.enum(["en", "zh-Hant", "ja"]),
  title: z.string(),
  summary: z.string(),
  entries: z.array(entry),
  terms: z.array(
    z.object({ id: z.string(), name: z.string(), definition: z.string() }),
  ),
});
export function buildSiteContents(
  doc: ConversationDocument,
  assetUrl: string,
): Partial<Record<StudioLocale, SiteContent>> {
  if (!doc.direction || !doc.world || !doc.visual?.selectedAssetId)
    throw new DomainError(
      "SITE_WORLD_NOT_READY",
      "請先和我確認世界方向、代表內容與視覺，再製作網站。",
      422,
    );
  const base = publicEditorialSchema.safeParse(doc.editorial);
  if (!base.success)
    throw new DomainError(
      "SITE_COPY_REQUIRED",
      "網站還需要一份可公開的文字樣本，我會先整理內容供預覽。",
      422,
    );
  const en: SiteContent = {
    locale: "en",
    ...base.data,
    entries: base.data.entries.map((e) => ({ ...e, imageUrl: assetUrl })),
    elements: doc.world.elements.map((e) => ({
      id: e.id,
      name: e.names.en,
      definition: e.definition,
      appearance: e.appearance,
    })),
    imageUrl: assetUrl,
    caption: base.data.entries[0]?.caption || "",
  };
  // English definitions must come from a reviewed English translation, rather than private author-facing notes.
  const result: Partial<Record<StudioLocale, SiteContent>> = { en };
  if (
    doc.translations &&
    doc.editorialHash &&
    doc.translationsSourceHash !== doc.editorialHash
  )
    throw new DomainError(
      "SITE_TRANSLATION_STALE",
      "公開文字已更新，會先同步各語系後再提供網站預覽。",
      422,
    );
  const translated = z
    .object({ locales: z.array(localeSchema) })
    .safeParse(doc.translations);
  if (translated.success) {
    for (const l of translated.data.locales) {
      if (
        l.entries.length !== base.data.entries.length ||
        doc.world.elements.some((e) => !l.terms.some((t) => t.id === e.id))
      )
        throw new DomainError(
          "SITE_TRANSLATION_INCOMPLETE",
          "語系仍有缺少的內容，完成校準後才能一起上線。",
          422,
        );
      result[l.locale] = {
        locale: l.locale,
        title: l.title,
        summary: l.summary,
        entries: l.entries.map((e) => ({ ...e, imageUrl: assetUrl })),
        elements: doc.world.elements.map((e) => {
          const t = l.terms.find((t) => t.id === e.id)!;
          return {
            id: e.id,
            name: t.name,
            definition: t.definition,
            appearance: "",
          };
        }),
        imageUrl: assetUrl,
        caption: l.entries[0]?.caption || "",
      };
    }
  }
  if (!translated.success && doc.world.elements.length)
    throw new DomainError(
      "SITE_TRANSLATION_REQUIRED",
      "需要先完成英文名稱與公開定義的檢查，避免將私人設定放到網站。",
      422,
    );
  return result;
}
export function visibleCopy(
  contents: Partial<Record<StudioLocale, SiteContent>>,
) {
  return Object.values(contents).flatMap((c) => [
    c.title,
    c.summary,
    c.caption,
    ...c.entries.flatMap((e) => [e.title, e.body, e.caption]),
    ...c.elements.flatMap((e) => [e.name, e.definition, e.appearance]),
  ]);
}
export function assertPublicCopy(
  contents: Partial<Record<StudioLocale, SiteContent>>,
) {
  if (
    visibleCopy(contents).some((text) => publicTextIssues(text).length > 0) ||
    Object.values(contents).some(
      (content) =>
        publicLocaleIssues(
          [
            content.title,
            content.summary,
            content.caption,
            ...content.entries.flatMap((entry) => [
              entry.title,
              entry.body,
              entry.caption,
            ]),
            ...content.elements.flatMap((element) => [
              element.definition,
              element.appearance,
            ]),
          ],
          content.locale,
        ).length > 0,
    )
  )
    throw new DomainError(
      "PUBLIC_COPY_REVIEW_REQUIRED",
      "公開內容還有不適合對讀者呈現的工作文字，修正後再發布。",
      422,
    );
}
