import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  assertReviewSnapshot,
  frameworkReviewReady,
  isFrameworkApproved,
  WorldReview,
} from "../src/client/world-review";
import { frameworkSchema, moduleKeys } from "../src/shared/world-framework";
import type { WorldDetail } from "../src/shared/contracts";
import { WorldPanels } from "../src/client/world-panels";

function detail(): WorldDetail {
  const framework = frameworkSchema.parse({
    version: "world-framework/0.03",
    modules: moduleKeys.map((key) => ({
      key,
      summary: "尚未交代",
      status: "unknown",
      basis: "source_explicit",
      evidence: [],
    })),
    anchors: [
      {
        id: "anchor",
        module: "identity",
        definition: "保留世界邊界",
        evidence: [],
      },
    ],
    extensions: [],
    envelopes: [],
    relations: [],
    issues: [],
    naming: {
      world: "保留原名",
      places: "保留原名",
      life: "保留原名",
      objects: "保留原名",
      translation: "名稱一致",
    },
    audience: { intent: "探索世界", tone: "平靜" },
    exploration: {
      observer: "旅人",
      knowledgeBoundary: "可見範圍",
      disclosure: "逐步發現",
      intervention: "不介入",
      startTime: "開始時",
      startPlace: "start-element",
      initialConditions: "原作條件",
      allowedTransitions: "已知路線",
    },
    fidelity: { verdict: "pass", notes: [] },
    visual: {
      referenceStatus: "not_provided",
      characteristics: "文字提案",
      invariants: [],
      forbidden: [],
    },
  });
  return {
    frameworkHash: "shown-hash",
    importReview: null,
    importSuggestions: [],
    jobs: [],
    audit: [],
    messages: [],
    releases: [],
    source: {
      id: "source",
      title: "來源",
      kind: "text",
      url: null,
      sha256: "source-hash",
      charCount: 10,
      segmentCount: 1,
      processedCount: 1,
      createdAt: "2026-10-27",
    },
    world: {
      id: "world",
      sourceId: "source",
      title: "世界",
      revision: 2,
      recordVersion: 3,
      status: "draft",
      summary: "摘要",
      era: "未交代",
      geography: "未交代",
      ecology: "未交代",
      rules: [],
      elements: [
        {
          id: "start-element",
          kind: "地點",
          sourceName: "原作入口",
          names: { en: "Entrance", "zh-Hant": "入口", ja: "入口" },
          definition: "原作的起點",
          features: [],
          aliases: [],
        },
      ],
      questions: [],
      styles: [],
      selectedStyleId: "style",
      visualApproval: null,
      mode: "mixed",
      translations: {},
      previews: [],
      createdAt: "2026-10-27",
      updatedAt: "2026-10-27",
      framework,
    },
  };
}
it("rejects approval when the shown revision, record version or content hash has changed", () => {
  const shown = detail();
  expect(() =>
    assertReviewSnapshot(structuredClone(shown), shown),
  ).not.toThrow();
  for (const field of ["revision", "recordVersion", "frameworkHash"] as const) {
    const latest = structuredClone(shown);
    if (field === "frameworkHash") latest.frameworkHash = "unseen-hash";
    else latest.world[field] = (latest.world[field] ?? 0) + 1;
    expect(() => assertReviewSnapshot(latest, shown)).toThrow(/版本|更新|變更/);
  }
});
it("requires each expansion decision and a resolution for material issues", () => {
  const { world } = detail();
  expect(frameworkReviewReady(world)).toBe(true);
  world.framework!.extensions.push({
    id: "extension",
    module: "life",
    title: "補全",
    definition: "新生命",
    reason: "待確認",
    limits: "此區域",
    decision: "pending",
  });
  expect(frameworkReviewReady(world)).toBe(false);
  world.framework!.extensions[0].decision = "rejected";
  world.framework!.issues.push({
    id: "issue",
    module: "time",
    message: "年代歧義",
    recommendation: "使用相對年代",
    blocking: true,
    resolution: "",
  });
  expect(frameworkReviewReady(world)).toBe(false);
  world.framework!.issues[0].resolution = "保留相對年代";
  expect(frameworkReviewReady(world)).toBe(true);
});
it("makes the first personal approval explicit and keeps activation disabled before visual approval", () => {
  const html = renderToStaticMarkup(
    createElement(WorldReview, {
      detail: detail(),
      busy: false,
      run: async () => true,
    }),
  );
  expect(html).toContain("我已親自檢查");
  expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  expect(html).toMatch(/type="checkbox"[^>]*disabled=""/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>核准目前設定/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>啟用這個世界/);
  expect(html).toContain("未提供參考圖");
  expect(html).toContain("世界識別與定位");
});
it("offers an explicit framework refresh for legacy worlds", () => {
  const legacy = detail();
  delete legacy.world.framework;
  legacy.frameworkHash = null;
  const html = renderToStaticMarkup(
    createElement(WorldReview, {
      detail: legacy,
      busy: false,
      run: async () => true,
    }),
  );
  expect(html).toContain("建立八模組審核表");
  expect(html).not.toContain("核准目前設定");
});

