import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "./env";
import { DomainError, sha256 } from "./domain";
import type { SiteCode } from "./conversation-site-code";
const repo = "mkhsu2002/Agentic-Life-World-Studio";
export function githubConfigured(env: Env) {
  return !!(
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_PRIVATE_KEY &&
    env.GITHUB_INSTALLATION_ID
  );
}
export async function githubToken(
  env: Env,
  actions: "read" | "write" = "read",
) {
  if (!githubConfigured(env))
    throw new DomainError(
      "GITHUB_APP_REQUIRED",
      "網站製作需要連接本專案的 GitHub 發布授權。原稿與創作設定已保存，連接後可從這裡繼續。",
      503,
    );
  const key = await importPKCS8(env.GITHUB_APP_PRIVATE_KEY!, "RS256"),
    jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(env.GITHUB_APP_ID!)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime("8m")
      .sign(key);
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID!)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "WorldStudio/0.07",
        "X-GitHub-Api-Version": "2026-03-10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repositories: ["Agentic-Life-World-Studio"],
        permissions: {
          contents: "write",
          pull_requests: "write",
          actions,
          checks: "read",
        },
      }),
    },
  );
  const result = (await response.json()) as {
    token?: string;
    repositories?: { full_name: string }[];
    message?: string;
  };
  if (
    !response.ok ||
    !result.token ||
    result.repositories?.some((r) => r.full_name !== repo)
  )
    throw new DomainError(
      "GITHUB_AUTH_FAILED",
      `GitHub 發布授權未完成（HTTP ${response.status}）。請確認 App 僅授權此專案。`,
      502,
    );
  return result.token;
}
export async function githubRequest<T>(
  env: Env,
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token || (await githubToken(env))}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "WorldStudio/0.07",
      "X-GitHub-Api-Version": "2026-03-10",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new DomainError(
      "GITHUB_REQUEST_FAILED",
      `GitHub 未完成這次發布操作（HTTP ${response.status}）。已保存的內容仍保留。`,
      502,
    );
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}
const decode = (text: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(text.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
export async function createGitHubCandidate(
  env: Env,
  siteId: string,
  code: SiteCode,
  codeHash: string,
  refresh = false,
) {
  const token = await githubToken(env);
  const branch = `world/${siteId}`;
  const priorRef = await fetch(
    `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "WorldStudio/0.07",
        "X-GitHub-Api-Version": "2026-03-10",
      },
    },
  );
  if (priorRef.ok && !refresh) {
    const ref = (await priorRef.json()) as { object: { sha: string } };
    const artifacts = await Promise.all(
      ["manifest.json", "layout.html", "style.css"].map((path) =>
        githubRequest<{ content: string }>(
          env,
          `/repos/${repo}/contents/sites/${siteId}/${path}?ref=${ref.object.sha}`,
          "GET",
          undefined,
          token,
        ),
      ),
    );
    const manifest = JSON.parse(decode(artifacts[0].content));
    if (
      manifest.siteId !== siteId ||
      manifest.codeHash !== codeHash ||
      (await sha256(
        JSON.stringify({
          html: decode(artifacts[1].content),
          css: decode(artifacts[2].content),
        }),
      )) !== codeHash
    )
      throw new DomainError("SITE_CANDIDATE_CHANGED");
    const pr = await ensureCandidatePr(env, token, branch, siteId);
    return {
      branch,
      commitSha: ref.object.sha,
      prNumber: pr.number,
      prUrl: pr.html_url,
      version: "",
    };
  }
  if (!priorRef.ok && priorRef.status !== 404)
    throw new DomainError(
      "GITHUB_REQUEST_FAILED",
      `GitHub 未完成這次發布操作（HTTP ${priorRef.status}）。已保存內容仍保留。`,
      502,
    );
  const base = await githubRequest<{ object: { sha: string } }>(
      env,
      `/repos/${repo}/git/ref/heads/main`,
      "GET",
      undefined,
      token,
    ),
    commit = await githubRequest<{ tree: { sha: string } }>(
      env,
      `/repos/${repo}/git/commits/${base.object.sha}`,
      "GET",
      undefined,
      token,
    );
  const files = await Promise.all(
    ["VERSION", "package.json", "package-lock.json"].map(async (path) => {
      const r = await githubRequest<{ content: string }>(
        env,
        `/repos/${repo}/contents/${path}?ref=${base.object.sha}`,
        "GET",
        undefined,
        token,
      );
      return decode(r.content);
    }),
  );
  const old = files[0].trim();
  if (!/^0\.\d{2,}$/.test(old))
    throw new DomainError("PRODUCT_VERSION_INVALID");
  const next = "0." + String(Number(old.split(".")[1]) + 1).padStart(2, "0"),
    npmVersion = "0.0." + Number(next.split(".")[1]);
  const pkg = JSON.parse(files[1]),
    lock = JSON.parse(files[2]);
  pkg.version = npmVersion;
  lock.version = npmVersion;
  if (lock.packages?.[""]) lock.packages[""].version = npmVersion;
  const prefix = `sites/${siteId}`,
    treeEntries = [
      { path: `${prefix}/layout.html`, content: code.html },
      { path: `${prefix}/style.css`, content: code.css },
      {
        path: `${prefix}/manifest.json`,
        content:
          JSON.stringify({ siteId, codeHash, contract: "world-site/0.07" }) +
          "\n",
      },
      { path: "VERSION", content: next + "\n" },
      { path: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" },
      {
        path: "package-lock.json",
        content: JSON.stringify(lock, null, 2) + "\n",
      },
      {
        path: "src/shared/version.ts",
        content: `export const PRODUCT_VERSION = "${next}";\nexport const PRODUCT_LABEL = \`v\${PRODUCT_VERSION}\`;\n`,
      },
    ].map((e) => ({ ...e, mode: "100644", type: "blob" }));
  const tree = await githubRequest<{ sha: string }>(
      env,
      `/repos/${repo}/git/trees`,
      "POST",
      { base_tree: commit.tree.sha, tree: treeEntries },
      token,
    ),
    created = await githubRequest<{ sha: string }>(
      env,
      `/repos/${repo}/git/commits`,
      "POST",
      {
        message: `feat: add isolated world website ${siteId}`,
        tree: tree.sha,
        parents: [base.object.sha],
      },
      token,
    );
  try {
    await githubRequest(
      env,
      refresh
        ? `/repos/${repo}/git/refs/heads/${branch}`
        : `/repos/${repo}/git/refs`,
      refresh ? "PATCH" : "POST",
      refresh
        ? { sha: created.sha, force: true }
        : { ref: `refs/heads/${branch}`, sha: created.sha },
      token,
    );
  } catch (e) {
    const existing = await githubRequest<{ object: { sha: string } }>(
      env,
      `/repos/${repo}/git/ref/heads/${branch}`,
      "GET",
      undefined,
      token,
    );
    if (existing.object.sha !== created.sha) throw e;
  }
  const pr = await ensureCandidatePr(env, token, branch, siteId);
  return {
    branch,
    commitSha: created.sha,
    prNumber: pr.number,
    prUrl: pr.html_url,
    version: next,
  };
}
async function ensureCandidatePr(
  env: Env,
  token: string,
  branch: string,
  siteId: string,
) {
  const prior = await githubRequest<{ number: number; html_url: string }[]>(
    env,
    `/repos/${repo}/pulls?head=mkhsu2002:${encodeURIComponent(branch)}&state=open`,
    "GET",
    undefined,
    token,
  );
  const pr =
    prior[0] ||
    (await githubRequest<{ number: number; html_url: string }>(
      env,
      `/repos/${repo}/pulls`,
      "POST",
      {
        title: `World website ${siteId}`,
        head: branch,
        base: "main",
        body: "Adds an isolated website layout. Story content remains in the private Studio database and is supplied only through approved public snapshots.",
      },
      token,
    ));
  return pr;
}
export async function mergeGitHubCandidate(
  env: Env,
  prNumber: number,
  sha: string,
) {
  const token = await githubToken(env),
    pr = await githubRequest<{
      head: { sha: string };
      base: { ref: string };
      merged: boolean;
      merge_commit_sha?: string;
    }>(env, `/repos/${repo}/pulls/${prNumber}`, "GET", undefined, token);
  if (pr.head.sha !== sha || pr.base.ref !== "main")
    throw new DomainError(
      "SITE_CANDIDATE_CHANGED",
      "網站候選已更新，需要先確認最新預覽。",
    );
  if (pr.merged && pr.merge_commit_sha) return pr.merge_commit_sha;
  const main = await githubRequest<{ object: { sha: string } }>(
    env,
    `/repos/${repo}/git/ref/heads/main`,
    "GET",
    undefined,
    token,
  );
  const candidate = await githubRequest<{ parents: { sha: string }[] }>(
    env,
    `/repos/${repo}/git/commits/${sha}`,
    "GET",
    undefined,
    token,
  );
  if (!candidate.parents.some((p) => p.sha === main.object.sha))
    throw new DomainError(
      "SITE_REBASE_REQUIRED",
      "主程式已更新，需要先重新驗證這份網站設計。",
    );
  const runs = await githubRequest<{
    workflow_runs: {
      name: string;
      head_sha: string;
      conclusion: string | null;
      event: string;
    }[];
  }>(
    env,
    `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=50`,
    "GET",
    undefined,
    token,
  );
  if (
    !runs.workflow_runs.some(
      (r) =>
        r.name === "Validate and deploy World Studio" &&
        r.head_sha === sha &&
        r.conclusion === "success" &&
        r.event === "push",
    )
  )
    throw new DomainError(
      "SITE_CHECKS_PENDING",
      "網站仍在完成預覽驗證。完成後會在對話中通知你，目前尚未公開。",
    );
  const result = await githubRequest<{ merged: boolean; sha: string }>(
    env,
    `/repos/${repo}/pulls/${prNumber}/merge`,
    "PUT",
    { sha, merge_method: "merge" },
    token,
  );
  if (!result.merged)
    throw new DomainError(
      "SITE_MERGE_FAILED",
      "網站候選尚未能合併，原有公開版本保留。",
    );
  return result.sha;
}
export async function verifyGitHubSignature(
  secret: string,
  body: string,
  signature: string | null,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature) || !secret)
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (h) =>
    parseInt(h, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(body),
  );
}

