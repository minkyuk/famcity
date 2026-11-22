"use client";

import { useId } from "react";

/**
 * One setting with an on/off switch. While `disabled` the switch stays focusable (so the keyboard
 * doesn't lose its place during a save) and simply ignores presses.
 */
export function ToggleRow({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint && (
          <p id={hintId} className="mt-0.5 text-xs leading-relaxed text-gray-400">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-200 ${
          disabled ? "cursor-not-allowed opacity-50" : ""
        } ${checked ? "bg-orange-500" : "bg-gray-200"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}
