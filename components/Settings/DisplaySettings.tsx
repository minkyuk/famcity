"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { stopMusic } from "@/components/shared/MusicWidget";
import { useToast } from "@/components/shared/Toast";
import type { UserPrefs } from "@/lib/userPrefs";
import { ToggleRow } from "./ToggleRow";

/** What floats on the screen: the cat and the dog, and the music button. Saved to the account. */
export function DisplaySettings({ initial }: { initial: UserPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState<keyof UserPrefs | null>(null);
  const { showToast } = useToast();
  const router = useRouter();

  const set = async (key: keyof UserPrefs, value: boolean) => {
    if (saving) return; // one change at a time (both switches wait while one is being saved)
    setPrefs((p) => ({ ...p, [key]: value }));
    setSaving(key);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: { prefs: UserPrefs } = await res.json();
      setPrefs(data.prefs);
      if (key === "music" && !value) stopMusic();
      router.refresh(); // the layout shows or hides it right away
    } catch {
      setPrefs((p) => ({ ...p, [key]: !value }));
      showToast("Could not save the setting · 저장하지 못했습니다", "error");
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <ToggleRow
        label="🐱🐶 고양이와 강아지 · Cat & dog"
        hint="화면을 돌아다니는 고양이와 강아지를 보여 줍니다. · The cat and dog that roam the screen."
        checked={prefs.pets}
        disabled={saving !== null}
        onChange={(v) => set("pets", v)}
      />
      <ToggleRow
        label="🎵 음악 버튼 · Music button"
        hint="왼쪽 아래의 음악 플레이어. 끄면 재생 중인 음악도 멈춥니다. · The player at the bottom left; turning it off also stops the music."
        checked={prefs.music}
        disabled={saving !== null}
        onChange={(v) => set("music", v)}
      />
    </>
  );
}