export async function retryGitHubDeployment(env: Env) {
  const token = await githubToken(env, "write");
  const main = await githubRequest<{ object: { sha: string } }>(
    env,
    `/repos/${repo}/git/ref/heads/main`,
    "GET",
    undefined,
    token,
  );
  const data = await githubRequest<{
    workflow_runs: {
      id: number;
      name: string;
      head_sha: string;
      head_branch: string;
      event: string;
      status: string;
      conclusion: string | null;
    }[];
  }>(
    env,
    `/repos/${repo}/actions/runs?head_sha=${main.object.sha}&branch=main&event=push&per_page=50`,
    "GET",
    undefined,
    token,
  );
  const run = data.workflow_runs.find(
    (r) =>
      r.name === "Validate and deploy World Studio" &&
      r.head_sha === main.object.sha &&
      r.head_branch === "main" &&
      r.event === "push",
  );
  if (!run)
    throw new DomainError(
      "DEPLOYMENT_RUN_MISSING",
      "尚未找到這份網站的部署工作，已保存內容並保留原有網站。",
      503,
    );
  if (run.status !== "completed")
    return { runId: run.id, commitSha: main.object.sha, retried: false };
  if (
    !["failure", "cancelled", "timed_out", "action_required"].includes(
      run.conclusion || "",
    )
  )
    throw new DomainError(
      "DEPLOYMENT_RECOVERY_REQUIRED",
      "部署已完成但網站驗證尚未通過，請重試公開驗證；既有網站仍保留。",
      503,
    );
  await githubRequest(
    env,
    `/repos/${repo}/actions/runs/${run.id}/${run.conclusion === "cancelled" ? "rerun" : "rerun-failed-jobs"}`,
    "POST",
    {},
    token,
  );
  return { runId: run.id, commitSha: main.object.sha, retried: true };
}

export async function verifyDeployedSite(
  env: Env,
  siteId: string,
  codeHash: string,
  revision: string,
) {
  if (!/^[a-f0-9]{40}$/.test(revision)) return false;
  const token = await githubToken(env);
  const files = await Promise.all(
    ["manifest.json", "layout.html", "style.css"].map(async (path) => {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/contents/sites/${siteId}/${path}?ref=${revision}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "WorldStudio/0.07",
            "X-GitHub-Api-Version": "2026-03-10",
          },
        },
      );
      if (response.status === 404) return null;
      if (!response.ok)
        throw new DomainError(
          "GITHUB_REQUEST_FAILED",
          `GitHub 未完成部署內容查核（HTTP ${response.status}）。既有網站仍保留。`,
          502,
        );
      const result = (await response.json()) as { content: string };
      return decode(result.content);
    }),
  );
  if (files.some((f) => f === null)) return false;
  const manifest = JSON.parse(files[0]!);
  return (
    manifest.siteId === siteId &&
    manifest.codeHash === codeHash &&
    (await sha256(JSON.stringify({ html: files[1], css: files[2] }))) ===
      codeHash
  );
}
