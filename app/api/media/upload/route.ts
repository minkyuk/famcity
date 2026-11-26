import { NextRequest, NextResponse } from "next/server";
import { cloudinary } from "@/lib/cloudinary";
import { sniffFormat, STORE_AS_JPEG } from "@/lib/imageFormat";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // HEIC/HEIF is what an iPhone or a Samsung phone sends when it doesn't convert the photo itself;
  // it is accepted and stored as a JPEG (below).
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-m4a", "audio/aac", "application/pdf"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const resourceType = file.type.startsWith("audio/") || file.type.startsWith("video/") ? "video" : "image";
  // The reported type is not what the file is: an iPhone photo reported as an allowed type was
  // stored as .heic and was blank in every browser but Safari. A photo in a format browsers can't
  // all show (or the model can't read) is stored as a JPEG; Cloudinary converts it on upload.
  const format = resourceType === "image" ? sniffFormat(buffer.subarray(0, 64)) : null;
  const storeAsJpeg = format !== null && STORE_AS_JPEG.has(format);

  let result: { secure_url: string; public_id: string };
  try {
    result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            { folder: "famcity", resource_type: resourceType, ...(storeAsJpeg ? { format: "jpg" } : {}) },
            (error, res) => {
              if (error || !res) return reject(error ?? new Error("No result"));
              resolve(res);
            }
          )
          .end(buffer);
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cloudinary upload failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ url: result.secure_url, publicId: result.public_id });
}
