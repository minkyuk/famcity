"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { EditAgentButton } from "./EditAgentButton";

type SpaceAgentItem = { id: string; name: string; slug: string; personality: string };

/** The 🤖 menu on a space page: the space's agents, each with a link to its page and ✏️ to edit it. */
export function SpaceAgentsDropdown({ spaceId, agents }: { spaceId: string; agents: SpaceAgentItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (agents.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Space agents"
        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-orange-500 transition-colors"
      >
        🤖 <span>{agents.length}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-gray-100 rounded-xl shadow-lg py-1.5 min-w-[190px]">
          <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-wide px-3 pb-1">
            Space Agents
          </p>
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-1 pr-2 hover:bg-orange-50 transition-colors">
              <Link
                href={`/agents/space/${a.id}`}
                onClick={() => setOpen(false)}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5"
              >
                <span className="text-base leading-none">🤖</span>
                <span className="text-sm text-gray-700 truncate">{a.name}</span>
              </Link>
              <EditAgentButton spaceId={spaceId} agent={a} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
