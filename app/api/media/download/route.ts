import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  // Accept any resource_type path (image/raw/video) and follow redirects
  const pattern = new RegExp(`^https?://res\\.cloudinary\\.com/${cloudName}/`);
  if (!pattern.test(url)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { redirect: "follow" });
  } catch {
    return NextResponse.json({ error: "Failed to fetch file" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: "File not found" }, { status: upstream.status });
  }

  // Buffer the entire body — more reliable than streaming in serverless environments
  const buffer = await upstream.arrayBuffer();

  // Derive filename from the URL path, stripping any query params
  const pathPart = url.split("?")[0];
  const rawFilename = pathPart.split("/").pop() ?? "document.pdf";
  const filename = decodeURIComponent(rawFilename).replace(/"/g, "");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
