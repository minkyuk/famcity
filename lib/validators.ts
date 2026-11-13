import { z } from "zod";

export const PostTypeSchema = z.enum(["TEXT", "IMAGE", "YOUTUBE", "AUDIO", "VIDEO", "PDF"]);

export const CreatePostSchema = z.object({
  content: z.string().max(2000).optional(),
  type: PostTypeSchema,
  mediaUrl: z.string().url().optional(),
  mediaUrls: z.array(z.string().url()).max(5).optional(),
  spaceId: z.string().optional(),
});

export const CreateCommentSchema = z.object({
  body: z.string().min(1).max(1000),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

/** GET /api/admin/agents/status query: `?ping=1` also runs a live 1-token API check. */
export const AgentStatusQuerySchema = z.object({
  ping: z.enum(["0", "1", "true", "false"]).optional().transform((v) => v === "1" || v === "true"),
});
