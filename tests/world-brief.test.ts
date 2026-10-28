import { expect, it } from "vitest";
import { worldBriefSchema, briefKeys } from "../src/shared/world-brief";
const fixture = () => ({
  version: "world-brief/0.06",
  ...Object.fromEntries(
    briefKeys.map((key) => [key, "未交代的部分保持未知，依已知設定呈現。"]),
  ),
  decisions: [],
  evidence: [],
  referenceStatus: "not_provided",
});
it("accepts exactly the six creative sections without demanding game entities or a starting place", () => {
  const b = worldBriefSchema.parse(fixture());
  expect(briefKeys).toHaveLength(6);
  expect(b.decisions).toEqual([]);
  expect(b).not.toHaveProperty("anchors");
  expect(b).not.toHaveProperty("relations");
  expect(b).not.toHaveProperty("exploration");
});
it("bounds author decisions and requires unique decision identities", () => {
  const d = {
    id: "choice",
    section: "viewpoint",
    question: "要採哪個觀看視角？",
    suggestion: "不具名觀察者",
    answer: "",
  };
  expect(
    worldBriefSchema.safeParse({ ...fixture(), decisions: [d, d] }).success,
  ).toBe(false);
  expect(
    worldBriefSchema.safeParse({
      ...fixture(),
      decisions: Array.from({ length: 6 }, (_, i) => ({ ...d, id: String(i) })),
    }).success,
  ).toBe(false);
});

it("binds a brief approval to its full content and invalidates it on any content revision", async () => {
  const { briefHash, validateBriefReview } =
    await import("../src/server/world-brief");
  const { assertFrameworkReviewed } =
    await import("../src/server/world-framework");
  const { frameworkWorld } = await import("./fixtures/world-framework");
  const { revised } = await import("../src/server/domain");
  const w = frameworkWorld();
  delete w.framework;
  w.elements = [];
  w.brief = worldBriefSchema.parse(fixture());
  expect(() => validateBriefReview(w)).not.toThrow();
  await expect(assertFrameworkReviewed(w)).rejects.toThrow(
    "BRIEF_NOT_APPROVED",
  );
  w.briefApproval = {
    hash: await briefHash(w),
    revision: w.revision,
    approvedAt: "now",
  };
  await expect(assertFrameworkReviewed(w)).resolves.toBeUndefined();
  expect(revised(w).briefApproval).toBeNull();
  w.brief.boundaries = "不可自行加入新的核心法則。";
  await expect(assertFrameworkReviewed(w)).rejects.toThrow(
    "BRIEF_NOT_APPROVED",
  );
});
