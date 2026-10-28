import type { WorldDraft, Translation } from "../shared/contracts";
export class DomainError extends Error {
  constructor(
    public code: string,
    message = code,
    public status = 409,
  ) {
    super(message);
  }
}
export function assertRevision(world: WorldDraft, revision: number) {
  if (world.revision !== revision) throw new DomainError("REVISION_CONFLICT");
}
export function validateConfirmation(
  world: WorldDraft,
  processed: number,
  total: number,
) {
  if (!total || processed !== total || world.status === "reading")
    throw new DomainError("SOURCE_INCOMPLETE");
  if (world.questions.some((q) => !q.answer?.trim()))
    throw new DomainError("UNRESOLVED_QUESTIONS");
  if (world.questions.length && world.resolvedDecisions !== decisionKey(world))
    throw new DomainError("SETTINGS_NOT_RESOLVED");
  const approved = world.visualApproval;
  const preview = world.previews.find((p) => p.id === approved?.previewId);
  if (
    !approved ||
    approved.revision !== world.revision ||
    !preview ||
    preview.revision !== world.revision ||
    preview.styleId !== world.selectedStyleId ||
    preview.review.verdict !== "pass"
  )
    throw new DomainError("VISUAL_NOT_APPROVED");
  if ((!world.brief && !world.elements.length) || !world.summary.trim())
    throw new DomainError("WORLD_EMPTY");
}
export function validateLocale(world: WorldDraft, t: Translation) {
  if (t.sourceRevision !== world.revision)
    throw new DomainError("STALE_TRANSLATION");
  if (t.issues.length) throw new DomainError("TRANSLATION_REVIEW_REQUIRED");
  if (!t.title.trim() || !t.tagline.trim() || !t.introduction.trim())
    throw new DomainError("TRANSLATION_INCOMPLETE");
  for (const e of world.elements) {
    const et = t.elements[e.id];
    if (
      !et?.name.trim() ||
      !et.definition.trim() ||
      e.features.some((f) => !et.features[f.id]?.trim())
    )
      throw new DomainError("TRANSLATION_INCOMPLETE");
  }
  if (
    Object.keys(t.elements).some(
      (id) => !world.elements.some((e) => e.id === id),
    )
  )
    throw new DomainError("UNKNOWN_ELEMENT");
}
export function splitSegments(text: string, maxChars = 10000) {
  const points = Array.from(text),
    result: { id: string; start: number; end: number; text: string }[] = [];
  for (let start = 0; start < points.length;) {
    let end = Math.min(start + maxChars, points.length);
    if (end < points.length) {
      const tail = points
        .slice(start + Math.floor(maxChars * 0.7), end)
        .join("");
      const last = tail.lastIndexOf("\n");
      if (last >= 0)
        end =
          start +
          Math.floor(maxChars * 0.7) +
          Array.from(tail.slice(0, last + 1)).length;
    }
    result.push({
      id: `segment_${result.length + 1}`,
      start,
      end,
      text: points.slice(start, end).join(""),
    });
    start = end;
  }
  return result;
}
export function revised(world: WorldDraft): WorldDraft {
  return {
    ...world,
    revision: world.revision + 1,
    status: "draft",
    frameworkApproval: null,
    briefApproval: null,
    visualApproval: null,
    translations: Object.fromEntries(
      Object.entries(world.translations).map(([k, v]) => [
        k,
        { ...v, status: "stale", approvedAt: null },
      ]),
    ),
    updatedAt: new Date().toISOString(),
  };
}
export async function sha256(text: string | ArrayBuffer) {
  const raw = typeof text === "string" ? new TextEncoder().encode(text) : text;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
export const now = () => new Date().toISOString();
export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function decisionKey(w: WorldDraft) {
  return JSON.stringify(
    w.questions
      .map((q) => [q.id, q.answer])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

export async function translationHash(t: Translation | undefined) {
  return t
    ? sha256(
        JSON.stringify({
          locale: t.locale,
          sourceRevision: t.sourceRevision,
          title: t.title,
          tagline: t.tagline,
          introduction: t.introduction,
          elements: t.elements,
        }),
      )
    : null;
}

/** Recover formatting-only quote differences while retaining the exact original span. */
export function resolveQuote(source: string, quote: string): string | null {
  if (!quote.trim()) return null;
  if (source.includes(quote)) return quote;
  const compact = (input: string) => {
    let text = "",
      offset = 0;
    const starts: number[] = [],
      ends: number[] = [];
    let whitespace = false;
    for (const char of input) {
      if (/\s/u.test(char)) {
        if (!whitespace) {
          text += " ";
          starts.push(offset);
          ends.push(offset + char.length);
        } else ends[ends.length - 1] = offset + char.length;
        whitespace = true;
      } else {
        text += char;
        for (let i = 0; i < char.length; i++) {
          starts.push(offset);
          ends.push(offset + char.length);
        }
        whitespace = false;
      }
      offset += char.length;
    }
    return { text, starts, ends };
  };
  const original = compact(source),
    needle = compact(quote.trim()).text;
  const start = original.text.indexOf(needle);
  return start < 0
    ? null
    : source.slice(
        original.starts[start],
        original.ends[start + needle.length - 1],
      );
}
