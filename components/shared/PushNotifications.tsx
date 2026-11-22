"use client";

import { useToast } from "./Toast";
import { usePush } from "./usePush";

/**
 * The header's "Enable notifications" button. Shown only while this device has never been asked,
 * or the browser blocks notifications; once they are on — or the person switched them off in
 * Settings — it stays out of the way. The Settings page has the on/off switch.
 */
export function PushNotifications() {
  const { showToast } = useToast();
  const { state, switchedOff, ready, busy, enable } = usePush();

  if (!ready || state === "unsupported" || state === "on" || switchedOff) return null;

  const request = async () => {
    try {
      const after = await enable();
      if (after === "on") showToast("Notifications enabled!");
      else if (after === "blocked") showToast("Notifications blocked", "error");
    } catch {
      showToast("Could not enable notifications", "error");
    }
  };

  return (
    <button
      onClick={request}
      disabled={busy || state === "blocked"}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
      title={state === "blocked" ? "Notifications blocked — enable in browser settings" : "Get notified when family posts"}
    >
      🔔
      <span className="hidden sm:inline">{state === "blocked" ? "Blocked" : "Enable notifications"}</span>
    </button>
  );
}
