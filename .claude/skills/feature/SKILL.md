---
name: feature
description: Run FamCity's multi-agent feature pipeline for a non-trivial change — plan with the Plan agent, implement, then review with the famcity-reviewer subagent and verify the build. Use when the user asks to build/add a feature that spans more than one file or touches API + UI + schema together.
---

# feature — multi-agent build pipeline

Orchestrate a change end-to-end using specialized agents instead of doing everything inline. Use this for features that span multiple files (e.g. API route + component + schema), not for one-line tweaks.

The argument is the feature request, e.g. `/feature add reactions to chat messages`.

## Pipeline

Run these stages in order. Each stage feeds the next.

### 1. Plan (architecture)
Spawn the `Plan` subagent with the feature request plus the relevant constraints from `CLAUDE.md` (Tailwind-only, Zod validation, Prisma `db push` not `migrate dev`, SSE field completeness, the `spaceId: { in: [] }` pitfall, no new auth logic). Ask it for:
- the list of files to create/modify,
- the data model changes (if any) and whether `prisma db push` is needed,
- the order of implementation.

Relay the plan to the user and get a thumbs-up before writing code (use EnterPlanMode / ExitPlanMode if the change is large).

### 2. Implement
Do the implementation yourself following the plan. Reuse the `new-api` and `new-component` skills for scaffolding where they fit. Keep each file single-responsibility. If the schema changed, run `npx prisma db push` (never `migrate dev` — Neon pooler has no advisory locks).

### 3. Review (parallel)
In a single message, spawn both in parallel:
- the `famcity-reviewer` subagent on the working-tree diff (convention + correctness pass),
- the `code-review` skill if the change is logic-heavy.

Apply every must-fix finding. Re-run the reviewer if you made substantial changes.

### 4. Verify
- Run `npx tsc --noEmit` — must be clean.
- If a dev server isn't already running, the user can start it; otherwise use the `verify` / `run` skill to gut-check the feature in the browser.

### 5. Report
Summarize: files changed, schema impact, what was verified, and anything left for the user (env vars, one-time setup, manual testing). Commit/push only if the user asks.

## Notes
- Prefer parallel subagent calls when stages are independent (e.g. exploring two subsystems at once).
- Don't push to `main` without explicit go-ahead — `main` auto-deploys to Vercel.
