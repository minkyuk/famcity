import { displayImageUrl } from "@/lib/displayImageUrl";
import { browserSupport, sniffFormat, type BrowserSupport } from "@/lib/imageFormat";
import { prisma } from "@/lib/prisma";

/**
 * Photo check for the admin status endpoint (`?images=1`): why does a photo not show on the site?
 * For the newest photo posts it fetches each file the way a browser would and reports what came
 * back — HTTP status, size, Cloudinary's own error header, and the real format read from the first
 * bytes (a .jpg name says nothing about what is inside). Browsers other than Safari can't show
 * HEIC or TIFF, so a format can be fine on an iPhone and blank on a computer.
 *
 * Never returns a photo URL or any post text — only the host, the format, the space's name and
 * the post id, so the endpoint stays a monitoring tool and not a way to read members-only posts.
 */

export type ImageCheck = {
  space: string;
  postId: string;
  postedAt: string;
  /** "media" for an uploaded photo row, "mediaUrl" for the older single-photo field. */
  source: "media" | "mediaUrl";
  host: string;
  /** Extension in the URL path, as named (not what the file is). */
  ext: string | null;
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  /** The format the first bytes say the file is. */
  sniffed: string | null;
  browsers: BrowserSupport;
  /** Cloudinary's explanation when it refuses a file (x-cld-error). */
  cldError: string | null;
  /** Why the file could not be fetched at all (timeout, network), or why it wasn't tried. */
  error: string | null;
  /** For a file not every browser can show: what the site's converted URL (displayImageUrl) returns. */
  shownAs?: { status: number | null; sniffed: string | null; browsers: BrowserSupport; error: string | null };
};

export type ImageHealth = {
  checkedAt: string;
  spaceFilter: string | null;
  /** Photo posts with no file attached at all — they render as text only. */
  imagePostsWithoutFiles: { space: string; postId: string; postedAt: string }[];
  /** Hosts of links in text posts that look like images or photo-sharing pages (a link is not shown as a photo). */
  imageLinksInTextPosts: { space: string; postId: string; hosts: string[] }[];
  checks: ImageCheck[];
  summary: Record<string, number>;
};

const MAX_FILES = 40;
const PARALLEL = 8;
const FETCH_MS = 5000;

const IMAGE_LINK = /https?:\/\/[^\s)]+/gi;
const IMAGE_LIKE = /\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?|bmp)(\?|$)|photos\.app\.goo\.gl|photos\.google\.com|kakaocdn|kakao\.com|icloud\.com|drive\.google\.com|dropbox/i;

const extOf = (url: URL) => url.pathname.match(/\.([A-Za-z0-9]{2,5})$/)?.[1]?.toLowerCase() ?? null;

/** Only files on Cloudinary are fetched: they are ours, and anything else is not this check's to open. */
const fetchable = (url: URL) => url.protocol === "https:" && url.hostname === "res.cloudinary.com";

async function checkOne(raw: string, base: Omit<ImageCheck, "host" | "ext" | "status" | "contentType" | "bytes" | "sniffed" | "browsers" | "cldError" | "error">): Promise<ImageCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ...base, host: "(not a URL)", ext: null, status: null, contentType: null, bytes: null, sniffed: null, browsers: "none", cldError: null, error: "not_a_url" };
  }
  const known = { ...base, host: url.hostname, ext: extOf(url) };
  if (!fetchable(url)) {
    return { ...known, status: null, contentType: null, bytes: null, sniffed: null, browsers: "unknown", cldError: null, error: url.protocol === "https:" ? "not_cloudinary_not_fetched" : `not_https (${url.protocol})` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-63" }, redirect: "follow", signal: controller.signal, cache: "no-store" });
    const reader = res.body?.getReader();
    const first = reader ? await reader.read() : { value: undefined };
    void reader?.cancel().catch(() => undefined);
    const head = first.value ?? new Uint8Array();
    const range = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
    const length = res.headers.get("content-length");
    const sniffed = res.ok ? sniffFormat(head) : null;
    return {
      ...known,
      status: res.status,
      contentType: res.headers.get("content-type"),
      bytes: range ? Number(range) : length && res.status === 200 ? Number(length) : null,
      sniffed,
      browsers: res.ok ? browserSupport(sniffed) : "none",
      cldError: res.headers.get("x-cld-error"),
      error: null,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return { ...known, status: null, contentType: null, bytes: null, sniffed: null, browsers: "unknown", cldError: null, error: timedOut ? "timeout" : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** `spaceName` narrows to spaces whose name contains it (ignoring case); `days` is how far back to look. */
export async function checkRecentImages(opts: { spaceName: string | null; days: number }): Promise<ImageHealth> {
  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);
  const spaceWhere = opts.spaceName ? { space: { name: { contains: opts.spaceName, mode: "insensitive" as const } } } : {};

  const [imagePosts, textPosts] = await Promise.all([
    prisma.post.findMany({
      where: { type: "IMAGE", createdAt: { gte: since }, ...spaceWhere },
      orderBy: { createdAt: "desc" },
      take: MAX_FILES,
      select: { id: true, createdAt: true, mediaUrl: true, space: { select: { name: true } }, media: { orderBy: { order: "asc" }, select: { url: true } } },
    }),
    prisma.post.findMany({
      where: { type: "TEXT", createdAt: { gte: since }, content: { contains: "http" }, ...spaceWhere },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, content: true, space: { select: { name: true } } },
    }),
  ]);

  const files: { url: string; base: Omit<ImageCheck, "host" | "ext" | "status" | "contentType" | "bytes" | "sniffed" | "browsers" | "cldError" | "error"> }[] = [];
  const withoutFiles: ImageHealth["imagePostsWithoutFiles"] = [];
  for (const p of imagePosts) {
    const space = p.space?.name ?? "(no space)";
    const base = { space, postId: p.id, postedAt: p.createdAt.toISOString() };
    if (p.media.length > 0) for (const m of p.media) files.push({ url: m.url, base: { ...base, source: "media" } });
    else if (p.mediaUrl) files.push({ url: p.mediaUrl, base: { ...base, source: "mediaUrl" } });
    else withoutFiles.push(base);
  }

  const links: ImageHealth["imageLinksInTextPosts"] = [];
  for (const p of textPosts) {
    const hosts = new Set<string>();
    for (const m of (p.content ?? "").matchAll(IMAGE_LINK)) {
      if (!IMAGE_LIKE.test(m[0])) continue;
      try {
        hosts.add(new URL(m[0]).hostname);
      } catch {
        /* not a URL after all */
      }
    }
    if (hosts.size > 0) links.push({ space: p.space?.name ?? "(no space)", postId: p.id, hosts: [...hosts] });
  }

  const checks = await inBatches(files.slice(0, MAX_FILES), PARALLEL, async (f) => {
    const check = await checkOne(f.url, f.base);
    const shown = displayImageUrl(f.url);
    if (check.browsers === "all" || shown === f.url) return check;
    const s = await checkOne(shown, f.base);
    return { ...check, shownAs: { status: s.status, sniffed: s.sniffed, browsers: s.browsers, error: s.cldError ?? s.error } };
  });
  const summary: Record<string, number> = {};
  for (const c of checks) {
    const key = c.status === null ? `no_answer:${c.error}` : c.status >= 400 ? `http_${c.status}` : `${c.sniffed ?? "unknown"}:${c.browsers}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return { checkedAt: new Date().toISOString(), spaceFilter: opts.spaceName, imagePostsWithoutFiles: withoutFiles, imageLinksInTextPosts: links, checks, summary };
}
