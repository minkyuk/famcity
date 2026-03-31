import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Feed } from "@/app/Feed";
import { InviteButton } from "@/components/spaces/InviteButton";
import { HashtagSidebar } from "@/components/shared/HashtagSidebar";
import { OnlineWidget } from "@/components/shared/OnlineWidget";
import { SpaceMembersWidget } from "@/components/spaces/SpaceMembersWidget";
import { AgentActivityTrigger } from "@/components/spaces/AgentActivityTrigger";
import { InlineComposeCard } from "@/components/shared/InlineComposeCard";
import { SpaceHotButton } from "@/components/spaces/SpaceHotButton";
import { DeleteSpaceButton } from "@/components/spaces/DeleteSpaceButton";
import { EditSpaceButton } from "@/components/spaces/EditSpaceButton";
import { AddAgentButton } from "@/components/spaces/AddAgentButton";
import { isAdmin } from "@/lib/admin";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const [space, spaceMembers] = await Promise.all([
    prisma.space.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    }),
    prisma.spaceMember.findMany({
      where: { spaceId: id },
      include: { user: { select: { id: true, name: true, image: true } } },
      orderBy: { joinedAt: "asc" },
    }),
  ]);
  if (!space) notFound();

  // System spaces are open to all; regular spaces require membership
  if (!space.isSystem) {
    const membership = await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: session.user.id, spaceId: id } },
    });
    if (!membership) notFound();
  }

  const posts = await prisma.post.findMany({
    take: 20,
    where: {
      AND: [
        { spaceId: id },
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
  const isAgentSpace = space.name === "The Curiosity Den";

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <aside className="hidden lg:block w-48 shrink-0 pt-1 flex flex-col gap-4">
        {space.isSystem ? (
          <OnlineWidget />
        ) : (
          <SpaceMembersWidget
            spaceId={id}
            members={spaceMembers.map((m) => ({
              userId: m.user.id,
              name: m.user.name ?? "?",
              image: m.user.image ?? null,
            }))}
          />
        )}
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
            {space.purpose && (
              <p className="text-[11px] text-orange-400 mt-0.5">🎯 {space.purpose}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SpaceHotButton spaceId={id} />
            {!space.isSystem && <InviteButton inviteCode={space.inviteCode} />}
            {!space.isSystem && <AddAgentButton spaceId={id} />}
            {!space.isSystem && (
              <EditSpaceButton spaceId={id} currentDescription={space.description ?? null} currentPurpose={space.purpose ?? null} />
            )}
            {!space.isSystem && (
              <DeleteSpaceButton spaceId={id} spaceName={space.name} />
            )}
          </div>
        </div>

        {/* Trigger agent activity when viewing the Curiosity Den */}
        {isAgentSpace && <AgentActivityTrigger />}

        {!isAgentSpace && <InlineComposeCard defaultSpaceId={id} />}

        <Suspense>
          <Feed initialPosts={posts} initialNextCursor={nextCursor} spaceId={id} isAdmin={isAdmin(session)} />
        </Suspense>
      </div>
    </div>
  );
}
