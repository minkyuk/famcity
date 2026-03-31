export interface RssItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
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
// Balanced mix of four major outlets
export const NEWS_FEEDS = [
  // BBC
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.bbci.co.uk/news/technology/rss.xml",
  // Al Jazeera
  "https://www.aljazeera.com/xml/rss/all.xml",
  // CNN
  "http://rss.cnn.com/rss/edition.rss",
  // Fox News
  "https://feeds.foxnews.com/foxnews/latest",
];

export const SCIENCE_FEEDS = [
  "https://www.sciencedaily.com/rss/all.xml",
  "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
];
