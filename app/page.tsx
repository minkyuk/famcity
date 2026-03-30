import { prisma } from "@/lib/prisma";
import { Feed } from "./Feed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const posts = await prisma.post.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
    include: {
      reactions: true,
      comments: { orderBy: { createdAt: "asc" } },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  const nextCursor = posts.length === 20 ? posts[posts.length - 1].id : null;

  return <Feed initialPosts={posts} initialNextCursor={nextCursor} />;
}
