import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { receiveSiteDeployment } from "./conversation-release";
import {
  getStudioSite,
  loadSiteCode,
  loadSiteContents,
  type PublicationRow,
} from "./conversation-site";
import { renderSiteHtml } from "./conversation-site-code";
import { DomainError, sha256 } from "./domain";
const routes = new Hono<{ Bindings: Env }>();
routes.post("/api/studio/deployments", async (c) => {
  const supplied = c.req.header("Authorization")?.replace(/^Bearer /, "") || "";
  if (
    !c.env.STUDIO_DEPLOY_TOKEN ||
    (await sha256(supplied)) !== (await sha256(c.env.STUDIO_DEPLOY_TOKEN))
  )
    throw new DomainError(
      "DEPLOY_AUTH_REQUIRED",
      "Deployment authentication required.",
      401,
    );
  const input = z
    .object({
      siteId: z.string(),
      codeHash: z.string().length(64),
      commitSha: z.string().regex(/^[a-f0-9]{40}$/),
      engineRevision: z.string(),
      environment: z.enum(["dev", "production"]),
      deliveryId: z.string().min(1).max(200),
      outcome: z.enum(["success", "failure"]).optional(),
    })
    .parse(await c.req.json());
  return c.json(await receiveSiteDeployment(c.env, input));
});
routes.get("/api/public/studio/readback/release/:id", async (c) => {
  const p = await c.env.DB.prepare(
    "SELECT * FROM studio_publications WHERE id=? AND status IN ('verifying','active')",
  )
    .bind(c.req.param("id"))
    .first<PublicationRow>();
  if (!p) return c.notFound();
  return c.json({
    releaseId: p.id,
    hash: p.content_hash,
    content: await loadSiteContents(c.env, p.content_key),
  });
});
routes.get("/api/public/studio/render/release/:id", async (c) => {
  const p = await c.env.DB.prepare(
    "SELECT * FROM studio_publications WHERE id=? AND status IN ('verifying','active')",
  )
    .bind(c.req.param("id"))
    .first<PublicationRow>();
  if (!p) return c.notFound();
  const site = await getStudioSite(c.env, p.site_id),
    contents = await loadSiteContents(c.env, p.content_key);
  const locale = z
    .enum(["en", "zh-Hant", "ja"])
    .parse(c.req.query("locale") || "en");
  if (!contents[locale]) return c.notFound();
  return c.html(
    renderSiteHtml(await loadSiteCode(c.env, site), contents[locale]!),
  );
});
export const conversationDeploymentRoutes = routes;
