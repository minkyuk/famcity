"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PostButton() {
  const pathname = usePathname();
  const spaceMatch = pathname.match(/^\/spaces\/([^/]+)/);
  const href = spaceMatch ? `/compose?spaceId=${spaceMatch[1]}` : "/compose";

  return (
    <Link
      href={href}
      className="bg-accent text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-orange-600 transition-colors"
    >
      + Post
    </Link>
  );
}
