"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CreateSpaceModal } from "@/components/spaces/CreateSpaceModal";

interface Space {
  id: string;
  name: string;
  role: string;
}

export function SpaceSwitcher() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/spaces")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setSpaces(data))
      .catch(() => {});
  }, [pathname]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentSpaceId = pathname.startsWith("/spaces/")
    ? pathname.split("/spaces/")[1]
    : null;

  const currentSpaceName = currentSpaceId
    ? (spaces.find((s) => s.id === currentSpaceId)?.name ?? "Space")
    : null;

  // Abbreviate long space names to initials so the button never wraps
  const initials = (name: string) =>
    name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 3);

  const currentLabel = currentSpaceName ? initials(currentSpaceName) : "All";

  const navigate = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full transition-colors"
        >
          {currentLabel}
          <span className="text-gray-400 text-xs">▾</span>
        </button>

        {open && (
          <div className="absolute left-0 top-10 z-50 bg-white rounded-xl shadow-lg border border-gray-100 min-w-[180px] py-1 flex flex-col max-h-[70vh]">
            <button
              onClick={() => navigate("/")}
              className={`w-full text-left px-4 py-2 text-sm transition-colors shrink-0 ${
                !currentSpaceId ? "font-semibold text-accent" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              🌐 All Spaces
            </button>

            {spaces.length > 0 && (
              <div className="border-t border-gray-100 mt-1 pt-1 overflow-y-auto">
                {spaces.map((space) => (
                  <button
                    key={space.id}
                    onClick={() => navigate(`/spaces/${space.id}`)}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                      currentSpaceId === space.id
                        ? "font-semibold text-accent"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {space.name}
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-gray-100 mt-1 pt-1 shrink-0">
              <button
                onClick={() => { setOpen(false); setShowCreate(true); }}
                className="w-full text-left px-4 py-2 text-sm text-gray-400 hover:bg-gray-50 transition-colors"
              >
                + Create Space
              </button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateSpaceModal onClose={() => setShowCreate(false)} />}
    </>
  );
}
