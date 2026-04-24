import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { JoinClient } from "./JoinClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const space = await prisma.space.findUnique({
    where: { inviteCode: code },
    select: { name: true },
  });

  const spaceName = space?.name ?? "FamCity";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://famcity.vercel.app";
  const ogImageUrl = `${appUrl}/api/og?space=${encodeURIComponent(spaceName)}`;

  return {
    title: `Join ${spaceName} on FamCity`,
    description: `You've been invited to join ${spaceName} — a private family space on FamCity.`,
    openGraph: {
      title: `Join ${spaceName} on FamCity`,
      description: `You've been invited to join ${spaceName} — a private family space on FamCity.`,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `Join ${spaceName} on FamCity`,
      images: [ogImageUrl],
    },
  };
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <JoinClient code={code} />;
}
