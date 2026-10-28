import type { Env } from "./env";
import { approvalCommand } from "./conversation";
import type { StudioLocale } from "../shared/conversation";
import {
  getStudioSite,
  loadSiteCode,
  loadSiteContents,
  type StudioSiteRow,
  type PublicationRow,
} from "./conversation-site";
import { renderSiteHtml, type SiteContent } from "./conversation-site-code";
import {
  assertPublicCopy,
  buildSiteContents,
} from "./conversation-site-content";
import {
  conversationRow,
  eventStatement,
  auditStatement,
} from "./conversation-store";
import { newId, now, sha256, DomainError } from "./domain";
export const studioOrigin = (env: Env) =>
  env.STUDIO_PUBLIC_ORIGIN ||
  `https://agentic-world-studio-${env.ENVIRONMENT === "production" ? "production" : "dev"}.mkhsu2002.workers.dev`;
export async function activateStudioPublication(
  env: Env,
  row: StudioSiteRow,
  contents: Partial<Record<StudioLocale, SiteContent>>,
  options: { operationRunId?: string; fetcher?: typeof fetch } = {},
): Promise<PublicationRow> {
  const c = await conversationRow(env, row.conversation_id);
  if (row.cancel_epoch !== c.cancel_epoch)
    throw new DomainError("TASK_CANCELLED", "發布已停止。");
  if (!row.production_ready || !row.main_sha)
    throw new DomainError("SITE_NOT_DEPLOYED", "網站程式尚未完成正式部署。");
  const document = JSON.parse(c.document_json);
  if (options.operationRunId) {
    const run = await env.DB.prepare(
      "SELECT policy_hash FROM studio_operation_runs WHERE id=? AND conversation_id=? AND status='running'",
    )
      .bind(options.operationRunId, c.id)
      .first<{ policy_hash: string }>();
    if (
      !run ||
      !document.operation?.enabled ||
      document.operation.approvalHash !== run.policy_hash
    )
      throw new DomainError("OPERATION_STALE");
  } else {
    const frozen = await loadSiteContents(env, row.content_key);
    const current = buildSiteContents(
      document,
      `/api/studio/assets/${document.visual?.selectedAssetId}`,
    );
    if (
      document.site?.siteId !== row.id ||
      (await sha256(JSON.stringify(frozen))) !==
        (await sha256(JSON.stringify(current)))
    )
      throw new DomainError(
        "SITE_PREVIEW_STALE",
        "設定或內容已更新，需要先確認更新後的網站預覽。",
      );
    if (!row.proposal_id || !row.owner_event_id)
      throw new DomainError("EXACT_APPROVAL_REQUIRED");
    const approval = await env.DB.prepare(
      "SELECT p.content_hash,p.content_json,a.proposal_hash,e.content AS command FROM studio_approvals a JOIN studio_proposals p ON p.id=a.proposal_id JOIN studio_events e ON e.id=? AND e.conversation_id=a.conversation_id AND e.type='user' WHERE a.conversation_id=? AND a.proposal_id=? AND p.conversation_id=a.conversation_id AND p.kind='site' AND p.status='approved' AND a.proposal_hash=p.content_hash",
    )
      .bind(row.owner_event_id, c.id, row.proposal_id)
      .first<{
        content_hash: string;
        content_json: string;
        proposal_hash: string;
        command: string;
      }>();
    if (
      !approval ||
      !approvalCommand(approval.command) ||
      !/^(?:(?:請|我)?(?:發布|發佈|公開)|publish)/i.test(
        approval.command.trim(),
      )
    )
      throw new DomainError("EXACT_APPROVAL_REQUIRED");
    const proposal = JSON.parse(approval.content_json);
    if (
      proposal.siteId !== row.id ||
      proposal.codeHash !== row.code_hash ||
      (await sha256(JSON.stringify(proposal))) !== approval.content_hash
    )
      throw new DomainError("EXACT_APPROVAL_REQUIRED");
  }
  const id = options.operationRunId
      ? "release_" + options.operationRunId
      : "release_" + row.id,
    slug = "world-" + c.id.slice(-12),
    key = `studio/${c.id}/publications/${id}.json`;
  const existing = await env.DB.prepare(
    "SELECT * FROM studio_publications WHERE id=?",
  )
    .bind(id)
    .first<PublicationRow>();
  if (existing?.status === "active") return existing;
  const publicContents = structuredClone(contents);
  const assets = new Set<string>();
  const rewriteAsset = async (url: string | null | undefined) => {
    if (!url) return null;
    const id = url.match(
      /^\/api\/(?:studio\/assets\/|public\/studio\/artwork\/[^/]+\/)([A-Za-z0-9_-]+)$/,
    )?.[1];
    if (!id) throw new DomainError("PUBLIC_IMAGE_REQUIRED");
    if (!assets.has(id)) {
      const asset = await env.DB.prepare(
        "SELECT storage_key FROM studio_assets WHERE id=? AND conversation_id=? AND kind='image'",
      )
        .bind(id, c.id)
        .first<{ storage_key: string }>();
      if (!asset || !(await env.STORAGE.head(asset.storage_key)))
        throw new DomainError("PUBLIC_IMAGE_MISSING");
      assets.add(id);
    }
    return `/api/public/studio/artwork/${idRelease}/${id}`;
  };
  const idRelease = id;
  for (const content of Object.values(publicContents)) {
    content.imageUrl = await rewriteAsset(content.imageUrl);
    for (const entry of content.entries)
      entry.imageUrl = await rewriteAsset(entry.imageUrl);
    content.languages = Object.keys(publicContents).map((locale) => ({
      locale: locale as StudioLocale,
      url: `/${locale}/worlds/${slug}`,
    }));
  }
  if (!assets.size) throw new DomainError("PUBLIC_IMAGE_REQUIRED");
  assertPublicCopy(publicContents);
  await loadSiteCode(env, row);
  const json = JSON.stringify(publicContents),
    hash = await sha256(json),
    stamp = now();
  await env.STORAGE.put(key, json);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO studio_publications(id,conversation_id,site_id,slug,content_key,content_hash,site_commit,locales_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='verifying' WHERE status!='active'",
    ).bind(
      id,
      c.id,
      row.id,
      slug,
      key,
      hash,
      row.main_sha,
      JSON.stringify(Object.keys(publicContents)),
      "verifying",
      stamp,
    ),
    auditStatement(env, c.id, "release.verifying", {
      releaseId: id,
      siteId: row.id,
      siteCommit: row.main_sha,
      hash,
    }),
  ]);
  try {
    const fetcher = options.fetcher || fetch,
      origin = studioOrigin(env),
      res = await fetcher(
        `${origin}/api/public/studio/readback/release/${id}`,
        { cache: "no-store" },
      );
    const probe = (await res.json()) as { hash: string; content: unknown };
    if (
      !res.ok ||
      probe.hash !== hash ||
      (await sha256(JSON.stringify(probe.content))) !== hash
    )
      throw new DomainError("PUBLIC_READBACK_FAILED");
    for (const assetId of assets) {
      const image = await fetcher(
        `${origin}/api/public/studio/artwork/${id}/${assetId}`,
        { cache: "no-store" },
      );
      if (!image.ok || !image.headers.get("Content-Type")?.startsWith("image/"))
        throw new DomainError("PUBLIC_IMAGE_READBACK_FAILED");
    }
    for (const locale of Object.keys(publicContents)) {
      const html = await fetcher(
        `${origin}/api/public/studio/render/release/${id}?locale=${locale}`,
        { cache: "no-store" },
      );
      const rendered = await html.text();
      if (
        !html.ok ||
        !rendered.includes("<!doctype html>") ||
        !rendered.includes(`lang="${locale}"`)
      )
        throw new DomainError("PUBLIC_RENDER_READBACK_FAILED");
    }
    const guard = newId("releaseguard");
    const statements = [
      env.DB.prepare(
        "INSERT INTO studio_guards(id,passed) SELECT ?,CASE WHEN cancel_epoch=? AND revision=? AND document_json=? AND (? IS NULL OR (json_extract(document_json,'$.operation.enabled')=1 AND json_extract(document_json,'$.operation.approvalHash')=?)) AND NOT EXISTS(SELECT 1 FROM studio_publications WHERE id=? AND status='active') THEN 1 ELSE 0 END FROM studio_conversations WHERE id=?",
      ).bind(
        guard,
        c.cancel_epoch,
        c.revision,
        c.document_json,
        options.operationRunId || null,
        document.operation?.approvalHash || null,
        id,
        c.id,
      ),
      env.DB.prepare(
        "UPDATE studio_publications SET status='superseded' WHERE conversation_id=? AND status='active' AND id!=?",
      ).bind(c.id, id),
      env.DB.prepare(
        "UPDATE studio_publications SET status='active' WHERE id=? AND status='verifying'",
      ).bind(id),
      env.DB.prepare(
        "UPDATE studio_sites SET stage='published',updated_at=? WHERE id=?",
      ).bind(now(), row.id),
      env.DB.prepare(
        "UPDATE studio_conversations SET document_json=json_set(document_json,'$.publication',json(?)),updated_at=? WHERE id=?",
      ).bind(
        JSON.stringify({
          releaseId: id,
          siteId: row.id,
          slug,
          siteCommit: row.main_sha,
          locales: Object.keys(publicContents),
          url: `${origin}/en/worlds/${slug}`,
        }),
        now(),
        c.id,
      ),
      eventStatement(
        env,
        c.id,
        "assistant",
        `網站已公開：${origin}/en/worlds/${slug}${options.operationRunId ? "\n這次探索已寫回世界紀錄。" : "\n自主更新尚未啟動，會等你另外下令。"}`,
        { releaseId: id, url: `${origin}/en/worlds/${slug}`, siteId: row.id },
      ),
      auditStatement(env, c.id, "release.active", {
        releaseId: id,
        siteCommit: row.main_sha,
        hash,
        operationRunId: options.operationRunId || null,
      }),
      env.DB.prepare("DELETE FROM studio_guards WHERE id=?").bind(guard),
    ];
    await env.DB.batch(statements);
  } catch (e) {
    const raced = await env.DB.prepare(
      "SELECT * FROM studio_publications WHERE id=? AND status='active'",
    )
      .bind(id)
      .first<PublicationRow>();
    if (raced) return raced;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE studio_publications SET status='failed' WHERE id=? AND status!='active'",
      ).bind(id),
      eventStatement(
        env,
        c.id,
        "error",
        "網站尚未通過公開驗證，先前公開版本已保留。已保存的內容不會遺失，可以稍後重試。",
        { siteId: row.id },
      ),
      auditStatement(env, c.id, "release.failed", {
        releaseId: id,
        reason: e instanceof DomainError ? e.code : "READBACK_FAILED",
      }),
    ]);
    throw e;
  }
  return (await env.DB.prepare("SELECT * FROM studio_publications WHERE id=?")
    .bind(id)
    .first<PublicationRow>())!;
}
export async function receiveSiteDeployment(
  env: Env,
  body: {
    siteId: string;
    codeHash: string;
    commitSha: string;
    environment: string;
    deliveryId: string;
    engineRevision: string;
    outcome?: "success" | "failure";
  },
) {
  if (
    body.environment !== env.ENVIRONMENT ||
    body.engineRevision !== env.BUILD_REVISION
  )
    throw new DomainError(
      "DEPLOYED_REVISION_MISMATCH",
      "部署版本尚未一致，不能啟用網站。",
    );
  const hash = await sha256(JSON.stringify(body)),
    old = await env.DB.prepare(
      "SELECT payload_hash FROM studio_deploy_deliveries WHERE id=?",
    )
      .bind(body.deliveryId)
      .first<{ payload_hash: string }>();
  if (old) {
    if (old.payload_hash !== hash) throw new DomainError("DELIVERY_CONFLICT");
    return { duplicate: true };
  }
  let row = await getStudioSite(env, body.siteId);
  if (row.code_hash !== body.codeHash)
    throw new DomainError("SITE_CODE_HASH_MISMATCH");
  if (body.outcome === "failure") {
    if (row.main_sha !== body.commitSha && row.commit_sha !== body.commitSha)
      return { unrelated: true };
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE studio_sites SET stage='failed',updated_at=? WHERE id=? AND stage IN ('merging','deploying','checking')",
      ).bind(now(), row.id),
      eventStatement(
        env,
        row.conversation_id,
        "error",
        "這次網站部署未完成，原有公開版本仍保留，設計與內容也已保存。你可以說「發布網站」接續這次部署。",
        { siteId: row.id, code: "SITE_DEPLOYMENT_FAILED" },
      ),
      auditStatement(env, row.conversation_id, "site.deployment_failed", {
        siteId: row.id,
        commit: body.commitSha,
      }),
      env.DB.prepare(
        "INSERT OR IGNORE INTO studio_deploy_deliveries(id,payload_hash,created_at) VALUES(?,?,?)",
      ).bind(body.deliveryId, hash, now()),
    ]);
    return { failed: true };
  }
  if (env.ENVIRONMENT === "dev") {
    if (row.commit_sha !== body.commitSha && row.main_sha !== body.commitSha)
      throw new DomainError("SITE_COMMIT_MISMATCH");
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE studio_sites SET preview_ready=1,stage=CASE WHEN stage='checking' THEN 'preview_ready' ELSE stage END,updated_at=? WHERE id=?",
      ).bind(now(), row.id),
      eventStatement(
        env,
        row.conversation_id,
        "preview",
        "網站預覽已通過部署驗證。你可以查看目前版本，再直接告訴我是否發布。",
        { siteId: row.id, previewUrl: `/studio-preview/${row.id}/en` },
      ),
      env.DB.prepare(
        "INSERT OR IGNORE INTO studio_deploy_deliveries(id,payload_hash,created_at) VALUES(?,?,?)",
      ).bind(body.deliveryId, hash, now()),
    ]);
    return { previewReady: true };
  }
  // Candidate branches may stage a protected preview in production, but never activate it.
  if (row.commit_sha === body.commitSha && !row.main_sha) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE studio_sites SET preview_ready=1,updated_at=? WHERE id=?",
      ).bind(now(), row.id),
      eventStatement(
        env,
        row.conversation_id,
        "preview",
        "網站預覽已完成驗證，尚未公開。",
        { siteId: row.id, previewUrl: `/studio-preview/${row.id}/en` },
      ),
      env.DB.prepare(
        "INSERT OR IGNORE INTO studio_deploy_deliveries(id,payload_hash,created_at) VALUES(?,?,?)",
      ).bind(body.deliveryId, hash, now()),
    ]);
    return { previewReady: true };
  }
  if (row.stage === "published") return { alreadyPublished: true };
  if (
    !row.main_sha ||
    body.commitSha !== env.BUILD_REVISION ||
    row.stage !== "deploying"
  )
    throw new DomainError("SITE_COMMIT_MISMATCH");
  await env.DB.prepare(
    "UPDATE studio_sites SET production_ready=1,main_sha=?,updated_at=? WHERE id=?",
  )
    .bind(body.commitSha, now(), row.id)
    .run();
  row = await getStudioSite(env, row.id);
  await activateStudioPublication(
    env,
    row,
    await loadSiteContents(env, row.content_key),
  );
  await env.DB.prepare(
    "INSERT OR IGNORE INTO studio_deploy_deliveries(id,payload_hash,created_at) VALUES(?,?,?)",
  )
    .bind(body.deliveryId, hash, now())
    .run();
  return { published: true };
}
