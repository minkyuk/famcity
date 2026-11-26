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
  /** `?images=1`: also check the newest photo files (lib/imageHealth.ts). */
  images: z.enum(["0", "1", "true", "false"]).optional().transform((v) => v === "1" || v === "true"),
  /** With images: only spaces whose name contains this. */
  space: z.string().trim().min(1).max(80).optional(),
  /** With images: how many days back (default 30). */
  days: z.coerce.number().int().min(1).max(365).optional(),
});

/** POST /api/translate body. 12k chars covers the longest agent/news posts (was 2,000, which silently rejected them). */
export const TRANSLATE_MAX_CHARS = 12000;
export const TranslateSchema = z.object({ text: z.string().trim().min(1).max(TRANSLATE_MAX_CHARS) });
