"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type RSVPEntry = {
  id: string;
  status: string;
  user: { id: string; name: string | null; image: string | null };
};

type UpcomingEvent = {
  id: string;
  title: string;
  startAt: string;
  rsvps: RSVPEntry[];
};

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const RSVP_LABEL: Record<string, string> = {
  YES: "Going ✅",
  NO: "Can't go ❌",
  MAYBE: "Maybe ❓",
};

export function UpcomingEvents() {
  const { data: session } = useSession();
  const [events, setEvents] = useState<UpcomingEvent[]>([]);

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        const now = new Date();
        const upcoming = data
          .filter((e: UpcomingEvent) => new Date(e.startAt) >= now)
          .slice(0, 3);
        setEvents(upcoming);
      })
      .catch(() => {});
  }, []);

  if (events.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-1">
        Upcoming Events
      </p>
      {events.map((event) => {
        const myRsvp = session?.user?.id
          ? event.rsvps.find((r) => r.user.id === session.user.id)
          : null;
        return (
          <Link
            key={event.id}
            href="/calendar"
            className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <span className="text-base leading-none mt-0.5 shrink-0">📅</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-700 font-medium truncate leading-tight">
                {event.title}
              </p>
              <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                <span>{formatShortDate(event.startAt)}</span>
                {myRsvp && (
                  <>
                    <span>·</span>
                    <span className="text-orange-500">{RSVP_LABEL[myRsvp.status]}</span>
                  </>
                )}
              </div>
            </div>
          </Link>
        );
      })}
      <Link
        href="/calendar"
        className="text-xs text-orange-600 hover:underline px-2 py-1 font-medium"
      >
        View all →
      </Link>
    </div>
  );
}
