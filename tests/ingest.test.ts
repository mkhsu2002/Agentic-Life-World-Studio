import { it, expect } from "vitest";
import { validateSourceUrl, normalizeText } from "../src/server/ingest";
it("rejects loopback and metadata URLs including normalized IP variants", () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://localhost/",
    "file:///etc/passwd",
  ])
    expect(() => validateSourceUrl(url)).toThrow();
});
it("normalizes line endings and Unicode without silently truncating", () => {
  const t = "e\u0301\r\n正文";
  expect(normalizeText(t)).toBe("é\n正文");
});
