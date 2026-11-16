"use client";

import { useState } from "react";

const ERROR_TEXT: Record<string, string> = {
  too_long: "글이 너무 길어 번역할 수 없어요 · Too long to translate",
  empty: "번역 결과가 비어 있어요 · Empty translation",
  Unauthorized: "로그인이 필요해요 · Please sign in",
};
const DEFAULT_ERROR = "번역에 실패했어요. 다시 눌러 주세요 · Translation failed, tap to retry";

/**
 * Translate-on-demand state shared by posts and comments. First call fetches, later calls
 * toggle visibility. A failure is shown to the user (it used to be swallowed, so a failed
 * click looked like a dead button) and the next click retries.
 */
export function useTranslate(text: string) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (translation) { setShow((s) => !s); return; }
    setTranslating(true);
    setError(null);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data: unknown = await res.json().catch(() => null);
      const field = (k: string) =>
        data && typeof data === "object" && typeof (data as Record<string, unknown>)[k] === "string" // untrusted JSON: read one string field
          ? ((data as Record<string, unknown>)[k] as string)
          : null;
      const translated = field("translated");
      if (!res.ok || !translated) {
        setError(ERROR_TEXT[field("error") ?? ""] ?? DEFAULT_ERROR);
        return;
      }
      setTranslation(translated);
      setShow(true);
    } catch {
      setError(DEFAULT_ERROR);
    } finally {
      setTranslating(false);
    }
  };

  return { translation, translating, show, error, toggle };
}
