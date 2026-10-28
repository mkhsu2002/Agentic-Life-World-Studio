import { readFileSync } from "node:fs";
const sites = JSON.parse(
  readFileSync(process.argv[2] || "deploy-metadata/sites.json", "utf8"),
);
const targets = process.env.SITE_DEPLOY_TARGETS?.split(",") || [
  "dev",
  "production",
];
if (sites.length && !process.env.STUDIO_DEPLOY_TOKEN)
  throw new Error("Deployment callback secret is not configured");
for (const environment of targets) {
  const origin = `https://agentic-world-studio-${environment}.mkhsu2002.workers.dev`;
  const healthResponse = await fetch(origin + "/api/health", {
      cache: "no-store",
    }),
    health = await healthResponse.json();
  if (
    !healthResponse.ok ||
    health.status !== "ok" ||
    health.environment !== environment
  )
    throw new Error("Backend schema/version verification failed");
  for (const site of sites) {
    let done = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(origin + "/api/studio/deployments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.STUDIO_DEPLOY_TOKEN}`,
        },
        body: JSON.stringify({
          ...site,
          commitSha: process.env.GITHUB_SHA,
          engineRevision: health.revision,
          outcome: process.env.SITE_DEPLOY_OUTCOME || "success",
          environment,
          deliveryId: `${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT || "1"}:${process.env.SITE_DEPLOY_OUTCOME || "success"}:${environment}:${site.siteId}`,
        }),
      });
      // A world belongs to one environment. Its counterpart must remain untouched.
      if (response.status === 404) {
        done = true;
        break;
      }
      if (response.ok) {
        done = true;
        console.log(
          JSON.stringify({ siteId: site.siteId, environment, accepted: true }),
        );
        break;
      }
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (!done)
      throw new Error(
        `Site deployment acknowledgement failed: ${environment}/${site.siteId}`,
      );
  }
}
