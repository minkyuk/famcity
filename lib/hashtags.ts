/**
 * Extract unique lowercase hashtags from post content.
 * Matches #word (letters, digits, underscores), minimum 2 chars after #.
 */
export function extractHashtags(content: string): string[] {
  const matches = content.match(/#[a-zA-Z][a-zA-Z0-9_]{1,49}/g) ?? [];
  return [...new Set(matches.map((t) => t.slice(1).toLowerCase()))];
}
