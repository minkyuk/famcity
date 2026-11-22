import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { loadPrefs, savePrefs } from "@/lib/userPrefsStore";

/** The signed-in person's own settings (see lib/userPrefs.ts). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ prefs: await loadPrefs(session.user.id) });
}

const PatchSchema = z
  .object({ pets: z.boolean().optional(), music: z.boolean().optional() })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: "Nothing to change" });

/** PATCH — change one or more settings; the rest stay as they are. */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!result.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  try {
    return NextResponse.json({ prefs: await savePrefs(session.user.id, result.data) });
  } catch (err) {
    console.error("[preferences] save failed", err);
    return NextResponse.json({ error: "Could not save the setting" }, { status: 500 });
  }
}
