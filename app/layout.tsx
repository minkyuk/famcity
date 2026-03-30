import type { Metadata } from "next";
import "./globals.css";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SessionProvider } from "@/components/shared/SessionProvider";
import { ToastProvider } from "@/components/shared/Toast";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { PushNotifications } from "@/components/shared/PushNotifications";
import { UserMenu } from "@/components/shared/UserMenu";
import { SpaceSwitcher } from "@/components/shared/SpaceSwitcher";
import { PostButton } from "@/components/shared/PostButton";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { WalkingCat } from "@/components/shared/WalkingCat";
import { MusicWidget } from "@/components/shared/MusicWidget";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FamCity",
  description: "Our family feed",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en">
      <body>
        <SessionProvider session={session}>
          <ToastProvider>
            <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-100">
              <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
                <Link href="/" className="text-xl font-bold text-accent shrink-0">
                  🏡 FamCity
                </Link>
                {session && <SpaceSwitcher />}
                <div className="flex items-center gap-2 ml-auto">
                  {session && (
                    <>
                      <PushNotifications />
                      <NotificationBell />
                      <PostButton />
                    </>
                  )}
                  <UserMenu />
                </div>
              </div>
            </header>
            <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
            <ChatWidget />
            <MusicWidget />
            <WalkingCat />
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
