import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInviteCode } from "@/lib/invite";
import { z } from "zod";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [memberships, systemSpaces] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { userId: session.user.id },
      include: {
        space: { include: { _count: { select: { members: true, posts: true } } } },
      },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.space.findMany({
      where: { isSystem: true },
      include: { _count: { select: { members: true, posts: true } } },
    }),
  ]);

  const memberSpaceIds = new Set(memberships.map((m) => m.spaceId));
  const result = [
    ...memberships.map((m) => ({ ...m.space, role: m.role })),
    // System spaces appended at end (unless already in memberships)
    ...systemSpaces
      .filter((s) => !memberSpaceIds.has(s.id))
      .map((s) => ({ ...s, role: "MEMBER" as const })),
  ];

  return NextResponse.json(result);
}

const AgentInput = z.object({
  name: z.string().min(1).max(40),
  personality: z.string().min(1).max(600),
});

const CreateSpaceSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  purpose: z.string().max(500).optional(),
  agents: z.array(AgentInput).max(3).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const result = CreateSpaceSchema.safeParse(body);
  if (!result.success) {
    const firstError = result.error.issues[0];
    const msg = firstError ? `${firstError.path.join(".")}: ${firstError.message}` : "Invalid input";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Generate a unique invite code outside the transaction (needs its own queries)
  let inviteCode = generateInviteCode();
  while (await prisma.space.findUnique({ where: { inviteCode } })) {
    inviteCode = generateInviteCode();
  }

  const space = await prisma.space.create({
    data: {
      name: result.data.name,
      description: result.data.description,
      purpose: result.data.purpose || null,
      inviteCode,
      members: {
        create: { userId: session.user.id, role: "OWNER" },
      },
    },
    include: { _count: { select: { members: true, posts: true } } },
  });

  if (result.data.agents && result.data.agents.length > 0) {
    try {
      for (const a of result.data.agents) {
        const slug = `sa-${space.id.slice(0, 8)}-${a.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`;
        await prisma.spaceAgent.create({
          data: { spaceId: space.id, name: a.name, personality: a.personality, slug },
        });
      }
    } catch (err) {
      // Roll back the space so the user doesn't end up with a partial/empty space
      await prisma.space.delete({ where: { id: space.id } }).catch(() => {});
      throw err;
    }
  }

  return NextResponse.json(space, { status: 201 });
}
