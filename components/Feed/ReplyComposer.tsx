"use client";

import { useEffect, useRef, useState } from "react";
import { rowsFor } from "./textareaRows";

/**
 * The reply box that opens right under the comment being answered, as on Facebook. Enter adds a
 * line; the Reply button or Ctrl/⌘+Enter sends; Esc or Cancel closes it.
 */
export function ReplyComposer({
  author,
  onSubmit,
  onCancel,
}: {
  author: string;
  /** Resolves true once the reply is saved; the parent then closes this box. */
  onSubmit: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const ok = await onSubmit(text.trim());
    setSending(false);
    if (ok) setText("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="flex flex-col gap-1.5"
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={rowsFor(text, 1, 6)}
        maxLength={1000}
        placeholder={`Reply to ${author}…`}
        aria-label={`Reply to ${author}`}
        className="w-full min-w-0 text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-orange-200"
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1">
          Cancel
        </button>
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="text-xs bg-accent text-white rounded-lg px-3 py-1.5 disabled:opacity-40 hover:bg-orange-600 transition-colors"
        >
          {sending ? "Sending…" : "Reply"}
        </button>
      </div>
    </form>
  );
}
