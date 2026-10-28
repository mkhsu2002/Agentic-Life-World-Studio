# Conversation Studio v0.07 Implementation Plan

> **For agentic workers:** Use subagent-driven-development with bounded ownership and independent specification / quality review. User has approved implementation of the full conversational Studio plan.

**Goal:** A persistent conversation with a world director controls source reading, faithful expansion, image calibration, custom site creation, publication and separately enabled autonomous operation.

**Architecture:** React conversation surface; authenticated Hono APIs; D1 append-only messages, proposals, approvals, task state and world memory; R2 immutable source/image/site artifacts; Queue tasks and event replay. Retain old source and public releases without automatically importing approvals. Muse Spark 1.3 and Muse Image stay server-side. Custom site code enters GitHub candidates and Cloudflare only through trusted CI.

**Tech Stack:** TypeScript, React, Hono, Zod, D1, R2, Queues, GitHub API and Actions, Cloudflare Workers.

## Task 1 — Durable conversation contract and orchestration
- [x] Add migration 0006 for conversations, events, turns/tasks, source documents, proposals, approvals, immutable memory versions and operation policy.
- [x] Add shared contracts and fail-first tests: replay, idempotent turns, version-bound approvals, cancellation and immutable approved memory.
- [x] Persist user input before queue dispatch; recover dispatch without repeating accepted work.
- [x] Director selects a bounded task; role results are candidates until independent review and explicit owner approval.
- [x] Run `npx vitest run tests/conversation*.test.ts`; assert no approval or publication comes from source text.

## Task 2 — Whole-source and site reading
- [x] Test 100,000 Chinese characters, late constraints, chapter boundaries, 100 same-origin content pages, deduplication and unavailable pages.
- [x] Whole-context reading where request fits; otherwise resumable chapter work and consolidation, retaining source locations and one-off prohibitions.
- [x] Source snapshots and reference pixels remain private; changed sources invalidate dependent proposals.
- [x] Run the source and director contract tests against real SQLite-backed state.

## Task 3 — Creative agents and visual production
- [x] Define typed outputs for director, world development, journey, visual, editorial and fidelity review.
- [x] Bind outputs to memory / source hashes; check cancellation and dependencies before committing.
- [x] Visual samples use actual source references, accept 5 MiB images, two images per requested round and at most six per batch.
- [x] Retain uncertain billing states; do not repeat known persisted successful provider results.

## Task 4 — Single conversation frontend
- [x] Replace mandatory forms / tabs with conversation chooser, chronological messages, composer and attachments.
- [x] Render direction / change / image / website / progress cards inline; optional data and usage drawer.
- [x] Allow input while background reading runs; reconnect by event cursor; keep client message id across retries.
- [x] Verify keyboard input, upload, cancellation, inline approval, long chat, mobile layout and reload.

## Task 5 — Independent sites and GitHub release
- [x] Site author generates isolated HTML/CSS/frontend candidate from public data only, with protected preview.
- [x] Use restricted GitHub App installation credentials at runtime; fail closed with a concrete setup message if missing.
- [x] Candidate branch -> secret-free validation -> trusted preview deployment -> exact candidate approval -> merge -> production readback.
- [x] Reject external network / executable server code / secret-bearing content; retain previous release on failure.
- [x] Add event-driven GitHub webhook / CI completion callbacks and dedupe deliveries.

## Task 6 — Translation and autonomous operation
- [x] Add en / zh-Hant / ja stable-name translation and independent semantic review; only complete reviewed languages publish.
- [x] Publishing does not enable autonomy. Explicit separate operation proposal requires scope, frequency and author-specified quota.
- [x] Due work is claimed once, checks budget before model calls, publishes within approved scope, then writes event and memory.
- [x] Validate three consecutive cycles with stable IDs, cumulative quota, cancellation and failure recovery.

## Task 7 — Integration, documentation and release
- [x] Run baseline and full `npm run check`, `npm run format:check`, `npm audit --audit-level=moderate`.
- [x] Independent specification review, then quality review; repair all blocking findings.
- [x] Update PRD, clean product README, operations and contracts; archive obsolete instructions with status notes.
- [x] Bump to v0.07 / npm 0.0.7 / API utsp-studio/0.07; next source batch keeps that release version.
- [ ] Push tested branch; merge to main only after checks. GitHub applies migration and deploys dev then production.
- [ ] Cross-check deployed code, tables, API, frontend, live neutral-source behavior, audit and secrets names in both environments. Do not approve or run the author's existing IP.

## Required decisions
Single owner; Traditional Chinese Studio conversation; default English public site; unique per-world layouts in this repository; publishing and autonomous operation are separate author permissions. All meaningful actions bind to a concrete proposal/version. No schema/form fields become mandatory author homework. Repository is public: original text, private names, draft public copy and source images must never be embedded into generated site code.

## Release status
Local validation and independent specification / quality review passed. Real browser DOCX/PDF pixel extraction verified. GitHub App registration and dev / production release verification are being completed; mocked GitHub tests are not live authorization evidence.
