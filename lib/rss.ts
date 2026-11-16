export interface RssItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source?: string;
}

/** Fetch and parse an RSS feed, returning up to `limit` items. No dependencies — pure fetch + regex. */
export async function fetchRss(url: string, limit = 10): Promise<RssItem[]> {
  const res = await fetch(url, {
    // A plain reader identity: some outlets answer 403 to an unfamiliar product name.
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)", Accept: "application/rss+xml, application/xml, text/xml, */*" },
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(8000), // one stalled feed must not hold up a run that reads twenty
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const xml = await res.text();

  const items: RssItem[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/g; // some feeds put attributes on <item>
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

// News feeds (global and Korean) live in lib/newsSources.ts, with each outlet's name and leaning.

export const SCIENCE_FEEDS = [
  "https://www.sciencedaily.com/rss/all.xml",
  "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
];