it("never treats a missing or changed framework as personally approved", () => {
  const approved = detail();
  approved.world.frameworkApproval = {
    hash: approved.frameworkHash!,
    revision: approved.world.revision,
    approvedAt: "2026-10-27",
  };
  expect(isFrameworkApproved(approved)).toBe(true);
  const changed = structuredClone(approved);
  changed.frameworkHash = "new-content";
  expect(isFrameworkApproved(changed)).toBe(false);
  delete approved.world.framework;
  expect(isFrameworkApproved(approved)).toBe(false);
});

it("offers legacy waiting imports a deliberate restart into framework review", () => {
  const waiting = detail();
  waiting.world.status = "reading";
  delete waiting.world.framework;
  waiting.frameworkHash = null;
  waiting.importReview = {
    id: "review",
    jobId: "job",
    kind: "brief",
    message: "需要確認",
    segmentOrdinal: null,
    sourceText: "",
    problems: [],
    createdAt: "2026-10-27",
  };
  const html = renderToStaticMarkup(
    createElement(WorldPanels, {
      tab: "source",
      detail: waiting,
      busy: false,
      run: async () => true,
      retry: () => {},
      openImportReview: () => {},
      onWorldUpdated: () => {},
    }),
  );
  expect(html).toContain("改用世界框架繼續整理");
});

it("keeps source files and world review mounted when changing tabs", () => {
  const props = {
    detail: detail(),
    busy: false,
    run: async () => true,
    retry: () => {},
    openImportReview: () => {},
    onWorldUpdated: () => {},
  };
  const review = renderToStaticMarkup(
    createElement(WorldPanels, { ...props, tab: "review" }),
  );
  expect(review).toContain('aria-label="原作與世界" hidden=""');
  expect(review).toContain('type="file"');
  expect(review).toContain(
    'aria-label="世界審核"><div class="tab-content world-review"',
  );
  const source = renderToStaticMarkup(
    createElement(WorldPanels, { ...props, tab: "source" }),
  );
  expect(source).toContain('aria-label="世界審核" hidden=""');
  expect(source).toContain('aria-label="原作與世界"><div class="tab-content"');
});
it("selects an existing named element as the exploration starting place", () => {
  const current = detail();
  const html = renderToStaticMarkup(
    createElement(WorldReview, {
      detail: current,
      busy: false,
      run: async () => true,
    }),
  );
  expect(html).toMatch(/探索起始地點<select[^>]*required=""/);
  expect(html).toContain(
    '<option value="start-element" selected="">原作入口 · 地點</option>',
  );
  current.world.framework!.exploration.startPlace = "missing-element";
  expect(frameworkReviewReady(current.world)).toBe(false);
});

it("shows independent fidelity findings as read-only notes while retaining author resolutions", () => {
  const current = detail();
  current.world.framework!.fidelity.notes = ["獨立核對結果，請保留原作限制"];
  current.world.framework!.issues.push({
    id: "finding",
    module: "laws",
    message: "限制待確認",
    recommendation: "保留限制",
    blocking: true,
    resolution: "由本人保留原作限制",
  });
  const html = renderToStaticMarkup(
    createElement(WorldReview, {
      detail: current,
      busy: false,
      run: async () => true,
    }),
  );
  expect(html).toContain("<li>獨立核對結果，請保留原作限制</li>");
  expect(html).not.toMatch(/<textarea[^>]*>獨立核對結果/);
  expect(html).toMatch(/<textarea[^>]*>由本人保留原作限制<\/textarea>/);
});

it("shows module provenance without allowing the author to claim a different evidence source", () => {
  const html = renderToStaticMarkup(
    createElement(WorldReview, {
      detail: detail(),
      busy: false,
      run: async () => true,
    }),
  );
  expect(html).toContain('判斷依據：<span class="badge">原文明示</span>');
  expect(html).not.toMatch(/判斷依據<select/);
  expect(html).toContain("修改摘要後，儲存時會標記為本人補充。");
});

it("keeps a repair upload entry available when all six source image slots are occupied", async () => {
  const { SourceImagePicker } =
    await import("../src/client/source-image-picker");
  const d = detail();
  d.world.sourceImages = Array.from({ length: 6 }, (_, i) => ({
    id: `i${i}`,
    assetId: `a${i}`,
    label: `圖片${i}`,
    sha256: `hash${i}`,
    status: "reviewed" as const,
  }));
  const html = renderToStaticMarkup(
    createElement(SourceImagePicker, { world: d.world, onUploaded: () => {} }),
  );
  expect(html).toContain('type="file"');
  expect(html).toContain("重新上傳");
});
