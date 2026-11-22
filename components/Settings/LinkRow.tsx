import Link from "next/link";

/** A row that leads to another page where the setting is managed. */
export function LinkRow({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <Link href={href} className="group flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 transition-colors group-hover:text-orange-500">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-gray-400">{hint}</p>}
      </div>
      <span className="shrink-0 text-gray-300 transition-colors group-hover:text-orange-500">›</span>
    </Link>
  );
}
