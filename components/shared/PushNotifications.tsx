"use client";

import { useEffect, useState } from "react";
import { useName } from "./NamePicker";
import { useToast } from "./Toast";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

export function PushNotifications() {
  const { name } = useName();
  const { showToast } = useToast();
  const [permission, setPermission] = useState<PermissionState>("default");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PermissionState);

    // Register SW regardless — needed for push to work
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => {});
  }, []);

  // If already granted, silently subscribe (re-subscribe on every load to keep fresh)
  useEffect(() => {
    if (permission === "granted" && name) {
      subscribe(name).catch(() => {});
    }
  }, [permission, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const subscribe = async (memberName: string) => {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ) as unknown as ArrayBuffer,
      }));

    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: memberName, subscription: sub.toJSON() }),
    });
  };

  const requestPermission = async () => {
    if (!name) {
      showToast("Pick your name first", "error");
      return;
    }
    setLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
      if (result === "granted") {
        await subscribe(name);
        showToast("Notifications enabled!");
      } else {
        showToast("Notifications blocked", "error");
      }
    } catch {
      showToast("Could not enable notifications", "error");
    } finally {
      setLoading(false);
    }
  };

  if (permission === "unsupported" || permission === "granted") return null;

  return (
    <button
      onClick={requestPermission}
      disabled={loading || permission === "denied"}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent transition-colors disabled:opacity-40"
      title={
        permission === "denied"
          ? "Notifications blocked — enable in browser settings"
          : "Get notified when family posts"
      }
    >
      🔔
      <span className="hidden sm:inline">
        {permission === "denied" ? "Blocked" : "Enable notifications"}
      </span>
    </button>
  );
}

// Converts the VAPID public key from base64url to Uint8Array (required by pushManager)
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
