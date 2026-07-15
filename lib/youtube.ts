/**
 * Extract YouTube video ID from any common URL format:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://youtube.com/shorts/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 */
export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "youtu.be"
    ) {
      return parsed.pathname.slice(1) || null;
    }
    if (
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "www.youtube.com"
    ) {
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.replace("/shorts/", "") || null;
      }
      if (parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.replace("/embed/", "") || null;
      }
      return parsed.searchParams.get("v");
    }
    return null;
  } catch {
    return null;
  }
}

export function getEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

export function getThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Fetch a video's title + channel via YouTube's public oEmbed endpoint (no API key).
 * Used by agents so a captionless YouTube post still gives them something real to
 * react to. Cached per serverless instance; returns null on any failure.
 */
const titleCache = new Map<string, { title: string; author: string } | null>();

export async function fetchYouTubeTitle(url: string): Promise<{ title: string; author: string } | null> {
  const id = extractYouTubeId(url);
  const key = id ?? url;
  if (titleCache.has(key)) return titleCache.get(key) ?? null;

  let result: { title: string; author: string } | null = null;
  try {
    const watchUrl = id ? `https://www.youtube.com/watch?v=${id}` : url;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const data = (await res.json()) as { title?: string; author_name?: string };
      if (data.title) result = { title: data.title, author: data.author_name ?? "" };
    }
  } catch {
    // unavailable/private video, network error — agents fall back to the generic note
  }
  titleCache.set(key, result);
  return result;
}
