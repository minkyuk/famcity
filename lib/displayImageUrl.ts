import { cloudinaryAsJpeg } from "@/lib/modelImageUrl";

/**
 * The URL a photo is shown under on the site. Browsers other than Safari can't show HEIC or TIFF:
 * an iPhone photo stored as .heic showed on the phone and was blank on every computer. A
 * Cloudinary photo in one of those formats is asked for as a JPEG, at most 2048px on a side
 * (Cloudinary converts on delivery, so photos already stored that way show too). Every other URL
 * is shown exactly as stored. Pure — used by client components.
 */
const BROWSERS_CANT_SHOW = /\.(heic|heif|tiff?)$/i;

export const displayImageUrl = (url: string): string => cloudinaryAsJpeg(url, BROWSERS_CANT_SHOW, "c_limit,w_2048,h_2048");
