import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { studioFixture, type StudioFixture } from "./fixtures/studio-env";
import {
  activateStudioPublication,
  receiveSiteDeployment,
} from "../src/server/conversation-release";
import {
  conversationSiteRoutes,
  getStudioSite,
  publishConversationSite,
  loadSiteContents,
} from "../src/server/conversation-site";
import { conversationDeploymentRoutes } from "../src/server/conversation-deployment";
import {
  activateConversationOperation,
  scheduleNextOperation,
  runOperationWakeup,
  finishConversationCycle,
} from "../src/server/conversation-operations";
import { buildSiteContents } from "../src/server/conversation-site-content";
import {
  getConversation,
  getProposal,
  proposalApproval,
  conversationRow,
} from "../src/server/conversation-store";
import { sha256, DomainError } from "../src/server/domain";
import type { Env } from "../src/server/env";
import type { ConversationHookContext } from "../src/server/conversation";
import type { ConversationDocument } from "../src/shared/conversation";
let f: StudioFixture, api: Hono<{ Bindings: Env }>;
const code = {
  html: '<main><h1 data-slot="title"></h1><p data-slot="summary"></p><section><article data-repeat="entries"><h2 data-slot="entry.title"></h2><p data-slot="entry.body"></p></article></section><img data-slot="hero" alt=""></main>',
  css: "body{color:#243025;background:#faf9f5}main{padding:24px}",
};
const stamp = "2026-10-27T20:00:00.000Z";
let doc: ConversationDocument;
beforeEach(async () => {
  f = studioFixture();
  api = new Hono<{ Bindings: Env }>();
  api.onError((e, c) =>
    c.json(
      { error: e instanceof DomainError ? e.code : String(e) },
      e instanceof DomainError ? (e.status as 400) : 500,
    ),
  );
  api.route("/", conversationSiteRoutes);
  api.route("/", conversationDeploymentRoutes);
  doc = {
    direction: {
      core: "PRIVATE_CORE",
      extension: "PRIVATE_EXTENSION",
      exploration: "Observe",
      continuity: "PRIVATE_TIMELINE",
      visual: "Watercolor",
      audience: "Curious",
    },
    world: {
      title: "PRIVATE_WORLD_TITLE",
      summary: "PRIVATE_WORLD_SUMMARY",
      elements: [],
    },
    visual: { assetIds: ["image"], selectedAssetId: "image" },
    journey: null,
    publication: null,
    operation: null,
    editorial: {
      title: "The cloud coast",
      summary: "A quiet place above the sea.",
      entries: [
        {
          title: "A morning",
          body: "Clouds pass the coast.",
          caption: "A quiet coast.",
          elementIds: [],
        },
      ],
    },
    editorialHash: "editorial",
    translationsSourceHash: "editorial",
    privateNotes: "PRIVATE_AUTHOR_NOTES",
  };
  f.sql
    .prepare(
      "INSERT INTO studio_conversations(id,title,revision,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run("c", "PRIVATE_TITLE", 1, JSON.stringify(doc), stamp, stamp);
  await f.env.STORAGE.put("image", new Uint8Array([137, 80, 78, 71]), {
    httpMetadata: { contentType: "image/png" },
  });
  f.sql
    .prepare(
      "INSERT INTO studio_assets(id,conversation_id,kind,name,content_type,storage_key,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run("image", "c", "image", "private caption", "image/png", "image", stamp);
  await seedSite("site");
  vi.stubGlobal("fetch", readback);
});
afterEach(() => {
  vi.unstubAllGlobals();
  f.close();
});
async function readback(input: RequestInfo | URL, init?: RequestInit) {
  return api.request(new Request(String(input), init), undefined, f.env);
}
async function seedSite(id: string) {
  const hash = await sha256(JSON.stringify(code));
  await f.env.STORAGE.put(id + "/code", JSON.stringify(code));
  await f.env.STORAGE.put(
    id + "/content",
    JSON.stringify(buildSiteContents(doc, "/api/studio/assets/image")),
  );
  const content = {
      siteId: id,
      codeHash: hash,
      previewUrl: "/studio-preview/" + id + "/en",
    },
    proposalHash = await sha256(JSON.stringify(content));
  if (!f.sql.prepare("SELECT id FROM studio_events WHERE id=1").get())
    f.sql
      .prepare(
        "INSERT INTO studio_events(id,conversation_id,type,content,data_json,created_at) VALUES(1,?,?,?,?,?)",
      )
      .run("c", "user", "發布網站", "{}", stamp);
  f.sql
    .prepare(
      "INSERT INTO studio_proposals(id,conversation_id,kind,revision,status,content_json,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "p-" + id,
      "c",
      "site",
      0,
      "approved",
      JSON.stringify(content),
      proposalHash,
      stamp,
    );
  f.sql
    .prepare(
      "INSERT INTO studio_approvals(id,conversation_id,proposal_id,proposal_hash,owner_event_id,revision,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run("a-" + id, "c", "p-" + id, proposalHash, 1, 1, stamp);
  f.sql
    .prepare(
      "INSERT INTO studio_sites(id,conversation_id,base_revision,code_hash,code_key,content_key,stage,commit_sha,main_sha,preview_ready,production_ready,proposal_id,owner_event_id,cancel_epoch,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "c",
      0,
      hash,
      id + "/code",
      id + "/content",
      "deploying",
      "b".repeat(40),
      f.env.BUILD_REVISION,
      1,
      1,
      "p-" + id,
      1,
      0,
      stamp,
      stamp,
    );
  f.sql
    .prepare(
      "UPDATE studio_conversations SET document_json=json_set(document_json,'$.site',json(?)) WHERE id='c'",
    )
    .run(JSON.stringify(content));
}
async function contents() {
  return loadSiteContents(f.env, "site/content");
}
async function publish() {
  return activateStudioPublication(
    f.env,
    await getStudioSite(f.env, "site"),
    await contents(),
  );
}
async function context(
  proposalId = "p-site",
): Promise<ConversationHookContext> {
  const c = await getConversation(f.env, "c"),
    p = await getProposal(f.env, proposalId),
    approval = await proposalApproval(f.env, proposalId);
  return {
    taskId: "task",
    conversationId: "c",
    role: "publish",
    payload: {},
    document: c.document,
    ownerEventId: 1,
    ownerMessage: "發布網站",
    proposal: p,
    approval,
  };
}
it("requires authentication for private previews and renders only projected public copy", async () => {
  expect((await api.request("/studio-preview/site/en", {}, f.env)).status).toBe(
    401,
  );
  const r = await api.request(
    "/studio-preview/site/en",
    { headers: { Cookie: await f.cookie() } },
    f.env,
  );
  expect(r.status).toBe(200);
  const text = await r.text();
  expect(text).toContain("The cloud coast");
  expect(text).not.toContain("PRIVATE_");
  expect(r.headers.get("X-Robots-Tag")).toContain("noindex");
  expect(
    (await api.request("/api/public/studio/en/world-c", {}, f.env)).status,
  ).toBe(404);
});
it("publishes only a public DTO and keeps autonomous operation disabled", async () => {
  const release = await publish();
  expect(release.status).toBe("active");
  const r = await api.request(
    "/api/public/studio/en/" + release.slug,
    {},
    f.env,
  );
  expect(r.status).toBe(200);
  const body = await r.text();
  expect(body).toContain("The cloud coast");
  expect(body).not.toContain("PRIVATE_");
  expect(body).not.toContain("direction");
  expect(body).not.toContain("/api/studio/assets");
  expect((await getConversation(f.env, "c")).document.operation).toBeNull();
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_audit WHERE action='release.active'",
      )
      .get(),
  ).toEqual({ n: 1 });
});
it("refuses unapproved site publication before any readback side effect", async () => {
  f.sql
    .prepare("UPDATE studio_sites SET proposal_id=NULL WHERE id=?")
    .run("site");
  await expect(publish()).rejects.toMatchObject({
    code: "EXACT_APPROVAL_REQUIRED",
  });
  expect(
    f.sql.prepare("SELECT COUNT(*) n FROM studio_publications").get(),
  ).toEqual({ n: 0 });
});
it("does not allow a mismatched approval hash or owner event to activate", async () => {
  f.sql
    .prepare(
      "UPDATE studio_proposals SET content_hash='changed' WHERE id='p-site'",
    )
    .run();
  await expect(publish()).rejects.toMatchObject({
    code: "EXACT_APPROVAL_REQUIRED",
  });
});
it("blocks cancelled release both before and during readback", async () => {
  f.sql
    .prepare("UPDATE studio_conversations SET cancel_epoch=1 WHERE id=?")
    .run("c");
  await expect(publish()).rejects.toMatchObject({ code: "TASK_CANCELLED" });
  f.sql
    .prepare("UPDATE studio_conversations SET cancel_epoch=0 WHERE id=?")
    .run("c");
  let cancelled = false;
  vi.stubGlobal("fetch", async (input: any, init: any) => {
    const response = await readback(input, init);
    if (!cancelled) {
      cancelled = true;
      f.sql
        .prepare("UPDATE studio_conversations SET cancel_epoch=1 WHERE id=?")
        .run("c");
    }
    return response;
  });
  await expect(publish()).rejects.toThrow();
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_publications WHERE status='active'",
      )
      .get(),
  ).toEqual({ n: 0 });
});
it("rejects stale public content changed after preview", async () => {
  doc.editorial = {
    title: "Changed after review",
    summary: "Changed",
    entries: [{ title: "Changed", body: "Changed", caption: "Changed" }],
  };
  f.sql
    .prepare("UPDATE studio_conversations SET document_json=? WHERE id=?")
    .run(JSON.stringify(doc), "c");
  await expect(publish()).rejects.toMatchObject({ code: "SITE_PREVIEW_STALE" });
});
it("preserves the previous active release if the next public readback fails", async () => {
  const previous = await publish();
  await seedSite("next");
  vi.stubGlobal(
    "fetch",
    async () => new Response("not ready", { status: 503 }),
  );
  await expect(
    activateStudioPublication(
      f.env,
      await getStudioSite(f.env, "next"),
      await loadSiteContents(f.env, "next/content"),
    ),
  ).rejects.toThrow();
  expect(
    f.sql
      .prepare("SELECT id FROM studio_publications WHERE status='active'")
      .get(),
  ).toEqual({ id: previous.id });
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_publications WHERE status='failed'",
      )
      .get(),
  ).toEqual({ n: 1 });
});
it("deduplicates completed deployment callbacks", async () => {
  f.env.ENVIRONMENT = "dev";
  const row = await getStudioSite(f.env, "site"),
    body = {
      siteId: "site",
      codeHash: row.code_hash,
      commitSha: row.commit_sha!,
      engineRevision: f.env.BUILD_REVISION,
      environment: "dev",
      deliveryId: "delivery",
    };
  await receiveSiteDeployment(f.env, body);
  expect(await receiveSiteDeployment(f.env, body)).toEqual({ duplicate: true });
  expect(
    f.sql.prepare("SELECT COUNT(*) n FROM studio_deploy_deliveries").get(),
  ).toEqual({ n: 1 });
});
it("rejects callbacks for a different environment or deployed engine revision", async () => {
  const row = await getStudioSite(f.env, "site");
  await expect(
    receiveSiteDeployment(f.env, {
      siteId: "site",
      codeHash: row.code_hash,
      commitSha: row.main_sha!,
      engineRevision: "old",
      environment: "production",
      deliveryId: "delivery",
    }),
  ).rejects.toMatchObject({ code: "DEPLOYED_REVISION_MISMATCH" });
  expect(
    f.sql.prepare("SELECT COUNT(*) n FROM studio_deploy_deliveries").get(),
  ).toEqual({ n: 0 });
});
async function operationContext(maxCalls: unknown = 60) {
  const eventId =
    Number(
      (f.sql.prepare("SELECT MAX(id) id FROM studio_events").get() as any).id ||
        0,
    ) + 1;
  const policy = {
    enabled: false,
    frequencyHours: 24,
    maxCalls,
    usedCalls: 0,
    scope: "Extend the established world without changing its core.",
    nextRunAt: null,
    approvalHash: "operation-hash",
  };
  f.sql
    .prepare(
      "UPDATE studio_conversations SET revision=2,document_json=json_set(document_json,'$.operation',json(?)) WHERE id='c'",
    )
    .run(JSON.stringify(policy));
  f.sql
    .prepare(
      "INSERT INTO studio_events(id,conversation_id,type,content,data_json,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(eventId, "c", "user", "啟動自主更新 proposal_operation", "{}", stamp);
  f.sql
    .prepare(
      "INSERT INTO studio_proposals(id,conversation_id,kind,revision,status,content_json,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "proposal_operation",
      "c",
      "operation",
      1,
      "approved",
      JSON.stringify({ operation: policy }),
      "operation-hash",
      stamp,
    );
  f.sql
    .prepare(
      "INSERT INTO studio_approvals(id,conversation_id,proposal_id,proposal_hash,owner_event_id,revision,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "approval-operation",
      "c",
      "proposal_operation",
      "operation-hash",
      eventId,
      2,
      stamp,
    );
  f.sql
    .prepare(
      "INSERT INTO studio_turns(id,conversation_id,client_message_id,input_hash,event_id,task_id,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "operation-turn",
      "c",
      "operation-client",
      "input",
      eventId,
      "activation-task",
      stamp,
    );
  f.sql
    .prepare(
      "INSERT INTO studio_tasks(id,conversation_id,turn_id,role,status,attempts,payload_json,source_revision,cancel_epoch,lease_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "activation-task",
      "c",
      "operation-turn",
      "operation",
      "running",
      1,
      "{}",
      2,
      0,
      "2099-01-01",
      stamp,
      stamp,
    );
  const ctx = await context("proposal_operation");
  return {
    ...ctx,
    taskId: "activation-task",
    role: "operation" as const,
    ownerEventId: eventId,
    ownerMessage: "啟動自主更新 proposal_operation",
  };
}
it("does not enable autonomous operation without an author-specified quota", async () => {
  await publish();
  const ctx = await operationContext(undefined);
  f.sql
    .prepare(
      "UPDATE studio_conversations SET document_json=json_remove(document_json,'$.operation.maxCalls') WHERE id='c'",
    )
    .run();
  await expect(activateConversationOperation(f.env, ctx)).rejects.toMatchObject(
    { code: "OPERATION_POLICY_INVALID" },
  );
  expect((await getConversation(f.env, "c")).document.operation?.enabled).toBe(
    false,
  );
  expect(f.workflows.size).toBe(0);
});
it("does not enable autonomous operation without a durable workflow scheduler", async () => {
  await publish();
  const ctx = await operationContext();
  f.env.OPERATIONS = undefined;
  await expect(activateConversationOperation(f.env, ctx)).rejects.toMatchObject(
    { code: "OPERATION_SCHEDULER_REQUIRED" },
  );
  expect((await getConversation(f.env, "c")).document.operation?.enabled).toBe(
    false,
  );
});
it("deduplicates operation wakeups and claims only one active run per world", async () => {
  await publish();
  const ctx = await operationContext();
  await activateConversationOperation(f.env, ctx);
  f.sql
    .prepare(
      "UPDATE studio_tasks SET status='completed' WHERE id='activation-task'",
    )
    .run();
  const row = f.sql
    .prepare("SELECT id FROM studio_automation_wakeups")
    .get() as { id: string };
  await Promise.all([
    runOperationWakeup(f.env, row.id),
    runOperationWakeup(f.env, row.id),
  ]);
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_operation_runs WHERE status='running'",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_tasks WHERE json_extract(payload_json,'$.operationRunId') IS NOT NULL",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(f.workflows.size).toBe(1);
});
it("rejects stale or disabled operation policies when finishing a cycle", async () => {
  await publish();
  const ctx = await operationContext();
  f.sql
    .prepare(
      "INSERT INTO studio_operation_runs(id,conversation_id,policy_hash,status,scheduled_for,created_at) VALUES('run','c','old-policy','running',?,?)",
    )
    .run(stamp, stamp);
  await expect(
    finishConversationCycle(f.env, {
      ...ctx,
      payload: { operationRunId: "run", operationDraft: { runId: "run" } },
    }),
  ).rejects.toMatchObject({ code: "OPERATION_STALE" });
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_publications WHERE status='active'",
      )
      .get(),
  ).toEqual({ n: 1 });
});
it("retains images and journey history across three completed autonomous publications and deduplicates a retried finish", async () => {
  await publish();
  const ctx = await operationContext();
  await activateConversationOperation(f.env, ctx);
  f.sql
    .prepare(
      "UPDATE studio_tasks SET status='completed' WHERE id='activation-task'",
    )
    .run();
  for (let i = 1; i <= 3; i++) {
    const runId = "run-" + i,
      asset = "image-" + i;
    await f.env.STORAGE.put(asset, new Uint8Array([137, 80, 78, 71, i]), {
      httpMetadata: { contentType: "image/png" },
    });
    f.sql
      .prepare(
        "INSERT INTO studio_assets(id,conversation_id,kind,name,content_type,storage_key,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(asset, "c", "image", "Image " + i, "image/png", asset, stamp);
    f.sql
      .prepare(
        "INSERT INTO studio_operation_runs(id,conversation_id,policy_hash,status,scheduled_for,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(runId, "c", "operation-hash", "running", stamp + i, stamp + i);
    const editorial = {
      title: "The cloud coast",
      summary: "A new observation.",
      entries: [
        {
          title: "Day " + i,
          body: "A new discovery " + i,
          caption: "Cloud coast " + i,
          elementIds: [],
        },
      ],
    };
    const hash = await sha256(JSON.stringify(editorial));
    const draft = {
      runId,
      world: (await getConversation(f.env, "c")).document.world,
      visual: { assetIds: [asset], selectedAssetId: asset },
      journey: {
        title: "Journey " + i,
        purpose: "Observe",
        placeIds: [],
        elementIds: [],
        encounters: ["Clouds"],
        changes: [],
      },
      editorial,
      editorialHash: hash,
      translationsSourceHash: hash,
      translations: {
        locales: ["en", "zh-Hant", "ja"].map((locale) => ({
          locale,
          title: editorial.title,
          summary: editorial.summary,
          entries: editorial.entries,
          terms: [],
        })),
      },
    };
    const current = {
      ...ctx,
      role: "review" as const,
      payload: { operationRunId: runId, operationDraft: draft },
    };
    await finishConversationCycle(f.env, current);
    if (i === 3) await finishConversationCycle(f.env, current);
    const active = f.sql
      .prepare("SELECT * FROM studio_publications WHERE status='active'")
      .get() as any;
    const data = await loadSiteContents(f.env, active.content_key);
    expect(data.en?.entries).toHaveLength(i + 1);
    for (const entry of data.en!.entries) {
      expect(entry.imageUrl).toContain("/" + active.id + "/");
      const image = await api.request(entry.imageUrl!, {}, f.env);
      expect(image.status).toBe(200);
    }
  }
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_operation_runs WHERE status='completed'",
      )
      .get(),
  ).toEqual({ n: 3 });
  expect(
    f.sql.prepare("SELECT COUNT(*) n FROM studio_journey_records").get(),
  ).toEqual({ n: 3 });
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_audit WHERE action='operation.cycle_completed'",
      )
      .get(),
  ).toEqual({ n: 3 });
  expect(
    f.sql.prepare("SELECT COUNT(*) n FROM studio_approvals").get(),
  ).toEqual({ n: 2 });
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_publications WHERE status='active'",
      )
      .get(),
  ).toEqual({ n: 1 });
});
it("blocks stale publication when reviewed content changes without increasing author revision during readback", async () => {
  let changed = false;
  const fetcher: typeof fetch = async (input, init) => {
    if (!changed) {
      changed = true;
      f.sql
        .prepare(
          "UPDATE studio_conversations SET document_json=json_set(document_json,'$.site',json('null'),'$.editorial.title','Changed during readback') WHERE id='c'",
        )
        .run();
    }
    return readback(input, init);
  };
  await expect(
    activateStudioPublication(
      f.env,
      await getStudioSite(f.env, "site"),
      await contents(),
      { fetcher },
    ),
  ).rejects.toThrow();
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_publications WHERE status='active'",
      )
      .get(),
  ).toEqual({ n: 0 });
});
it("allows an English-only zero-element draft without a nonexistent translation hash", () => {
  expect(
    buildSiteContents(
      { ...doc, translations: null, translationsSourceHash: null },
      "/api/studio/assets/image",
    ).en?.title,
  ).toBe("The cloud coast");
});
it("recovers a run after transient task enqueue failure instead of leaving falsely enabled idle operation", async () => {
  await publish();
  const ctx = await operationContext();
  await activateConversationOperation(f.env, ctx);
  f.sql
    .prepare(
      "UPDATE studio_tasks SET status='completed' WHERE id='activation-task'",
    )
    .run();
  const wake = f.sql
    .prepare("SELECT id FROM studio_automation_wakeups")
    .get() as { id: string };
  const original = f.env.DB.prepare.bind(f.env.DB);
  let fail = true;
  f.env.DB.prepare = ((query: string) => {
    if (fail && query.includes("INSERT INTO studio_tasks")) {
      fail = false;
      throw new Error("temporary DB unavailable");
    }
    return original(query);
  }) as typeof f.env.DB.prepare;
  await expect(runOperationWakeup(f.env, wake.id)).rejects.toThrow(
    "temporary DB",
  );
  await runOperationWakeup(f.env, wake.id);
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_operation_runs WHERE status='running'",
      )
      .get(),
  ).toEqual({ n: 1 });
  expect(
    f.sql
      .prepare("SELECT COUNT(*) n FROM studio_tasks WHERE role='world'")
      .get(),
  ).toEqual({ n: 1 });
});
it("records CI failure without replacing the prior public release and frees the release lock", async () => {
  const row = await getStudioSite(f.env, "site");
  const result = await receiveSiteDeployment(f.env, {
    siteId: row.id,
    codeHash: row.code_hash,
    commitSha: row.main_sha!,
    engineRevision: f.env.BUILD_REVISION,
    environment: "production",
    deliveryId: "failed-deploy",
    outcome: "failure",
  });
  expect(result).toEqual({ failed: true });
  expect((await getStudioSite(f.env, "site")).stage).toBe("failed");
  expect(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM studio_publications WHERE status='active'",
      )
      .get(),
  ).toEqual({ n: 0 });
});
