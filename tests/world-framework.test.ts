import { expect, it } from "vitest";
import { frameworkSchema, moduleKeys } from "../src/shared/world-framework";
import {
  frameworkHash,
  validateFrameworkReview,
  assertFrameworkReviewed,
} from "../src/server/world-framework";
import { revised } from "../src/server/domain";
import type { WorldDraft } from "../src/shared/contracts";

import { frameworkFixture, frameworkWorld } from "./fixtures/world-framework";
it("requires exactly one of each of the eight modules", () => {
  const f = frameworkFixture();
  expect(
    frameworkSchema.safeParse({ ...f, modules: f.modules.slice(1) }).success,
  ).toBe(false);
  expect(
    frameworkSchema.safeParse({
      ...f,
      modules: [...f.modules.slice(1), f.modules[1]],
    }).success,
  ).toBe(false);
});
it("keeps unknown distinct from not applicable without creating inhabitants", () => {
  const f = frameworkFixture();
  f.modules[5].status = "not_applicable";
  expect(frameworkSchema.parse(f).modules[5].status).toBe("not_applicable");
  expect(f.extensions).toEqual([]);
});
it("does not accept unresolved extensions or blocking issues", () => {
  const w = frameworkWorld();
  w.framework!.extensions.push({
    id: "x",
    module: "environment",
    title: "Ambient detail",
    definition: "A proposed condition",
    reason: "Missing detail",
    limits: "Only the initial area",
    decision: "pending",
  });
  expect(() => validateFrameworkReview(w)).toThrow(
    "EXTENSION_DECISIONS_REQUIRED",
  );
  w.framework!.extensions[0].decision = "rejected";
  w.framework!.issues.push({
    id: "i",
    module: "time",
    message: "Time is ambiguous",
    recommendation: "Keep relative order",
    blocking: true,
    resolution: "",
  });
  expect(() => validateFrameworkReview(w)).toThrow(
    "FRAMEWORK_ISSUES_UNRESOLVED",
  );
  w.framework!.issues[0].resolution = "Use relative order";
  expect(() => validateFrameworkReview(w)).not.toThrow();
});
it("binds author review to content, not timestamps, translations or job progress", async () => {
  const w = frameworkWorld(),
    hash = await frameworkHash(w);
  w.frameworkApproval = { hash, revision: 1, approvedAt: "now" };
  await expect(assertFrameworkReviewed(w)).resolves.toBeUndefined();
  w.updatedAt = "later";
  w.recordVersion = 8;
  expect(await frameworkHash(w)).toBe(hash);
  w.framework!.anchors[0].definition = "A different boundary";
  await expect(assertFrameworkReviewed(w)).rejects.toThrow(
    "FRAMEWORK_NOT_APPROVED",
  );
});
it("invalidates author review and visual approval on content revision", () => {
  const w = frameworkWorld();
  w.frameworkApproval = { hash: "old", revision: 1, approvedAt: "now" };
  expect(revised(w).frameworkApproval).toBeNull();
});
it("rejects legacy worlds without a framework instead of implying approval", async () => {
  const w = frameworkWorld();
  delete w.framework;
  await expect(assertFrameworkReviewed(w)).rejects.toThrow(
    "FRAMEWORK_REQUIRED",
  );
});

it("rejects an exploration start that does not exist in the element registry", () => {
  const w = frameworkWorld();
  w.framework!.exploration.startPlace = "missing";
  expect(() => validateFrameworkReview(w)).toThrow("FRAMEWORK_START_INVALID");
});
