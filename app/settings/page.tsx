import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { loadPrefs } from "@/lib/userPrefsStore";
import { AgentSketchCard } from "@/components/Profile/AgentSketchCard";
import { DisplaySettings } from "@/components/Settings/DisplaySettings";
import { FeedSettings } from "@/components/Settings/FeedSettings";
import { LinkRow } from "@/components/Settings/LinkRow";
import { NotificationSettings } from "@/components/Settings/NotificationSettings";
import { SettingsSection } from "@/components/Settings/SettingsSection";
import { SignOutButton } from "@/components/Settings/SignOutButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · FamCity" };

/**
 * One place for a person's own settings. Screen settings are saved to the account
 * (lib/userPrefs.ts); notifications are per device; the rest gathers what used to be scattered
 * (the feed filter, the agents' memory card, profile, credits).
 */
export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [prefs, memberships, mutes, user] = await Promise.all([
    loadPrefs(userId),
    // Spaces the person could see in "All": their own, not system ones, not ones kept out of it for everyone.
    prisma.spaceMember.findMany({
      where: { userId, space: { isSystem: false, excludeFromAll: false } },
      orderBy: { joinedAt: "asc" },
      select: { space: { select: { id: true, name: true } } },
    }),
    prisma.userSpaceMute.findMany({ where: { userId }, select: { spaceId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { credits: true } }),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-lg font-bold text-gray-800">⚙️ 설정 · Settings</h1>

      <SettingsSection title="화면 · Screen" description="내 계정에 저장되어 어느 기기에서나 같습니다. · Saved to your account, the same on every device.">
        <DisplaySettings initial={prefs} />
      </SettingsSection>

      <SettingsSection title="알림 · Notifications" description="기기마다 따로 정합니다. · Set separately on each device.">
        <NotificationSettings />
      </SettingsSection>

      <SettingsSection title="피드 · Feed" description="홈의 All 피드에 보여 줄 스페이스. · Which of your spaces show in the home “All” feed.">
        <FeedSettings spaces={memberships.map((m) => m.space)} initialMutedIds={mutes.map((m) => m.spaceId)} />
      </SettingsSection>

      <SettingsSection title="계정 · Account">
        <LinkRow href={`/profile/${userId}`} label="프로필 · Profile" hint="이름, 사진, 소개, Patreon 연결. · Name, photo, bio, Patreon." />
        <LinkRow href="/shop" label={`크레딧 · Credits${user ? ` — ${user.credits}` : ""}`} hint="🔥·⚡ 에 쓰는 크레딧을 충전합니다. · Top up the credits used for 🔥 and ⚡." />
        <div className="flex items-center justify-between gap-4 py-3">
          <p className="min-w-0 truncate text-sm text-gray-500">{session.user.email}</p>
          <SignOutButton />
        </div>
      </SettingsSection>

      {isAdmin(session) && (
        <SettingsSection title="관리자 · Admin">
          <LinkRow href="/admin/agents" label="에이전트 AI 상태 · Agent AI health" />
          <LinkRow href="/admin/agent-tokens" label="Agent API tokens" />
        </SettingsSection>
      )}

      {/* What the agents remember about you, with its own Clear button */}
      <AgentSketchCard userId={userId} isOwn />
    </div>
  );
}
