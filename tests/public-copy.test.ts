import { describe, it, expect } from "vitest";
import {
  publicEditorialIssues,
  publicTranslationIssues,
} from "../src/server/public-copy";
import { assertPublicCopy } from "../src/server/conversation-site-content";
const entry = {
  title: "A quiet shore",
  body: "A boat rests on the shore beside green seaweed.",
  caption: "A wooden boat beside the water.",
};
const clean = {
  title: "Along the shore",
  summary: "Small details of daily coastal life.",
  entries: [entry],
};
describe("reader copy boundaries", () => {
  it("routes incomplete or whitespace-only editorial fields back for repair", () => {
    for (const field of ["title", "summary"])
      expect(
        publicEditorialIssues({ ...clean, [field]: "  " }).length,
      ).toBeGreaterThan(0);
    expect(
      publicEditorialIssues({ ...clean, entries: [{ ...entry, body: "" }] })
        .length,
    ).toBeGreaterThan(0);
  });
  it("rejects author-only notes even when the underlying story facts are valid", () => {
    expect(
      publicEditorialIssues({
        ...clean,
        title: "紙燈沿岸・公開預覽草稿",
        summary: "原文明示海岸。其餘皆為延伸創作的提議，等待作者確認。",
      }).length,
    ).toBeGreaterThan(0);
    expect(
      publicEditorialIssues({
        ...clean,
        title: "A Private Preview",
        summary:
          "Added imaginative proposals, not from the original pages, left open to keep, revise or drop.",
      }).length,
    ).toBeGreaterThan(0);
  });
  it("checks English prose without banning fictional proposals or a boat's draft", () => {
    expect(
      publicEditorialIssues({
        ...clean,
        summary:
          "Her proposal was to follow the boat, whose draft was shallow.",
      }),
    ).toEqual([]);
    expect(
      publicEditorialIssues({
        ...clean,
        summary: "這是一段完整的中文介紹，尚未翻成英文。",
      }).length,
    ).toBeGreaterThan(0);
  });
  it("checks all locales and definitions, with proper names retained", () => {
    const locales = [
      {
        locale: "en",
        ...clean,
        terms: [
          { id: "a", name: "K", definition: "A quiet visitor to the shore." },
        ],
      },
      {
        locale: "zh-Hant",
        title: "沿岸漫步",
        summary: "潮水輕拍木船，居民在岸邊晾曬海藻。",
        entries: [
          {
            title: "安靜的海岸",
            body: "我沿著木船與海藻之間的小路慢慢前進。",
            caption: "木船停在岸邊。",
          },
        ],
        terms: [{ id: "a", name: "K", definition: "一位安靜的旅人。" }],
      },
      {
        locale: "ja",
        title: "海岸を歩く",
        summary: "潮が木船をそっと揺らす。",
        entries: [
          {
            title: "静かな浜辺",
            body: "海藻のそばをゆっくり歩く。",
            caption: "浜辺に木船がある。",
          },
        ],
        terms: [{ id: "a", name: "K", definition: "静かに旅する人。" }],
      },
    ];
    expect(publicTranslationIssues({ locales })).toEqual([]);
    const leaked = structuredClone(locales);
    leaked[2].terms[0].definition = "作者の承認待ちの補完提案です。";
    expect(publicTranslationIssues({ locales: leaked }).length).toBeGreaterThan(
      0,
    );
    const incorrect = structuredClone(locales);
    incorrect[2] = { ...incorrect[2], ...clean, terms: [] };
    expect(
      publicTranslationIssues({ locales: incorrect }).length,
    ).toBeGreaterThan(0);
  });
  it("blocks an internal note at the final preview/publication boundary", () => {
    const content = {
      locale: "en" as const,
      ...clean,
      elements: [
        {
          id: "a",
          name: "Shore",
          definition:
            "Added imaginative proposal, not from the original pages.",
          appearance: "",
        },
      ],
      imageUrl: null,
      caption: entry.caption,
    };
    expect(() => assertPublicCopy({ en: content })).toThrow();
  });
});
