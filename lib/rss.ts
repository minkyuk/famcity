export interface RssItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source?: string;
}

/** Map feed URL to a human-readable source name */
const FEED_SOURCE_NAMES: Record<string, string> = {
  "feeds.bbci.co.uk": "BBC News",
  "aljazeera.com": "Al Jazeera",
  "rss.cnn.com": "CNN",
  "feeds.foxnews.com": "Fox News",
  "sciencedaily.com": "Science Daily",
  "feeds.reuters.com": "Reuters",
  "rss.reuters.com": "Reuters",
  "feeds.finance.yahoo.com": "Yahoo Finance",
  "finance.yahoo.com": "Yahoo Finance",
  "cnbc.com": "CNBC",
  "marketwatch.com": "MarketWatch",
};

export function feedSourceName(url: string): string {
  for (const [domain, name] of Object.entries(FEED_SOURCE_NAMES)) {
    if (url.includes(domain)) return name;
  }
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Fetch and parse an RSS feed, returning up to `limit` items. No dependencies — pure fetch + regex. */
export async function fetchRss(url: string, limit = 10): Promise<RssItem[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "FamCity/1.0 RSS Reader" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const xml = await res.text();

  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const title = extract(block, "title");
    const description = extract(block, "description");
    const link = extract(block, "link") || extract(block, "guid");
    const pubDate = extract(block, "pubDate");
    if (title) items.push({ title, description, link, pubDate });
  }

  return items;
}

function extract(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

// Good free RSS feeds — no API key needed
// Mix of top global news + financial/markets coverage
export const NEWS_FEEDS = [
  // Reuters — top global news
  "https://feeds.reuters.com/reuters/topNews",
  // Reuters — business & finance
  "https://feeds.reuters.com/reuters/businessNews",
  // BBC World
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  // BBC Business
  "https://feeds.bbci.co.uk/news/business/rss.xml",
  // CNBC — markets
  "https://www.cnbc.com/id/10000664/device/rss/rss.html",
  // Yahoo Finance
  "https://finance.yahoo.com/news/rssindex",
];

export const SCIENCE_FEEDS = [
  "https://www.sciencedaily.com/rss/all.xml",
  "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
];
