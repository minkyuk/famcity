---
name: new-component
description: Scaffold a new FamCity React component at components/<Feature>/ComponentName.tsx following the project's conventions — Server Component by default, Tailwind-only styling, PascalCase file, "use client" added only when the component needs interactivity. Use when adding UI.
---

# new-component

Create a component that matches FamCity's conventions. Infer the feature folder and component name from the user's request (ask only if genuinely ambiguous).

## Steps

1. Path: `components/<Feature>/ComponentName.tsx` — PascalCase file, feature folder grouped (e.g. `components/calendar/`, `components/spaces/`, `components/Compose/`).
2. Decide Server vs Client:
   - Default to a Server Component (no directive).
   - Add `"use client"` at the top ONLY if the component uses event handlers, React hooks (`useState`/`useEffect`/etc.), or browser APIs.
3. Style exclusively with Tailwind utility classes. No CSS modules. No inline `style={{}}` (the one sanctioned exception in the codebase is `WalkingCat.tsx`, a portal-positioned fixed element).
4. Keep it one responsibility per file. If it grows, split it.
5. Run `npx tsc --noEmit` and fix type errors. No `any`.

## Server component template

```tsx
import { prisma } from "@/lib/prisma";

interface Props {
  // typed props — never `any`
}

export function ComponentName({ }: Props) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      {/* ... */}
    </div>
  );
}
```

## Client component template

```tsx
"use client";

import { useState } from "react";

interface Props {
  // typed props
}

export function ComponentName({ }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
    >
      {/* ... */}
    </button>
  );
}
```

After creating, run the `famcity-reviewer` subagent on the diff for a convention check.
