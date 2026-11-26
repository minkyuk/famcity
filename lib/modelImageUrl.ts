/**
 * The URL a photo is sent to the model under. The model reads only JPEG, PNG, GIF and WebP — an
 * iPhone's HEIC photo made the whole call fail ("The file format is invalid or unsupported"). A
 * Cloudinary image in another format is asked for as a JPEG at most 1568px on a side (Cloudinary
 * converts on delivery; the model scales anything larger down anyway). Every other URL —
 * including Cloudinary images the model can already read — is sent exactly as stored.
 *
 * Only the sent URL changes: the per-photo use count (photoKey) stays keyed by the stored URL.
 */
const CLOUDINARY_IMAGE = /^(https:\/\/res\.cloudinary\.com\/[^/?#]+\/image\/upload\/)([^?#]+)(.*)$/;
const UNREADABLE_EXTENSION = /\.(heic|heif|avif|tiff?|bmp)$/i;

export function modelImageUrl(url: string): string {
  return cloudinaryAsJpeg(url, UNREADABLE_EXTENSION, "c_limit,w_1568,h_1568");
}

/**
 * A Cloudinary image whose extension matches `convert`, asked for as a JPEG with `transform`
 * applied (Cloudinary converts on delivery). Any other URL is returned exactly as given.
 */
export function cloudinaryAsJpeg(url: string, convert: RegExp, transform: string): string {
  const m = url.match(CLOUDINARY_IMAGE);
  if (!m || !convert.test(m[2])) return url;
  const [, base, path, rest] = m;
  return `${base}${transform}/${path.replace(convert, ".jpg")}${rest}`;
}
