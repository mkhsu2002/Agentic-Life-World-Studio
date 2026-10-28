import { z } from "zod";
import type { Env } from "./env";
import type { TaskRow } from "./conversation-store";
import { modelResult, schemas, directionSchema } from "./conversation-agents";
import { DomainError } from "./domain";
export type DirectorCandidate = z.infer<typeof schemas.director>;
export type WorldAuthorCandidate = z.infer<typeof schemas.world>;
function languageIssue(value: string) {
  const prose = value
    .replace(/《[^》]*》/g, "")
    .replace(/\b(?:AI|IP|API|PDF|DOCX|UI|VR|AR)\b/g, "");
  const han = (prose.match(/\p{Script=Han}/gu) || []).length,
    latin = (prose.match(/[A-Za-z]/g) || []).length,
    kana = (value.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || [])
      .length;
  return !han || (latin > 12 && han / (han + latin) < 0.2) || kana > 4;
}
function repetitiveCopy(value: string) {
  const units = value
    .split(/[。！？.!?\n]+/u)
    .map((part) => part.replace(/\s+/gu, "").trim())
    .filter((part) => part.length >= 8);
  const counts = new Map<string, number>();
  for (const unit of units) counts.set(unit, (counts.get(unit) || 0) + 1);
  return [...counts.values()].some((count) => count >= 3);
}
function unsupportedNamingInference(value: string) {
  return value
    .split(/[。！？\n]/u)
    .some(
      (sentence) =>
        !/(?:不代表|不等於|不意味著)/u.test(sentence) &&
        /(?:未|沒有|尚無|缺少).{0,12}(?:命名|名稱|名字).{0,24}(?:(?:因此|所以|因而|故|代表|意味著).{0,8})?(?:禁止|不得|不可|不能|不允許|不應).{0,12}(?:命名|取名|改名|新名稱)/u.test(
          sentence,
        ),
    );
}
function internalLanguage(value: string) {
  const text = value.replace(/《[^》]*》/g, "");
  if (
    new Set(
      text.match(
        /\b(?:direction|core|extension|exploration|continuity|visual|audience|action|frequencyHours|maxCalls)\b/gi,
      ) || [],
    ).size >= 2
  )
    return true;
  if (
    /\b(?:core|extension|exploration|continuity|visual|audience|action)\s*(?:欄位|字段|物件|key)/i.test(
      text,
    )
  )
    return true;
  return (
    /\b(?:direction|core|extension|exploration|continuity|audience|world|journey|visual|editorial|translation|director|operation)\s*[/／、,，]\s*(?:direction|core|extension|exploration|continuity|audience|world|journey|visual|editorial|translation|director|operation)\b/i.test(
      text,
    ) ||
    /`(?:direction|core|extension|exploration|continuity|audience|world|journey|visual|editorial|translation|director|operation)`/i.test(
      text,
    ) ||
    /["']?(?:action|direction|core|extension|exploration|continuity|audience|frequencyHours|maxCalls)["']?\s*[:=：]/i.test(
      text,
    ) ||
    /(?:上面|上述|這個|這份|你的|回傳的)\s*direction\b|\bdirection\s*(?:的|中|裡|欄位|物件|提案)|(?:執行|呼叫|調用|分派|派給|啟動|進入|切換到|交給)\s*(?:world|journey|visual|editorial|translation|director|operation)\b/i.test(
      text,
    ) ||
    /\b(?:proposal|ctask|element|source|asset)_[a-z0-9]{8,}/i.test(text)
  );
}
function authorBodyIssues(value: string, label: string, requireChinese = true) {
  const issues: string[] = [];
  if (value.trim() && requireChinese && languageIssue(value))
    issues.push(`${label}需要自然繁體中文，保留必要專名即可。`);
  if (repetitiveCopy(value))
    issues.push(`${label}反覆重複相同句子或段落，應精簡為一次清楚的說明。`);
  if (unsupportedNamingInference(value))
    issues.push(
      `${label}把原著未命名推成禁止命名，應區分留白與原作明示禁令，提出待作者核准的命名建議。`,
    );
  if (internalLanguage(value))
    issues.push(
      `${label}使用了資料欄位或內部任務名稱，應直接對作者說明內容與選擇。`,
    );
  return issues;
}
export function directorAuthorCopyIssues(candidate: DirectorCandidate) {
  const issues = authorBodyIssues(candidate.reply, "回覆");
  if (candidate.direction)
    for (const [key, value] of Object.entries(candidate.direction))
      issues.push(...authorBodyIssues(value, `創作方向的${key}`));
  return issues;
}
export function worldAuthorCopyIssues(candidate: WorldAuthorCandidate) {
  const issues = authorBodyIssues(candidate.summary, "世界介紹");
  for (const [index, e] of candidate.elements.entries()) {
    for (const [label, value] of [
      ["定義", e.definition],
      ["外觀", e.appearance],
      ...e.features.map((f, i) => [`特色${i + 1}`, f]),
    ] as [string, string][]) {
      issues.push(...authorBodyIssues(value, `第${index + 1}項元素${label}`));
    }
  }
  return issues;
}
const prompt = `你是世界創作總監的措辭修訂步驟，只修作者可見的說明，不重新分析原著，不新增角色。將英文說明改成自然、清楚的繁體中文，讓作者知道你理解什麼、建議什麼、需要決定什麼。不要在對話列 JSON key、資料欄位名、代理角色名稱、世界編譯流程或程式動作。專名、已確認名稱及引用保留，其他說明用繁體中文。必須保留原候選的事實、建議、限制與選擇，不能新增禁令或擅自擴張權限，不能替作者確認、核准、發布或啟動。若原候選沒有名稱，不代表禁止命名；不得把留白改成禁令。若候選僅用「原著未命名」推成「不得命名」，應撤除這個無依據的推論，改為提出由作者核准的命名建議；原文明示的命名禁令必須保留，不能以改措辭刪除。刪除重複問候、重複問題和反覆段落，每個意思只表達一次，不複述歷史訊息或整段對話，也不以對話填充篇幅。回覆精簡為一至四段，聚焦當前成果與下一個選擇。修後還會交由獨立審核回查原文。只回傳指定JSON。`;
const directorCopySchema = z.object({
  reply: z.string().min(1).max(16000),
  direction: directionSchema.optional(),
});
export async function repairDirectorAuthorCopy(
  env: Env,
  task: TaskRow,
  candidate: DirectorCandidate,
  initialUnderstanding?: string,
) {
  const copySchema =
    initialUnderstanding !== undefined
      ? directorCopySchema.extend({ direction: directionSchema })
      : directorCopySchema;
  const merge = (
    copy: z.infer<typeof directorCopySchema>,
  ): DirectorCandidate => ({
    ...candidate,
    reply: copy.reply,
    ...(initialUnderstanding !== undefined
      ? { action: "direction" as const, direction: copy.direction }
      : candidate.direction
        ? { direction: copy.direction || candidate.direction }
        : {}),
  });
  const result = await modelResult(
    env,
    task,
    "author_copy",
    {
      authorCopyCandidate: candidate,
      copyIssues: directorAuthorCopyIssues(candidate),
      allowedChanges: ["reply", "direction文字"],
      ...(initialUnderstanding !== undefined
        ? { initialUnderstanding, directionRequired: true }
        : {}),
    },
    copySchema,
    [],
    prompt +
      (initialUnderstanding !== undefined
        ? "這是首次閱讀後尚未完成的創作方向提案。根據候選與已保存的有界原文理解，必須補齊六個創作方向欄位；不知道的細節標為未定並提出待核准建議，不得只問候或反覆詢問同一問題。此步只形成未核准方向，不能執行其他動作。"
        : ""),
    (copy) => {
      if (
        (candidate.direction || initialUnderstanding !== undefined) &&
        !copy.direction
      )
        throw new DomainError(
          "AUTHOR_COPY_INVALID",
          "創作提案的文字仍需整理。",
          502,
        );
      if (directorAuthorCopyIssues(merge(copy)).length)
        throw new DomainError(
          "AUTHOR_COPY_INVALID",
          "創作提案的文字仍需整理。",
          502,
        );
    },
  );
  return merge(result);
}
const worldCopySchema = z.object({
  summary: z.string().max(10000),
  elements: z
    .array(
      z.object({
        index: z.number().int().min(0),
        definition: z.string().max(10000),
        appearance: z.string().max(10000),
        features: z.array(z.string().max(10000)).max(12),
      }),
    )
    .max(12),
});
export async function repairWorldAuthorCopy(
  env: Env,
  task: TaskRow,
  candidate: WorldAuthorCandidate,
) {
  const merge = (
    copy: z.infer<typeof worldCopySchema>,
  ): WorldAuthorCandidate => ({
    ...candidate,
    summary: copy.summary,
    elements: candidate.elements.map((e, index) => {
      const update = copy.elements.find((x) => x.index === index);
      return update
        ? {
            ...e,
            definition: update.definition,
            appearance: update.appearance,
            features: update.features,
          }
        : e;
    }),
  });
  const result = await modelResult(
    env,
    task,
    "author_copy",
    {
      authorCopyCandidate: candidate,
      copyIssues: worldAuthorCopyIssues(candidate),
      allowedChanges: [
        "summary文字",
        "elements依原序號的definition/appearance/features文字",
      ],
    },
    worldCopySchema,
    [],
    prompt +
      "每個元素須回傳原序號index，不能增加、刪除、重新排序元素或特色。不要改名稱、識別碼、來源類型或元素關係。",
    (copy) => {
      if (
        copy.elements.length !== candidate.elements.length ||
        new Set(copy.elements.map((e) => e.index)).size !==
          candidate.elements.length ||
        copy.elements.some(
          (e) =>
            !candidate.elements[e.index] ||
            candidate.elements[e.index].features.length !== e.features.length,
        ) ||
        worldAuthorCopyIssues(merge(copy)).length
      )
        throw new DomainError(
          "AUTHOR_COPY_INVALID",
          "世界內容的文字仍需整理。",
          502,
        );
    },
  );
  return merge(result);
}
