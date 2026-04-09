import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName || !url.startsWith(`https://res.cloudinary.com/${cloudName}/`)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch {
    return NextResponse.json({ error: "Failed to fetch file" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: "File not found" }, { status: upstream.status });
  }

  const rawFilename = url.split("/").pop() ?? "document.pdf";
  const filename = decodeURIComponent(rawFilename);

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
