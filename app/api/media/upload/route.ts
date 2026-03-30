import { NextRequest, NextResponse } from "next/server";
import { cloudinary } from "@/lib/cloudinary";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-m4a", "audio/aac", "application/pdf"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const resourceType = file.type.startsWith("audio/") ? "video" : "image";

  let result: { secure_url: string; public_id: string };
  try {
    result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            { folder: "famcity", resource_type: resourceType },
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
