"use client";

import { useCallback, useEffect, useState } from "react";
import { useName } from "./NamePicker";

/** Notifications on this device: not available in this browser, blocked in its settings, off, or on. */
export type PushState = "unsupported" | "blocked" | "off" | "on";

/**
 * Set on a device where the person switched notifications off in Settings. Push is per device, so
 * the choice is kept on the device — and the header must not quietly subscribe it again.
 */
const OFF_KEY = "famcity_push_off";
const CHANGED = "famcity-push-changed";
/** How long to wait for the browser's service worker before giving up (it never comes if /sw.js couldn't load). */
const WORKER_WAIT_MS = 5000;
/** Switching on failed on this page (nothing was subscribed): shown as off, not as on. */
let enableFailed = false;

function readOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false; // storage unavailable (private mode): treat as not switched off
  }
}
function writeOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

function currentState(): PushState {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && !readOff() && !enableFailed ? "on" : "off";
}

/** The page's service worker registration — or an error, rather than waiting for ever. */
function workerReady(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("service worker not available")), WORKER_WAIT_MS)),
  ]);
}

// Converts the VAPID public key from base64url to Uint8Array (required by pushManager)
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/** `quiet`: the on-load refresh — it must not undo an "off" chosen a moment ago. */
async function subscribe(memberName: string, quiet = false) {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("push is not configured (no VAPID key)");
  const reg = await workerReady();
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // The DOM typings want an ArrayBuffer; the Uint8Array's bytes are what the browser reads.
      applicationServerKey: urlBase64ToUint8Array(key) as unknown as ArrayBuffer,
    }));
  if (quiet && readOff()) return;
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: memberName, subscription: sub.toJSON() }),
  });
  if (!res.ok && !quiet) throw new Error(`subscribe failed (${res.status})`);
}

async function unsubscribe() {
  const reg = await workerReady();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  // If this request fails the device is still unsubscribed below, and the server drops the dead
  // row itself the next time it tries to push to it (lib/push.ts, 410 Gone).
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe();
}

/**
 * Push notifications on this device, for the header's "Enable" button and the Settings switch.
 * Every user of the hook on the page stays in step (a change is announced on `window`).
 */
export function usePush() {
  const { name } = useName();
  const [state, setState] = useState<PushState>("off");
  const [switchedOff, setSwitchedOff] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => {
      setState(currentState());
      setSwitchedOff(readOff());
    };
    sync();
    setReady(true);
    // Register the service worker regardless — push needs it.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync); // switched on or off in another tab
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Already allowed and not switched off: re-subscribe quietly on every load to keep it fresh.
  useEffect(() => {
    if (state === "on" && name) subscribe(name, true).catch(() => {});
  }, [state, name]);

  /** Asks the browser if needed and subscribes. Resolves to the state afterwards. */
  const enable = useCallback(async (): Promise<PushState> => {
    if (currentState() === "unsupported") return "unsupported";
    setBusy(true);
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission === "granted") {
        enableFailed = true; // until the subscription below is really in place
        await subscribe(name || "Family");
        enableFailed = false;
        writeOff(false);
      }
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event(CHANGED));
    }
    return currentState();
  }, [name]);

  /**
   * Stops notifications on this device (the browser's permission itself stays as it is). The
   * choice is recorded first: even if unsubscribing fails, nothing re-subscribes this device.
   */
  const disable = useCallback(async (): Promise<PushState> => {
    setBusy(true);
    try {
      writeOff(true);
      enableFailed = false;
      await unsubscribe();
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event(CHANGED));
    }
    return currentState();
  }, []);

  return { state, switchedOff, ready, busy, enable, disable };
}
