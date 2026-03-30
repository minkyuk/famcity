import type { Metadata } from "next";
import "./globals.css";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SessionProvider } from "@/components/shared/SessionProvider";
import { ToastProvider } from "@/components/shared/Toast";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { PushNotifications } from "@/components/shared/PushNotifications";
import { UserMenu } from "@/components/shared/UserMenu";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FamCity",
  description: "Our family feed",
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
              <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
                <Link href="/" className="text-xl font-bold text-accent">
                  🏡 FamCity
                </Link>
                <div className="flex items-center gap-2">
                  {session && (
                    <>
                      <PushNotifications />
                      <NotificationBell />
                      <Link
                        href="/compose"
                        className="bg-accent text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-orange-600 transition-colors"
                      >
                        + Post
                      </Link>
                    </>
                  )}
                  <UserMenu />
                </div>
              </div>
            </header>
            <main className="max-w-2xl mx-auto px-4 py-6">{children}</main>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
