import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
it("keeps GitHub webhook validation on public HTTPS while private registration callbacks stay on loopback", () => {
  const script =
    "import sys,importlib.util,json;sys.path.insert(0,'scripts');s=importlib.util.spec_from_file_location('setup','scripts/configure-github-app.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.manifest_for('http://127.0.0.1:23456','test-nonce')))";
  const manifest = JSON.parse(
    execFileSync("python3", ["-c", script], { encoding: "utf8" }),
  );
  const hook = new URL(manifest.hook_attributes.url);
  expect(hook.protocol).toBe("https:");
  expect(hook.hostname).toBe(
    "agentic-world-studio-production.mkhsu2002.workers.dev",
  );
  expect(manifest.hook_attributes.active).toBe(false);
  expect(new URL(manifest.redirect_url).origin).toBe("http://127.0.0.1:23456");
  expect(new URL(manifest.setup_url).searchParams.get("state")).toBe(
    "test-nonce",
  );
  expect(manifest.public).toBe(false);
  expect(manifest.default_permissions.actions).toBe("write");
});
