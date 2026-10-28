import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import type {
  ConversationHookContext,
  ConversationHookResult,
} from "./conversation";
import { getConversation, appendEvent } from "./conversation";
import {
  conversationRow,
  activeTask,
  guardedBatch,
  auditStatement,
  eventStatement,
  type TaskRow,
} from "./conversation-store";
import { modelResult } from "./conversation-agents";
import { newId, now, sha256, DomainError } from "./domain";
import {
  validateSiteCode,
  renderSiteHtml,
  type SiteCode,
  type SiteContent,
} from "./conversation-site-code";
import {
  buildSiteContents,
  assertPublicCopy,
} from "./conversation-site-content";
import {
  createGitHubCandidate,
  mergeGitHubCandidate,
  retryGitHubDeployment,
  verifyDeployedSite,
  githubConfigured,
  verifyGitHubSignature,
} from "./conversation-github";
import { activateStudioPublication } from "./conversation-release";
import { authenticated } from "./auth";
import type { StudioLocale } from "../shared/conversation";
export type StudioSiteRow = {
  id: string;
  conversation_id: string;
  base_revision: number;
  code_hash: string;
  code_key: string;
  content_key: string;
  stage: string;
  branch: string | null;
  pr_number: number | null;
  commit_sha: string | null;
  main_sha: string | null;
  proposal_id: string | null;
  preview_ready: number;
  production_ready: number;
  owner_event_id: number | null;
  cancel_epoch: number;
  created_at: string;
  updated_at: string;
};
export type PublicationRow = {
  id: string;
  conversation_id: string;
  site_id: string;
  slug: string;
  content_key: string;
  content_hash: string;
  site_commit: string;
  locales_json: string;
  status: string;
  created_at: string;
};
const siteSchema = z.object({
  html: z.string().min(20).max(120000),
  css: z.string().min(20).max(80000),
});
const designBriefSchema = z.object({
  palette: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .min(3)
    .max(6),
  typography: z.enum(["serif", "sans-serif", "monospace", "mixed"]),
  contrast: z.enum(["light", "dark", "mixed"]),
  density: z.enum(["spacious", "balanced", "dense"]),
  atmosphere: z
    .array(
      z.enum([
        "calm",
        "dramatic",
        "warm",
        "cold",
        "playful",
        "solemn",
        "intimate",
        "expansive",
        "raw",
        "refined",
      ]),
    )
    .min(1)
    .max(3),
  imageTreatment: z.enum([
    "full-bleed",
    "framed",
    "asymmetric",
    "contact-sheet",
    "mixed",
  ]),
});
const prompt = `You design a distinctive standalone responsive website layout for a fictional world. Return JSON html and css. This is frontend source committed to a PUBLIC repository: NEVER embed world names, story content, private instructions, character names or provided editorial copy. Use only dynamic data slots. Create your own layout, navigation, visual hierarchy and CSS; do not choose a fixed prebuilt template. No script, SVG, iframe, form, inline style, event handler, external request, url(), @import, quoted CSS strings, CSS content property or CSS escape. CSS must use ASCII only; font families use unquoted generic font stacks. HTML is a fragment using main/header/footer/nav/section/article/div/span/p/h1/h2/h3/a/img/figure/figcaption/ul/li/strong/em/small/details/summary. Attributes: class,id,data-slot,data-repeat,href (#local-id only),alt(empty),aria-label(generic),role,loading,width,height. All visible literal text must be empty or one of: Explore,Journal,World,Discover,Field Notes,Gallery,About,Read more,EN,繁中,日本語,Menu,Close,Next,Previous,Back,Home. Put title in data-slot="title", summary in data-slot="summary", image as <img data-slot="hero" alt=""> and caption in data-slot="caption". Content collection uses data-repeat="entries" with entry.title/entry.body/entry.caption slots plus <img data-slot="entry.image" alt="">; or data-slot="entries" for automatic entries; elements similarly use data-repeat="elements" and element.name/element.definition. Include title, summary and entries. Use CSS to give this world an original art direction, good mobile layout, readable contrast, and restrained interaction through local navigation. Never include markdown fences.`;
async function taskFor(env: Env, id: string) {
  const t = await env.DB.prepare("SELECT * FROM studio_tasks WHERE id=?")
    .bind(id)
    .first<TaskRow>();
  if (!t || !(await activeTask(env, t)))
    throw new DomainError("TASK_CANCELLED", "這項工作已停止。");
  return t;
}
export async function getStudioSite(env: Env, id: string) {
  const r = await env.DB.prepare("SELECT * FROM studio_sites WHERE id=?")
    .bind(id)
    .first<StudioSiteRow>();
  if (!r) throw new DomainError("SITE_NOT_FOUND", "找不到這份網站候選。", 404);
  return r;
}
export async function loadSiteCode(
  env: Env,
  row: StudioSiteRow,
): Promise<SiteCode> {
  const obj = await env.STORAGE.get(row.code_key);
  if (!obj) throw new DomainError("SITE_ARTIFACT_MISSING");
  const code = validateSiteCode(JSON.parse(await obj.text()));
  if ((await sha256(JSON.stringify(code))) !== row.code_hash)
    throw new DomainError("SITE_ARTIFACT_CHANGED");
  return code;
}
export async function loadSiteContents(
  env: Env,
  key: string,
): Promise<Partial<Record<StudioLocale, SiteContent>>> {
  const obj = await env.STORAGE.get(key);
  if (!obj) throw new DomainError("SITE_CONTENT_MISSING");
  const data = JSON.parse(await obj.text());
  assertPublicCopy(data);
  return data;
}
export async function createConversationSite(
  env: Env,
  ctx: ConversationHookContext,
): Promise<ConversationHookResult> {
  const task = await taskFor(env, ctx.taskId),
    c = await conversationRow(env, ctx.conversationId),
    siteId = "site_" + ctx.taskId.replace(/^ctask_/, ""),
    existing = await env.DB.prepare("SELECT * FROM studio_sites WHERE id=?")
      .bind(siteId)
      .first<StudioSiteRow>();
  let row = existing;
  if (!row) {
    const contents = buildSiteContents(
      ctx.document,
      `/api/studio/assets/${ctx.document.visual?.selectedAssetId}`,
    );
    assertPublicCopy(contents);
    const brief = await modelResult(
      env,
      task,
      "site-design-brief",
      {
        visual: ctx.document.direction?.visual,
        audience: ctx.document.direction?.audience,
      },
      designBriefSchema,
      [],
      "Translate the approved artistic direction into abstract design properties only. Return JSON matching the schema. Never include story terms, names, text, private decisions or additional fields. This is an internal visual design brief, not public copy.",
    );
    const code = validateSiteCode(
      await modelResult(
        env,
        task,
        "site",
        {
          design: brief,
          hasElements: !!ctx.document.world?.elements.length,
          attempt: task.attempts,
        },
        siteSchema,
        [],
        prompt,
        validateSiteCode,
      ),
    );
    const codeHash = await sha256(JSON.stringify(code)),
      codeKey = `studio/${c.id}/sites/${siteId}/code.json`,
      contentKey = `studio/${c.id}/sites/${siteId}/preview.json`;
    await env.STORAGE.put(codeKey, JSON.stringify(code));
    await env.STORAGE.put(contentKey, JSON.stringify(contents));
    await guardedBatch(env, task, [
      env.DB.prepare(
        "INSERT INTO studio_sites(id,conversation_id,base_revision,code_hash,code_key,content_key,stage,cancel_epoch,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        siteId,
        c.id,
        c.revision,
        codeHash,
        codeKey,
        contentKey,
        "draft",
        c.cancel_epoch,
        now(),
        now(),
      ),
      auditStatement(env, c.id, "site.designed", { siteId, codeHash }),
    ]);
    row = await getStudioSite(env, siteId);
  }
  if (githubConfigured(env) && !row.commit_sha) {
    const code = await loadSiteCode(env, row),
      gh = await createGitHubCandidate(env, siteId, code, row.code_hash);
    await guardedBatch(env, task, [
      env.DB.prepare(
        "UPDATE studio_sites SET branch=?,pr_number=?,commit_sha=?,stage='checking',updated_at=? WHERE id=?",
      ).bind(gh.branch, gh.prNumber, gh.commitSha, now(), siteId),
      auditStatement(env, c.id, "site.github_candidate", {
        siteId,
        commit: gh.commitSha,
        pr: gh.prNumber,
      }),
    ]);
    row = await getStudioSite(env, siteId);
  }
  const previewUrl = `/studio-preview/${siteId}/en`;
  return {
    content: githubConfigured(env)
      ? "網站版型已完成，預覽驗證會在背景進行。你可以先查看設計並直接告訴我要調整的地方。"
      : "網站版型已完成並保存，你可以先查看私人預覽。正式發布還需要連接此專案的 GitHub App；完成連接後可繼續，不必重新讀取原作。",
    eventType: "preview",
    data: { siteId, previewUrl, githubReady: githubConfigured(env) },
    proposal: {
      kind: "site",
      content: {
        siteId,
        previewUrl,
        codeHash: row.code_hash,
        reply:
          "這是這個世界的獨立網站設計。你可以要求調整，或說「採用這份網站設計」。採用設計不會自動公開，也不會啟動自主更新。",
      },
    },
  };
}
export async function recoverSiteReleases(env: Env) {
  await env.DB.prepare(
    "UPDATE studio_sites SET stage='abandoned',updated_at=? WHERE stage IN ('merging','deploying') AND EXISTS(SELECT 1 FROM studio_conversations c WHERE c.id=studio_sites.conversation_id AND (c.cancel_epoch!=studio_sites.cancel_epoch OR json_extract(c.document_json,'$.site.siteId') IS NOT studio_sites.id))",
  )
    .bind(now())
    .run();
}
export async function publishConversationSite(
  env: Env,
  ctx: ConversationHookContext,
): Promise<ConversationHookResult> {
  if (
    !ctx.proposal ||
    ctx.proposal.kind !== "site" ||
    !ctx.approval ||
    ctx.approval.proposal_hash !== ctx.proposal.hash
  )
    throw new DomainError("EXACT_APPROVAL_REQUIRED");
  if (env.ENVIRONMENT !== "production")
    throw new DomainError(
      "PREVIEW_WORKSPACE",
      "這個工作區提供私人預覽。正式發布請在正式 Studio 執行，既有內容仍保留。",
      422,
    );
  const task = await taskFor(env, ctx.taskId),
    row = await getStudioSite(env, String(ctx.proposal.content.siteId));
  if (row.conversation_id !== ctx.conversationId)
    throw new DomainError("SITE_NOT_OWNED");
  const current = await getConversation(env, ctx.conversationId),
    saved = await loadSiteContents(env, row.content_key),
    expected = buildSiteContents(
      current.document,
      `/api/studio/assets/${current.document.visual?.selectedAssetId}`,
    );
  if (
    (await sha256(JSON.stringify(saved))) !==
    (await sha256(JSON.stringify(expected)))
  )
    throw new DomainError(
      "SITE_PREVIEW_STALE",
      "設定或內容已更新，需要先看看更新後的網站預覽。",
    );
  if (row.stage === "published")
    return {
      content: "這份網站已經公開，自主更新仍依你另外確認的設定執行。",
      data: { siteId: row.id },
    };
  if (!row.commit_sha) {
    const code = await loadSiteCode(env, row),
      gh = await createGitHubCandidate(env, row.id, code, row.code_hash);
    await guardedBatch(env, task, [
      env.DB.prepare(
        "UPDATE studio_sites SET branch=?,pr_number=?,commit_sha=?,proposal_id=?,stage='checking',updated_at=? WHERE id=?",
      ).bind(
        gh.branch,
        gh.prNumber,
        gh.commitSha,
        ctx.proposal.id,
        now(),
        row.id,
      ),
    ]);
    return {
      content:
        "網站候選已送到 GitHub 進行驗證，尚未公開。驗證完成後我會通知你，屆時可直接說「發布網站」。",
      data: { siteId: row.id },
    };
  }
  if (!row.preview_ready)
    throw new DomainError(
      "SITE_CHECKS_PENDING",
      "網站仍在完成預覽驗證，尚未公開；完成後會在這裡通知你。",
    );
  if (row.main_sha && ["deploying", "failed"].includes(row.stage)) {
    if (
      await verifyDeployedSite(env, row.id, row.code_hash, env.BUILD_REVISION)
    ) {
      await guardedBatch(env, task, [
        env.DB.prepare(
          "UPDATE studio_sites SET production_ready=1,main_sha=?,owner_event_id=?,updated_at=? WHERE id=?",
        ).bind(env.BUILD_REVISION, ctx.ownerEventId, now(), row.id),
      ]);
      const published = await activateStudioPublication(
        env,
        await getStudioSite(env, row.id),
        saved,
      );
      return {
        content: "網站已通過公開驗證。自主更新仍保持停用。",
        data: { siteId: row.id, releaseId: published.id },
      };
    }
    const recovery = await retryGitHubDeployment(env);
    await guardedBatch(env, task, [
      env.DB.prepare(
        "UPDATE studio_sites SET stage='deploying',main_sha=?,owner_event_id=?,updated_at=? WHERE id=?",
      ).bind(recovery.commitSha, ctx.ownerEventId, now(), row.id),
      auditStatement(env, ctx.conversationId, "site.deployment_recovery", {
        siteId: row.id,
        ...recovery,
      }),
    ]);
    return {
      content: recovery.retried
        ? "已從失敗的部署工作接續處理，設計與內容不需重做。完成驗證後會在這裡提供網址。"
        : "部署仍在進行，完成公開驗證後會在這裡提供網址。",
      data: { siteId: row.id },
    };
  }
  await recoverSiteReleases(env);
  const activeRelease = await env.DB.prepare(
    "SELECT id FROM studio_sites WHERE stage IN ('merging','deploying') AND id!=?",
  )
    .bind(row.id)
    .first();
  if (activeRelease)
    throw new DomainError(
      "SITE_RELEASE_BUSY",
      "另一個網站正在完成發布驗證。完成後可繼續發布這份設計。",
      409,
    );
  await guardedBatch(env, task, [
    env.DB.prepare(
      "UPDATE studio_sites SET stage='merging',owner_event_id=?,proposal_id=?,updated_at=? WHERE id=?",
    ).bind(ctx.ownerEventId, ctx.proposal.id, now(), row.id),
  ]);
  let mainSha: string;
  try {
    mainSha = await mergeGitHubCandidate(env, row.pr_number!, row.commit_sha);
  } catch (error) {
    if (
      !(error instanceof DomainError) ||
      error.code !== "SITE_REBASE_REQUIRED"
    ) {
      await env.DB.prepare(
        "UPDATE studio_sites SET stage='preview_ready',updated_at=? WHERE id=? AND stage='merging'",
      )
        .bind(now(), row.id)
        .run();
      throw error;
    }
    const candidate = await createGitHubCandidate(
      env,
      row.id,
      await loadSiteCode(env, row),
      row.code_hash,
      true,
    );
    await guardedBatch(env, task, [
      env.DB.prepare(
        "UPDATE studio_sites SET commit_sha=?,preview_ready=0,stage='checking',updated_at=? WHERE id=?",
      ).bind(candidate.commitSha, now(), row.id),
      auditStatement(env, ctx.conversationId, "site.revalidated", {
        siteId: row.id,
        commit: candidate.commitSha,
      }),
    ]);
    return {
      content:
        "網站設計已保留。主程式有更新，正在重新驗證相容性；完成後會通知你，再說「發布網站」即可。",
      data: { siteId: row.id },
    };
  }
  await guardedBatch(env, task, [
    env.DB.prepare(
      "UPDATE studio_sites SET main_sha=?,proposal_id=?,owner_event_id=?,stage='deploying',cancel_epoch=(SELECT cancel_epoch FROM studio_conversations WHERE id=?),updated_at=? WHERE id=?",
    ).bind(
      mainSha,
      ctx.proposal.id,
      ctx.ownerEventId,
      ctx.conversationId,
      now(),
      row.id,
    ),
    auditStatement(env, ctx.conversationId, "site.release_requested", {
      siteId: row.id,
      sha: mainSha,
      ownerEventId: ctx.ownerEventId,
    }),
  ]);
  return {
    content:
      "已確認發布這份網站。GitHub 正在觸發正式部署；完成公開讀回驗證後，我會在這裡提供正式網址。自主更新保持停用。",
    data: { siteId: row.id, deploying: true },
  };
}
const routes = new Hono<{ Bindings: Env }>();
routes.get("/api/studio/integrations/github", (c) =>
  c.json({
    configured: githubConfigured(c.env),
    repository: "mkhsu2002/Agentic-Life-World-Studio",
    setupCommand: "python3 scripts/configure-github-app.py",
  }),
);
routes.post("/api/studio/conversations/:id/files", async (c) => {
  const id = c.req.param("id");
  await conversationRow(c.env, id);
  const data = await c.req.formData(),
    file = data.get("file");
  if (!(file instanceof File) || file.size > 25 * 1024 * 1024)
    throw new DomainError("FILE_INVALID", "請提供 25 MB 以內的原作檔案。", 422);
  if (file.type.startsWith("image/") && file.size > 5 * 1024 * 1024)
    throw new DomainError("SOURCE_IMAGE_LIMIT", "單張圖片最多 5 MB。", 422);
  const key = `studio/${id}/uploads/${newId("file")}`;
  await c.env.STORAGE.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: {
      conversationId: id,
      name: file.name.slice(0, 200),
      contentType: file.type,
    },
  });
  return c.json({ originalKey: key }, 201);
});
routes.get("/studio-preview/:site/:locale", async (c) => {
  if (!(await authenticated(c))) return c.text("請先登入 Studio。", 401);
  const locale = z.enum(["en", "zh-Hant", "ja"]).parse(c.req.param("locale")),
    row = await getStudioSite(c.env, c.req.param("site")),
    contents = await loadSiteContents(c.env, row.content_key);
  if (!contents[locale]) return c.text("此語系尚未完成。", 404);
  c.header("Cache-Control", "private, no-store");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  );
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.html(
    renderSiteHtml(await loadSiteCode(c.env, row), {
      ...contents[locale]!,
      languages: Object.keys(contents).map((l) => ({
        locale: l as StudioLocale,
        url: `/studio-preview/${row.id}/${l}`,
      })),
    }),
  );
});
routes.get("/api/public/studio/:locale/:slug", async (c) => {
  const locale = z.enum(["en", "zh-Hant", "ja"]).parse(c.req.param("locale"));
  const p = await c.env.DB.prepare(
    "SELECT * FROM studio_publications WHERE slug=? AND status='active'",
  )
    .bind(c.req.param("slug"))
    .first<PublicationRow>();
  if (!p)
    return c.json(
      { error: { code: "NOT_FOUND", message: "This world is not available." } },
      404,
    );
  const data = await loadSiteContents(c.env, p.content_key);
  if (!data[locale])
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "This language is not available.",
        },
      },
      404,
    );
  return c.json({ releaseId: p.id, ...data[locale] });
});
routes.get("/api/public/studio/artwork/:release/:asset", async (c) => {
  const p = await c.env.DB.prepare(
    "SELECT * FROM studio_publications WHERE id=? AND status IN ('verifying','active')",
  )
    .bind(c.req.param("release"))
    .first<PublicationRow>();
  if (!p) return c.notFound();
  const contents = await loadSiteContents(c.env, p.content_key),
    path = `/api/public/studio/artwork/${p.id}/${c.req.param("asset")}`;
  if (
    !Object.values(contents).some(
      (d) =>
        d.imageUrl === path ||
        d.entries.some((entry) => entry.imageUrl === path),
    )
  )
    return c.notFound();
  const a = await c.env.DB.prepare(
    "SELECT * FROM studio_assets WHERE id=? AND conversation_id=? AND kind='image'",
  )
    .bind(c.req.param("asset"), p.conversation_id)
    .first<{ storage_key: string; content_type: string }>();
  const object = a ? await c.env.STORAGE.get(a.storage_key) : null;
  if (!a || !object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type": a.content_type,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
export const conversationSiteRoutes = routes;
export async function publicConversationPage(
  env: Env,
  slug: string,
  locale: StudioLocale,
): Promise<Response | null> {
  const p = await env.DB.prepare(
    "SELECT * FROM studio_publications WHERE slug=? AND status='active'",
  )
    .bind(slug)
    .first<PublicationRow>();
  if (!p) return null;
  const row = await getStudioSite(env, p.site_id),
    contents = await loadSiteContents(env, p.content_key);
  if (!contents[locale])
    return new Response("This language is not available.", { status: 404 });
  return new Response(
    renderSiteHtml(await loadSiteCode(env, row), contents[locale]!),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "Cache-Control": "public, max-age=60",
      },
    },
  );
}
