import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Feed } from "@/app/Feed";
import { InviteButton } from "@/components/spaces/InviteButton";
import { HashtagSidebar } from "@/components/shared/HashtagSidebar";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.user.id, spaceId: id } },
  });
  if (!membership) notFound();

  const space = await prisma.space.findUnique({
    where: { id },
    include: { _count: { select: { members: true } } },
  });
  if (!space) notFound();

  const posts = await prisma.post.findMany({
    take: 20,
    where: { spaceId: id },
    orderBy: { createdAt: "desc" },
    include: {
      reactions: true,
      comments: { orderBy: { createdAt: "asc" } },
      media: { orderBy: { order: "asc" } },
      hashtags: { include: { hashtag: true } },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  const nextCursor = posts.length === 20 ? posts[posts.length - 1].id : null;

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <aside className="hidden lg:block w-48 shrink-0 pt-1">
        <Suspense>
          <HashtagSidebar spaceId={id} />
        </Suspense>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-800">{space.name}</h1>
            <p className="text-xs text-gray-400">
              {space._count.members} member{space._count.members !== 1 ? "s" : ""}
              {space.description ? ` · ${space.description}` : ""}
            </p>
          </div>
          <InviteButton inviteCode={space.inviteCode} />
        </div>

        <Suspense>
          <Feed initialPosts={posts} initialNextCursor={nextCursor} spaceId={id} />
        </Suspense>
      </div>
    </div>
  );
}
