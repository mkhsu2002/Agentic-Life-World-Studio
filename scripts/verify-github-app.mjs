// Credentials arrive only over stdin; output contains no access-bearing values.
import { importPKCS8, SignJWT } from "jose";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { appId, key, installationId } = JSON.parse(input);
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "RS256" })
  .setIssuer(String(appId))
  .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
  .setExpirationTime("5m")
  .sign(await importPKCS8(key, "RS256"));
const headers = {
  Authorization: `Bearer ${jwt}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "WorldStudio-Setup",
  "X-GitHub-Api-Version": "2026-03-10",
};
const installation = await fetch(
  `https://api.github.com/app/installations/${installationId}`,
  { headers },
);
if (!installation.ok)
  throw new Error(`GitHub installation HTTP ${installation.status}`);
const installed = await installation.json();
if (
  installed.account?.login !== "mkhsu2002" ||
  installed.repository_selection !== "selected"
)
  throw new Error(
    "App must be installed for selected repositories under mkhsu2002.",
  );
const response = await fetch(
  `https://api.github.com/app/installations/${installationId}/access_tokens`,
  {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      permissions: {
        contents: "write",
        pull_requests: "write",
        actions: "write",
        checks: "read",
      },
    }),
  },
);
if (!response.ok) throw new Error(`GitHub token HTTP ${response.status}`);
const granted = await response.json();
const repos = await fetch("https://api.github.com/installation/repositories", {
  headers: { ...headers, Authorization: `Bearer ${granted.token}` },
});
if (!repos.ok)
  throw new Error(`GitHub repository verification HTTP ${repos.status}`);
const list = await repos.json();
if (
  list.total_count !== 1 ||
  list.repositories?.[0]?.full_name !== "mkhsu2002/Agentic-Life-World-Studio"
)
  throw new Error("App must have access to this repository only.");
console.log(
  JSON.stringify({
    verified: true,
    repository: list.repositories[0].full_name,
  }),
);
