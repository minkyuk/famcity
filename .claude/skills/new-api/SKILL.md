---
name: new-api
description: Scaffold a new FamCity API route at app/api/<resource>/route.ts with Zod input validation, the Prisma singleton, NextAuth session guard, and the project's named-export convention (GET/POST/DELETE). Use when adding a backend endpoint.
---

# new-api

Scaffold an API route that already follows FamCity conventions. Ask the user (or infer from their request) the resource path, which HTTP methods are needed, and the input shape.

## Steps

1. Determine the route path: `app/api/<resource>/route.ts`. Nested/dynamic segments use `[id]` folders.
2. Add the input schema(s) to `lib/validators.ts` (do not inline Zod schemas in the route file — the project keeps them in `lib/validators.ts`). Read that file first to match its export style.
3. Create the route with named exports (`GET`, `POST`, `DELETE` — only the ones requested).
4. Use the singleton `prisma` from `lib/prisma.ts` and `getServerSession(authOptions)` from `lib/auth.ts` for the auth guard.
5. Run `npx tsc --noEmit` and fix any errors.

## Route template

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { <schemaName> } from "@/lib/validators";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = <schemaName>.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // ... prisma work via the singleton ...

  return NextResponse.json({ ok: true });
}
```

## Rules to honor

- Never trust `req.json()` / `searchParams` without Zod parsing.
- Never instantiate `new PrismaClient()` — use the singleton.
- If querying by a list of space ids, never write `{ spaceId: { in: [] } }`; use the conditional spread `...(ids.length > 0 ? [{ spaceId: { in: ids } }] : [])`.
- If the route pushes a post over SSE, include `media`, `hashtags`, `space`, `reactions`, `comments`, `_count`.

After scaffolding, hand the diff to the `famcity-reviewer` subagent for a quick pass.
