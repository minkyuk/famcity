import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Feed } from "./Feed";
import { HashtagSidebar } from "@/components/shared/HashtagSidebar";
import { OnlineWidget } from "@/components/shared/OnlineWidget";
import { UpcomingEvents } from "@/components/shared/UpcomingEvents";
import { InlineComposeCard } from "@/components/shared/InlineComposeCard";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const [memberships, excludedSpaces] = await Promise.all([
    prisma.spaceMember.findMany({ where: { userId: session.user.id }, select: { spaceId: true } }),
    prisma.space.findMany({ where: { excludeFromAll: true }, select: { id: true } }),
  ]);
  const excludedIds = new Set(excludedSpaces.map((s) => s.id));
  const spaceIds = memberships.map((m) => m.spaceId).filter((id) => !excludedIds.has(id));

  // Build userId -> first shared space name for "via 👥" label
  const firstSharedSpaceByUser = new Map<string, string>();
  let coMemberIds: string[] = [];
  if (spaceIds.length > 0) {
    const [coMemberships, spaceNames] = await Promise.all([
      prisma.spaceMember.findMany({ where: { spaceId: { in: spaceIds } }, select: { userId: true, spaceId: true } }),
      prisma.space.findMany({ where: { id: { in: spaceIds } }, select: { id: true, name: true } }),
    ]);
    const spaceNameById = new Map(spaceNames.map((s) => [s.id, s.name]));
    for (const m of coMemberships) {
      if (!firstSharedSpaceByUser.has(m.userId)) {
        const n = spaceNameById.get(m.spaceId);
        if (n) firstSharedSpaceByUser.set(m.userId, n);
      }
    }
    coMemberIds = [...firstSharedSpaceByUser.keys()];
  }

  const rawPosts = await prisma.post.findMany({
    take: 20,
    where: {
      AND: [
        {
          OR: [
            ...(spaceIds.length > 0 ? [{ spaceId: { in: spaceIds } }] : []),
            ...(coMemberIds.length > 0 ? [{ spaceId: null, userId: { in: coMemberIds } }] : []),
            { spaceId: null, userId: session.user.id },
            { spaceId: null, userId: null },
          ],
        },
        { OR: [{ isPrivate: false }, { userId: session.user.id }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      reactions: true,
      comments: { orderBy: { createdAt: "asc" } },
      media: { orderBy: { order: "asc" } },
      hashtags: { include: { hashtag: true } },
      space: { select: { name: true } },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  const posts = rawPosts.map((post) => ({
    ...post,
    mutualSpace:
      !post.spaceId && post.userId && post.userId !== session.user.id
        ? (firstSharedSpaceByUser.get(post.userId) ?? null)
        : null,
  }));

  const nextCursor = posts.length === 20 ? posts[posts.length - 1].id : null;

  return (
    <div className="flex gap-6">
      {/* Sidebar — hidden on mobile */}
      <aside className="hidden lg:block w-48 shrink-0 pt-1 flex flex-col gap-4">
        <OnlineWidget />
        <UpcomingEvents />
        <Suspense>
          <HashtagSidebar />
        </Suspense>
      </aside>

      {/* Feed */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {/* Mobile hashtag sidebar as horizontal scroll */}
        <div className="lg:hidden">
          <Suspense>
            <MobileHashtags />
          </Suspense>
        </div>
        <InlineComposeCard />
        <Suspense>
          <Feed initialPosts={posts} initialNextCursor={nextCursor} isAdmin={isAdmin(session)} />
        </Suspense>
      </div>
    </div>
  );
}

// Inline mobile hashtag component
async function MobileHashtags() {
  // Rendered server-side as placeholder; client fills via HashtagSidebar
  return null;
}
