"use client";

import { useEffect, useState } from "react";
import { FAMILY_MEMBERS } from "@/lib/constants";

const STORAGE_KEY = "famcity_name";

export function useName() {
  const [name, setNameState] = useState<string>("");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setNameState(stored);
    else setNameState(FAMILY_MEMBERS[0]);
  }, []);

  const setName = (n: string) => {
    localStorage.setItem(STORAGE_KEY, n);
    setNameState(n);
  };

  return { name, setName };
}

export function NamePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500 font-medium">Posting as</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm font-semibold text-gray-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300"
      >
        {FAMILY_MEMBERS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
