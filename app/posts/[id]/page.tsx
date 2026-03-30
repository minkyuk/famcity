import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { PostCard } from "@/components/Feed/PostCard";

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      reactions: true,
      comments: { orderBy: { createdAt: "asc" } },
      media: { orderBy: { order: "asc" } },
      hashtags: { include: { hashtag: true } },
      _count: { select: { reactions: true, comments: true } },
    },
  });

  if (!post) notFound();

  return (
    <div className="flex flex-col gap-5">
      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
        ← Back to feed
      </Link>
      <PostCard
        post={post}
        currentUserId={session?.user.id ?? ""}
        currentUserName={session?.user.name ?? ""}
      />
    </div>
  );
}
