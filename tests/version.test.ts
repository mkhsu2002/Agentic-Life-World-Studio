import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PRODUCT_VERSION } from "../src/shared/version";
it("keeps the product version, npm metadata and deployment baseline consistent", () => {
  const version = readFileSync("VERSION", "utf8").trim();
  expect(version).toMatch(/^\d+\.\d{2}$/);
  expect(PRODUCT_VERSION).toBe(version);
  const [major, hundredths] = version.split(".").map(Number);
  const npmVersion = `0.0.${major * 100 + hundredths}`;
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(manifest.version).toBe(npmVersion);
  expect(lock.version).toBe(npmVersion);
  expect(lock.packages[""].version).toBe(npmVersion);
});
