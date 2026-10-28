import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const result = await build({
  entryPoints: ["src/server/conversation-site-code.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { validateSiteCode } = await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].text).toString("base64")
);
const base =
  process.env.SITE_DIFF_BASE ||
  (process.env.GITHUB_EVENT_NAME === "pull_request"
    ? "origin/main"
    : process.env.GITHUB_EVENT_BEFORE);
const diff =
  base && !/^0+$/.test(base)
    ? execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean)
    : [];
const generated = (process.env.GITHUB_REF || "").startsWith(
  "refs/heads/world/",
);
if (generated) {
  if (!base) throw new Error("Generated site requires a comparison base");
  const allowed =
    /^(?:sites\/site_[A-Za-z0-9_-]+\/(?:layout\.html|style\.css|manifest\.json)|VERSION|package(?:-lock)?\.json|src\/shared\/version\.ts)$/;
  if (diff.some((p) => !allowed.test(p)))
    throw new Error(
      "Generated site changed files outside its isolated layout/version scope",
    );
  for (const path of ["package.json", "package-lock.json"]) {
    const before = JSON.parse(
        execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8" }),
      ),
      after = JSON.parse(readFileSync(path, "utf8"));
    for (const doc of [before, after]) {
      delete doc.version;
      if (doc.packages?.[""]) delete doc.packages[""].version;
    }
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("Generated site cannot change dependencies or scripts");
  }
  const version = readFileSync("VERSION", "utf8").trim();
  if (
    !/^0\.\d{2,}$/.test(version) ||
    readFileSync("src/shared/version.ts", "utf8") !==
      `export const PRODUCT_VERSION = "${version}";\nexport const PRODUCT_LABEL = \`v\${PRODUCT_VERSION}\`;\n`
  )
    throw new Error("Generated version source is invalid");
  const old = execFileSync("git", ["show", `${base}:VERSION`], {
    encoding: "utf8",
  }).trim();
  if (Number(version.slice(2)) !== Number(old.slice(2)) + 1)
    throw new Error("Code version must increment by 0.01");
}
const ids = [
  ...new Set(
    diff
      .map((p) => p.match(/^sites\/(site_[A-Za-z0-9_-]+)\//)?.[1])
      .filter(Boolean),
  ),
];
const siteIds = generated
  ? ids
  : existsSync("sites")
    ? readdirSync("sites").filter((id) => /^site_[A-Za-z0-9_-]+$/.test(id))
    : [];
const sites = siteIds.map((siteId) => {
  const root = `sites/${siteId}`;
  for (const file of ["layout.html", "style.css", "manifest.json"])
    if (!existsSync(`${root}/${file}`))
      throw new Error("Incomplete site artifact");
  const code = validateSiteCode({
      html: readFileSync(`${root}/layout.html`, "utf8"),
      css: readFileSync(`${root}/style.css`, "utf8"),
    }),
    manifest = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
  const codeHash = createHash("sha256")
    .update(JSON.stringify(code))
    .digest("hex");
  if (
    manifest.siteId !== siteId ||
    manifest.codeHash !== codeHash ||
    manifest.contract !== "world-site/0.07"
  )
    throw new Error("Site manifest does not match the validated source");
  return { siteId, codeHash };
});
if (generated && sites.length !== 1)
  throw new Error("Each generated candidate must contain one isolated site");
mkdirSync("deploy-metadata", { recursive: true });
writeFileSync("deploy-metadata/sites.json", JSON.stringify(sites));
console.log(JSON.stringify({ validated: true, isolatedSites: sites.length }));
