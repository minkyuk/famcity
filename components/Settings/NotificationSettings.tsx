"use client";

import { useToast } from "@/components/shared/Toast";
import { usePush, type PushState } from "@/components/shared/usePush";
import { ToggleRow } from "./ToggleRow";

const HINTS: Record<PushState, string> = {
  on: "가족이 새 글을 올리면 이 기기로 알려 드립니다. · You are notified on this device when family posts.",
  off: "꺼져 있습니다. 켜면 브라우저가 허용 여부를 물을 수 있습니다. · Off. Turning it on may ask for the browser's permission.",
  blocked: "브라우저에서 이 사이트의 알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 허용한 뒤 다시 켜 주세요. · Blocked in the browser — allow notifications for this site in the browser's settings first.",
  unsupported: "이 브라우저에서는 알림을 쓸 수 없습니다. · This browser can't show notifications.",
};

/** Notifications on this device (push is per device, so this choice is kept on the device). */
export function NotificationSettings() {
  const { state, ready, busy, enable, disable } = usePush();
  const { showToast } = useToast();

  const change = async (on: boolean) => {
    try {
      const after = on ? await enable() : await disable();
      if (on && after === "on") showToast("알림을 켰습니다 · Notifications on");
      else if (on && after === "blocked") showToast("브라우저가 알림을 차단했습니다 · Blocked by the browser", "error");
      else if (!on) showToast("알림을 껐습니다 · Notifications off");
    } catch {
      showToast("Could not change notifications · 변경하지 못했습니다", "error");
    }
  };

  return (
    <ToggleRow
      label="🔔 이 기기 알림 · Notifications on this device"
      hint={ready ? HINTS[state] : undefined}
      checked={state === "on"}
      disabled={!ready || busy || state === "unsupported" || state === "blocked"}
      onChange={change}
    />
  );
}
