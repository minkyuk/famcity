import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const space = req.nextUrl.searchParams.get("space") ?? "FamCity";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 80, marginBottom: 24 }}>🏡</div>
        <div style={{ fontSize: 42, fontWeight: 700, color: "#ea580c", textAlign: "center", maxWidth: 800, padding: "0 40px" }}>
          You&apos;re invited to join
        </div>
        <div style={{ fontSize: 52, fontWeight: 800, color: "#1f2937", textAlign: "center", maxWidth: 800, padding: "8px 40px 0" }}>
          {space}
        </div>
        <div style={{ fontSize: 22, color: "#9ca3af", marginTop: 24 }}>
          FamCity · Family social feed
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
