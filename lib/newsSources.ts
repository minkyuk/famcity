import { storyKeywords } from "@/lib/newsFormat";

/**
 * Where Family News comes from.
 *
 * Every outlet has a political colour, so no single one is trusted to set the agenda: stories are
 * drawn from outlets across the range, in English and in Korean, and the candidate list is
 * balanced so that no outlet and no leaning dominates a run (pickBalanced below).
 *
 * `lean` is the outlet's commonly described editorial leaning. It is used ONLY to balance the
 * candidate list — it is never shown in a post and never passed to a model.
 *
 * MBC is deliberately absent (owner's decision) — do not add it back.
 *
 * Tried and dropped after live dry runs (2026-11): KBS World (answers, but with no items) and
 * 한국경제 (403 to any reader identity).
 *
 * Feeds die and move without notice. `GET /api/agents/news?dry=1` reports what each one returned;
 * prune or fix entries from that report rather than from memory.
 */
export type Lean = "left" | "center" | "right";
export type NewsSource = { name: string; url: string; lean: Lean };

export const GLOBAL_SOURCES: NewsSource[] = [
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", lean: "left" },
  { name: "NPR", url: "https://feeds.npr.org/1001/rss.xml", lean: "left" },
  { name: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", lean: "left" },

  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", lean: "center" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/business/rss.xml", lean: "center" },
  { name: "CNBC", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", lean: "center" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", lean: "center" },
  { name: "Bloomberg", url: "https://feeds.bloomberg.com/markets/news.rss", lean: "center" },

  { name: "Fox News", url: "https://moxie.foxnews.com/google-publisher/world.xml", lean: "right" },
  { name: "The Wall Street Journal", url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews", lean: "right" },
  { name: "New York Post", url: "https://nypost.com/news/feed/", lean: "right" },
  { name: "The Washington Times", url: "https://www.washingtontimes.com/rss/headlines/news/world/", lean: "right" },
];

export const KOREAN_SOURCES: NewsSource[] = [
  { name: "연합뉴스", url: "https://www.yna.co.kr/rss/news.xml", lean: "center" },
  { name: "SBS", url: "https://news.sbs.co.kr/news/headlineRssFeed.do?plink=RSSREADER", lean: "center" },
  { name: "뉴시스", url: "https://www.newsis.com/RSS/sokbo.xml", lean: "center" },

  { name: "한겨레", url: "https://www.hani.co.kr/rss/", lean: "left" },
  { name: "경향신문", url: "https://www.khan.co.kr/rss/rssdata/total_news.xml", lean: "left" },
  { name: "오마이뉴스", url: "https://rss.ohmynews.com/rss/ohmynews.xml", lean: "left" },

  { name: "조선일보", url: "https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml", lean: "right" },
  { name: "동아일보", url: "https://rss.donga.com/total.xml", lean: "right" },
  { name: "매일경제", url: "https://www.mk.co.kr/rss/30000001/", lean: "right" },
];

type Balanceable = { title: string; sourceName: string; lean: Lean };
export type Balanced<T> = { story: T; others: T[] };

/**
 * Stricter than isSameStory on purpose. Grouping two reports puts one outlet's summary into the
 * other's brief and cites it under the post, so a wrong match would mix up two events; missing a
 * match only means a story isn't marked as widely carried. Three shared keywords are needed, and
 * they must be most of the shorter headline.
 */
function sameEvent(a: { title: string; keys: Set<string> }, b: { title: string; keys: Set<string> }): boolean {
  if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase()) return true;
  let overlap = 0;
  for (const w of a.keys) if (b.keys.has(w)) overlap++;
  return overlap >= 3 && overlap >= 0.6 * Math.min(a.keys.size, b.keys.size);
}

/**
 * Picks up to `max` stories from `stories` (already in priority order) so that the list is spread
 * across outlets and leanings:
 *
 * 1. Reports of the same event by different outlets are grouped. A story several outlets carry
 *    goes first — agreement across outlets is the best sign that it matters — and the others'
 *    reports come back in `others`, so the post can cite them and the brief can cross-check facts.
 * 2. For a grouped story, the version used is the one from the leaning (then outlet) that has
 *    been picked least so far, and among equals the outlet with the fewest other stories.
 * 3. Stories only one outlet carries are added one per outlet, then two per outlet, and so on,
 *    with no leaning taking more than a third of the list while others still have stories.
 *
 * `known` carries what a model said about the headlines (see groupPrompt): `linked` are groups of
 * indexes into `stories` that are the same event even though the words differ, and `exclude` are
 * indexes of stories already posted — the whole event they belong to is dropped.
 */
