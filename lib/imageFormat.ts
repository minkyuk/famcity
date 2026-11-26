/**
 * What a photo file really is, read from its first bytes — a file's name and the type the browser
 * reports say nothing reliable about it (an iPhone photo stored as .heic got past an upload check
 * that allows only JPEG, PNG, GIF and WebP). Pure: used by the upload route and the admin photo
 * check alike.
 */

export type BrowserSupport = "all" | "safari_only" | "none" | "unknown";

/** Reads the format from a file's first bytes (64 are plenty). */
export function sniffFormat(head: Uint8Array): string | null {
  const at = (i: number) => head[i] ?? -1;
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(head.slice(from, to)));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(0, 2) === "BM") return "bmp";
  if (ascii(0, 4) === "II*\0" || ascii(0, 4) === "MM\0*") return "tiff";
  if (ascii(0, 4) === "%PDF") return "pdf";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "heic";
    return `isobmff:${brand.trim()}`;
  }
  if (/^\s*</.test(ascii(0, 16))) return "html_or_xml";
  return head.length === 0 ? null : "unknown";
}

/** Which browsers can show this format in an <img>. */
export function browserSupport(format: string | null): BrowserSupport {
  if (!format) return "unknown";
  if (["jpeg", "png", "gif", "webp", "avif", "bmp"].includes(format)) return "all";
  if (format === "heic" || format === "tiff") return "safari_only";
  if (format === "html_or_xml") return "none";
  return "unknown";
}

/**
 * Photo formats stored as a JPEG on upload: HEIC and TIFF show only in Safari, and the model reads
 * none of these four. JPEG, PNG, GIF and WebP are kept as they are.
 */
export const STORE_AS_JPEG = new Set(["heic", "tiff", "avif", "bmp"]);
