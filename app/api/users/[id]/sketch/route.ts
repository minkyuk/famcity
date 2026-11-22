import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { summarizeHearts } from "@/lib/hearts";
import { personHearts } from "@/lib/heartsStore";
import { loadSketch, resetSketch } from "@/lib/userSketchStore";

const ParamsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * What the agents remember about one person. Only that person — or a site admin — may read it
 * or clear it: a sketch can hold things shared in a members-only space.
 */
async function authorize(params: Promise<{ id: string }>): Promise<{ id: string } | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  if (session.user.id !== parsed.data.id && !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { id: parsed.data.id };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (auth instanceof NextResponse) return auth;
  const [sketch, user] = await Promise.all([loadSketch(auth.id), prisma.user.findUnique({ where: { id: auth.id }, select: { name: true } })]);
  // The hearts agents are told about, computed now (nothing is stored), after any reset.
  const since = sketch?.resetAt ? new Date(sketch.resetAt) : null;
  const hearts = user?.name ? summarizeHearts(await personHearts(auth.id, user.name, "everywhere", since).catch(() => [])) : [];
  return NextResponse.json({ sketch, hearts });
}

/** Clears the sketch. Nothing the person wrote before this moment is read into it again. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(params);
  if (auth instanceof NextResponse) return auth;
  const user = await prisma.user.findUnique({ where: { id: auth.id }, select: { name: true } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sketch = await resetSketch(auth.id, user.name ?? "");
  return NextResponse.json({ sketch, hearts: [] }); // hearts before the reset are no longer read
}
