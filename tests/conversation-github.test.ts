import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPair, exportPKCS8 } from "jose";
import {
  githubToken,
  verifyGitHubSignature,
} from "../src/server/conversation-github";
import type { Env } from "../src/server/env";
afterEach(() => vi.unstubAllGlobals());
it("requests an installation token restricted to the single project repository", async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY: await exportPKCS8(privateKey),
  } as Env;
  let request: any;
  vi.stubGlobal("fetch", async (_u: unknown, i: RequestInit) => {
    request = JSON.parse(String(i.body));
    return Response.json({
      token: "ephemeral-test-token",
      repositories: [{ full_name: "mkhsu2002/Agentic-Life-World-Studio" }],
    });
  });
  expect(await githubToken(env)).toBe("ephemeral-test-token");
  expect(request.repositories).toEqual(["Agentic-Life-World-Studio"]);
  expect(request.permissions).toEqual({
    contents: "write",
    pull_requests: "write",
    actions: "read",
    checks: "read",
  });
});
it("does not accept missing GitHub app configuration", async () => {
  await expect(githubToken({} as Env)).rejects.toMatchObject({
    code: "GITHUB_APP_REQUIRED",
  });
});
it("validates exact webhook bytes and rejects tampering", async () => {
  const secret = "test-webhook-secret",
    body = '{"event":"completed"}';
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature =
    "sha256=" +
    Array.from(
      new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  expect(await verifyGitHubSignature(secret, body, signature)).toBe(true);
  expect(await verifyGitHubSignature(secret, body + " ", signature)).toBe(
    false,
  );
  expect(await verifyGitHubSignature(secret, body, null)).toBe(false);
});
it("resumes an existing candidate branch after an interrupted PR creation without creating another commit", async () => {
  const { createGitHubCandidate } =
    await import("../src/server/conversation-github");
  const { sha256 } = await import("../src/server/domain");
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY: await exportPKCS8(privateKey),
  } as Env;
  const code = {
    html: '<main><h1 data-slot="title"></h1><p data-slot="summary"></p></main>',
    css: "body{color:#123456}",
  };
  const codeHash = await sha256(JSON.stringify(code));
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (init?.method === "POST") posts.push(u);
      if (u.endsWith("/access_tokens"))
        return Response.json({ token: "test-token" });
      if (u.includes("/git/ref/heads/world/"))
        return Response.json({ object: { sha: "a".repeat(40) } });
      if (u.includes("/contents/")) {
        const value = u.includes("manifest.json")
          ? JSON.stringify({ siteId: "site_test", codeHash })
          : u.includes("layout.html")
            ? code.html
            : code.css;
        return Response.json({ content: btoa(value) });
      }
      if (u.includes("/pulls?")) return Response.json([]);
      if (u.endsWith("/pulls"))
        return Response.json({
          number: 5,
          html_url: "https://github.com/test/pr/5",
        });
      throw new Error("Unexpected " + u);
    },
  );
  const result = await createGitHubCandidate(env, "site_test", code, codeHash);
  expect(result.commitSha).toBe("a".repeat(40));
  expect(result.prNumber).toBe(5);
  expect(posts.some((u) => u.includes("/git/commits"))).toBe(false);
});
it("proves that the actual deployed commit contains exactly the approved artifacts before recovering a lost callback", async () => {
  const { verifyDeployedSite } =
    await import("../src/server/conversation-github");
  const { sha256 } = await import("../src/server/domain");
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY: await exportPKCS8(privateKey),
  } as Env;
  const code = { html: "<main></main>", css: "body{color:#123456}" };
  const hash = await sha256(JSON.stringify(code));
  let tampered = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.endsWith("/access_tokens"))
      return Response.json({ token: "test-token" });
    expect(u).toContain("?ref=" + "b".repeat(40));
    return Response.json({
      content: btoa(
        u.includes("manifest.json")
          ? JSON.stringify({ siteId: "site_test", codeHash: hash })
          : u.includes("layout.html")
            ? code.html
            : tampered
              ? "body{color:red}"
              : code.css,
      ),
    });
  });
  expect(await verifyDeployedSite(env, "site_test", hash, "b".repeat(40))).toBe(
    true,
  );
  tampered = true;
  expect(await verifyDeployedSite(env, "site_test", hash, "b".repeat(40))).toBe(
    false,
  );
});
it("retries only an actually failed current-main deployment and requests scoped Actions write for recovery", async () => {
  const { retryGitHubDeployment } =
    await import("../src/server/conversation-github");
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const env = {
    GITHUB_APP_ID: "123",
    GITHUB_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY: await exportPKCS8(privateKey),
  } as Env;
  let conclusion = "failure",
    reruns = 0;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.endsWith("/access_tokens")) {
        expect(JSON.parse(String(init?.body)).permissions.actions).toBe(
          "write",
        );
        return Response.json({ token: "test-token" });
      }
      if (u.endsWith("/git/ref/heads/main"))
        return Response.json({ object: { sha: "c".repeat(40) } });
      if (u.includes("/actions/runs?"))
        return Response.json({
          workflow_runs: [
            {
              id: 9,
              name: "Validate and deploy World Studio",
              head_sha: "c".repeat(40),
              head_branch: "main",
              event: "push",
              status: "completed",
              conclusion,
            },
          ],
        });
      if (u.endsWith("/rerun-failed-jobs")) {
        reruns++;
        return new Response(null, { status: 201 });
      }
      throw new Error(u);
    },
  );
  expect((await retryGitHubDeployment(env)).retried).toBe(true);
  conclusion = "success";
  await expect(retryGitHubDeployment(env)).rejects.toMatchObject({
    code: "DEPLOYMENT_RECOVERY_REQUIRED",
  });
  expect(reruns).toBe(1);
});