export function pickBalanced<T extends Balanceable>(
  stories: T[],
  max: number,
  known: { linked?: number[][]; exclude?: number[] } = {},
): Balanced<T>[] {
  // Union-find over story indexes: keyword matches and the model's links both join events.
  const parent = stories.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const entries = stories.map((item) => ({ title: item.title, keys: storyKeywords(item.title) }));
  for (let i = 1; i < stories.length; i++) {
    for (let j = 0; j < i; j++) {
      if (find(i) !== find(j) && sameEvent(entries[i], entries[j])) parent[find(i)] = find(j);
    }
  }
  for (const group of known.linked ?? []) {
    const valid = group.filter((i) => Number.isInteger(i) && i >= 0 && i < stories.length);
    for (let k = 1; k < valid.length; k++) parent[find(valid[k])] = find(valid[0]);
  }
  const dropped = new Set((known.exclude ?? []).filter((i) => i >= 0 && i < stories.length).map(find));

  type Group = { members: { item: T }[] };
  const byRoot = new Map<number, Group>();
  const groups: Group[] = [];
  stories.forEach((item, i) => {
    const root = find(i);
    if (dropped.has(root)) return;
    let group = byRoot.get(root);
    if (!group) { group = { members: [] }; byRoot.set(root, group); groups.push(group); }
    // One report per outlet: an outlet repeating itself adds nothing.
    if (!group.members.some((m) => m.item.sourceName === item.sourceName)) group.members.push({ item });
  });

  const offered = new Map<string, number>();
  for (const item of stories) offered.set(item.sourceName, (offered.get(item.sourceName) ?? 0) + 1);

  const picked: Balanced<T>[] = [];
  const byOutlet = new Map<string, number>();
  const byLean = new Map<Lean, number>();
  const count = <K,>(map: Map<K, number>, key: K) => map.get(key) ?? 0;
  const take = (group: Group, story: T) => {
    picked.push({ story, others: group.members.map((m) => m.item).filter((m) => m !== story) });
    byOutlet.set(story.sourceName, count(byOutlet, story.sourceName) + 1);
    byLean.set(story.lean, count(byLean, story.lean) + 1);
  };

  // 1–2. Stories carried by several outlets, most widely carried first.
  const shared = groups.filter((g) => g.members.length > 1).sort((a, b) => b.members.length - a.members.length);
  for (const group of shared) {
    if (picked.length >= max) return picked;
    const members = group.members.map((m) => m.item);
    // Least-used leaning, then least-used outlet, then the outlet with the least else to offer
    // (so an outlet with many stories of its own keeps its turn for one of those).
    const rank = (m: T) => [count(byLean, m.lean), count(byOutlet, m.sourceName), count(offered, m.sourceName)];
    const story = members.reduce((best, m) => {
      const a = rank(m);
      const b = rank(best);
      const firstDiff = a.findIndex((v, i) => v !== b[i]);
      return firstDiff !== -1 && a[firstDiff] < b[firstDiff] ? m : best;
    });
    take(group, story);
  }

  // 3. Single-outlet stories, a widening allowance per outlet, leanings kept even.
  const remaining = groups.filter((g) => g.members.length === 1);
  const leanCap = Math.ceil(max / 3);
  for (const respectLean of [true, false]) {
    for (let perOutlet = 1; picked.length < max && remaining.length > 0; perOutlet++) {
      let added = 0;
      for (let i = 0; i < remaining.length && picked.length < max; ) {
        const story = remaining[i].members[0].item;
        const fits = count(byOutlet, story.sourceName) < perOutlet && (!respectLean || count(byLean, story.lean) < leanCap);
        if (!fits) { i++; continue; }
        take(remaining[i], story);
        remaining.splice(i, 1);
        added++;
      }
      // Nothing fits at this allowance and a bigger one wouldn't help either: stop this pass.
      if (added === 0 && !remaining.some((g) => !respectLean || count(byLean, g.members[0].item.lean) < leanCap)) break;
      if (added === 0 && perOutlet > stories.length) break;
    }
  }
  return picked;
}
