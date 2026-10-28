import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  assertReviewSnapshot,
  frameworkReviewReady,
  briefReviewReady,
  isFrameworkApproved,
  WorldReview,
} from "../src/client/world-review";
import { frameworkSchema, moduleKeys } from "../src/shared/world-framework";
import type { WorldDetail } from "../src/shared/contracts";
import { WorldPanels } from "../src/client/world-panels";
import { reviewTabStatus } from "../src/client/world-workflow";

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
      styles: [
        {
          id: "style",
          name: "文字方向",
          description: "依原作設定",
          medium: "Drawing",
          palette: ["#112233"],
          lighting: "Soft",
          materials: [],
          forbidden: [],
          evidence: [],
        },
      ],
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
function sixDetail(): WorldDetail {
  const d = detail();
  d.briefHash = "brief-hash";
  d.world.brief = {
    version: "world-brief/0.06",
    world: "世界輪廓",
    visual: "柔和插畫",
    viewpoint: "旅人的眼光",
    time: "故事開始前",
    naming: "保留原名",
    boundaries: "保留核心界線",
    decisions: [],
    evidence: [],
    referenceStatus: "not_provided",
  };
  return d;
}
function review(d = sixDetail()) {
  return renderToStaticMarkup(
    createElement(WorldReview, {
      detail: d,
      busy: false,
      run: async () => true,
    }),
  );
}
function panels(d: WorldDetail, tab = "review") {
  return renderToStaticMarkup(
    createElement(WorldPanels, {
      tab,
      detail: d,
      busy: false,
      run: async () => true,
      retry: () => {},
      openImportReview: () => {},
      onWorldUpdated: () => {},
      onNavigate: () => {},
    }),
  );
}
it("reads all six prefilled editable paragraphs without exposing legacy forms", () => {
  const html = review();
  for (const label of [
    "世界的基本樣貌",
    "一致的視覺風格",
    "觀看者與敘述聲音",
    "旅程時段與揭露界線",
    "命名與必要專有詞",
    "延伸創作範圍",
  ])
    expect(html).toContain(label);
  expect(html.match(/maxLength="4000"/g)).toHaveLength(6);
  expect(html).toContain("世界輪廓</textarea>");
  for (const text of [
    "八模組",
    "核心錨點",
    "探索起始地點",
    "元素關係",
    "地點命名",
    "忠實度備註",
  ])
    expect(html).not.toContain(text);
});
it("allows a valid zero-question brief to be approved without saving or selecting an element or style", () => {
  const d = sixDetail();
  d.world.selectedStyleId = null;
  d.world.elements = [];
  expect(briefReviewReady(d.world)).toBe(true);
  const html = review(d);
  expect(html).toContain("目前沒有需要你裁定的問題");
  expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  expect(html).not.toMatch(/type="checkbox"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>核准目前設定/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>啟用這個世界/);
});
it("requires explicit answers and leaves suggestions separate from author answers", () => {
  const d = sixDetail();
  d.world.brief!.decisions = [
    {
      id: "q",
      section: "time",
      question: "可以推進年代嗎？",
      suggestion: "維持同一時段",
      answer: "",
    },
  ];
  expect(briefReviewReady(d.world)).toBe(false);
  const html = review(d);
  expect(html).toContain("可以推進年代嗎？");
  expect(html).toContain("維持同一時段");
  expect(html).toContain("採用建議");
  expect(html).toMatch(
    /aria-label="我的回答：可以推進年代嗎？"[^>]*><\/textarea>/,
  );
  expect(html).toContain("1 項必要裁定尚未回答");
  d.world.brief!.decisions[0].answer = "維持同一時段";
  expect(briefReviewReady(d.world)).toBe(true);
});
it("rejects changed brief snapshots and never inherits legacy approval for a new brief", () => {
  const d = sixDetail();
  const changed = structuredClone(d);
  changed.briefHash = "new";
  expect(() => assertReviewSnapshot(changed, d)).toThrow(/版本/);
  d.world.frameworkApproval = {
    hash: d.frameworkHash!,
    revision: d.world.revision,
    approvedAt: "today",
  };
  expect(isFrameworkApproved(d)).toBe(false);
  d.world.briefApproval = {
    hash: d.briefHash!,
    revision: d.world.revision,
    approvedAt: "today",
  };
  expect(isFrameworkApproved(d)).toBe(true);
  expect(isFrameworkApproved(changed)).toBe(false);
});
it("offers deliberate legacy migration and retains existing approval without exposing eight modules", () => {
  const d = detail();
  expect(review(d)).toContain("用六項重新整理");
  expect(review(d)).not.toContain("八模組");
  d.world.frameworkApproval = {
    hash: d.frameworkHash!,
    revision: d.world.revision,
    approvedAt: "today",
  };
  expect(review(d)).toContain("目前設定已核准");
  expect(isFrameworkApproved(d)).toBe(true);
  expect(frameworkReviewReady(d.world)).toBe(true);
});
it("permits manual migration when source confirmation is pending and blocks active duplicate jobs", () => {
  const d = detail();
  d.world.status = "reading";
  d.source.processedCount = 0;
  d.importReview = {
    id: "r",
    jobId: "j",
    kind: "brief",
    message: "待確認",
    segmentOrdinal: null,
    sourceText: "",
    problems: [],
    createdAt: "today",
  };
  expect(review(d)).toMatch(/<button[^>]*class="primary"[^>]*>用六項重新整理/);
  d.jobs = [
    {
      id: "j",
      worldId: "world",
      kind: "analyze",
      status: "running",
      stage: "read",
      completed: 0,
      total: 1,
      error: null,
      createdAt: "today",
      updatedAt: "today",
    },
  ];
  expect(review(d)).toMatch(/<button[^>]*disabled=""[^>]*>用六項重新整理/);
});
it("keeps the review and source mounted across tabs to retain unsaved text", () => {
  const d = sixDetail();
  expect(panels(d, "source")).toContain('aria-label="世界確認" hidden=""');
  expect(panels(d, "visual")).toContain('aria-label="世界確認" hidden=""');
  expect(panels(d, "review")).toContain('aria-label="原作與世界" hidden=""');
  expect(panels(d, "source")).toContain("世界輪廓</textarea>");
  expect(panels(d, "source")).not.toContain("世界識別與定位");
});
it("uses brief readiness in guidance and offers quick approval", () => {
  const d = sixDetail();
  delete d.world.framework;
  expect(reviewTabStatus(d)).toBe("待核准");
  expect(panels(d)).toContain('href="#world-review-approval"');
  expect(panels(d)).toContain("六項創作簡報");
});
it("offers a whole-world visual preview without requiring an element", () => {
  const d = sixDetail();
  d.world.elements = [];
  d.world.briefApproval = {
    hash: d.briefHash!,
    revision: d.world.revision,
    approvedAt: "today",
  };
  const html = panels(d, "visual");
  expect(html).toContain(
    '<option value="world" selected="">整體世界景象</option>',
  );
  expect(html).toMatch(/<button class="primary">生成視覺預覽/);
});
it("blocks approval while reading or while content hash is unavailable", () => {
  const d = sixDetail();
  d.world.status = "reading";
  expect(review(d)).toMatch(/type="checkbox"[^>]*disabled=""/);
  d.world.status = "draft";
  d.briefHash = null;
  expect(review(d)).toMatch(/type="checkbox"[^>]*disabled=""/);
});
it("guides an unapproved legacy world toward explicit migration", () => {
  const html = panels(detail());
  expect(html).toContain("下一步：整理六項創作簡報");
  expect(html).not.toContain("請核對六項創作簡報與必要裁定");
});
it("never renders editable metadata or evidence in the six section form", () => {
  const d = sixDetail();
  d.world.brief!.evidence = [
    { section: "world", segmentId: "segment-one", quote: "可追溯的原文" },
  ];
  const html = review(d);
  expect(html).toContain("查看已核對的原文依據");
  expect(html).toContain("<blockquote>可追溯的原文");
  expect(html).not.toMatch(/<textarea[^>]*>可追溯的原文/);
});
