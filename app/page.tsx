import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Feed } from "./Feed";
import { HashtagSidebar } from "@/components/shared/HashtagSidebar";
import { OnlineWidget } from "@/components/shared/OnlineWidget";
import { UpcomingEvents } from "@/components/shared/UpcomingEvents";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const memberships = await prisma.spaceMember.findMany({
    where: { userId: session.user.id },
    select: { spaceId: true },
  });
  const spaceIds = memberships.map((m) => m.spaceId);

  const posts = await prisma.post.findMany({
    take: 20,
    where: {
      AND: [
        { OR: [{ spaceId: null }, ...(spaceIds.length > 0 ? [{ spaceId: { in: spaceIds } }] : [])] },
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
      <div className="flex-1 min-w-0">
        {/* Mobile hashtag sidebar as horizontal scroll */}
        <div className="lg:hidden mb-4">
          <Suspense>
            <MobileHashtags />
          </Suspense>
        </div>
        <Suspense>
          <Feed initialPosts={posts} initialNextCursor={nextCursor} />
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
