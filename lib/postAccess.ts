import { prisma } from "@/lib/prisma";

/**
 * Returns the post if the user can access it (global post or member of the post's space).
 * Returns null if the post doesn't exist or the user isn't allowed to see it.
 */
export async function getAccessiblePost(postId: string, userId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return null;

  // Global posts are visible to all authenticated users
  if (!post.spaceId) return post;

  // Space posts require membership
  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId: post.spaceId } },
  });
  return membership ? post : null;
}
