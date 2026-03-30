"use client";

import { useState } from "react";

type RSVPEntry = {
  id: string;
  status: string;
  user: { id: string; name: string | null; image: string | null };
};

type EventWithRSVPs = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  spaceId: string | null;
  space: { name: string } | null;
  createdBy: { id: string; name: string | null; image: string | null };
  rsvps: RSVPEntry[];
};

interface EventCardProps {
  event: EventWithRSVPs;
  currentUserId: string;
}

function formatEventDate(startAt: string, endAt: string | null, allDay: boolean): string {
  const start = new Date(startAt);
  const dateStr = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  if (allDay) return dateStr;

  const timeStr = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (endAt) {
    const end = new Date(endAt);
    const endTimeStr = end.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${dateStr} · ${timeStr} – ${endTimeStr}`;
  }

  return `${dateStr} · ${timeStr}`;
}

export function EventCard({ event, currentUserId }: EventCardProps) {
  const [rsvps, setRsvps] = useState<RSVPEntry[]>(event.rsvps);
  const [loading, setLoading] = useState<string | null>(null);

  const myRsvp = rsvps.find((r) => r.user.id === currentUserId);

  const yesCount = rsvps.filter((r) => r.status === "YES").length;
  const maybeCount = rsvps.filter((r) => r.status === "MAYBE").length;
  const noCount = rsvps.filter((r) => r.status === "NO").length;

  const handleRsvp = async (status: "YES" | "NO" | "MAYBE") => {
    if (loading) return;
    setLoading(status);

    // Optimistic update
    setRsvps((prev) => {
      const withoutMe = prev.filter((r) => r.user.id !== currentUserId);
      return [
        ...withoutMe,
        {
          id: "optimistic",
          status,
          user: { id: currentUserId, name: null, image: null },
        },
      ];
    });

    try {
      const res = await fetch(`/api/events/${event.id}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setRsvps((prev) => {
          const withoutMe = prev.filter((r) => r.user.id !== currentUserId);
          return [...withoutMe, updated];
        });
      }
    } catch {
      // revert on error
      setRsvps(event.rsvps);
    } finally {
      setLoading(null);
    }
  };

  const rsvpButtons: { status: "YES" | "NO" | "MAYBE"; label: string; emoji: string }[] = [
    { status: "YES", label: "Going", emoji: "✅" },
    { status: "MAYBE", label: "Maybe", emoji: "❓" },
    { status: "NO", label: "Can't go", emoji: "❌" },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-base leading-snug">{event.title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatEventDate(event.startAt, event.endAt, event.allDay)}
          </p>
        </div>
        {event.space && (
          <span className="shrink-0 text-xs bg-orange-50 text-orange-600 border border-orange-100 rounded-full px-2 py-0.5 font-medium">
            {event.space.name}
          </span>
        )}
      </div>

      {/* Location */}
      {event.location && (
        <p className="text-sm text-gray-600 flex items-center gap-1">
          <span>📍</span>
          <span className="truncate">{event.location}</span>
        </p>
      )}

      {/* Description */}
      {event.description && (
        <p className="text-sm text-gray-600 line-clamp-2">{event.description}</p>
      )}

      {/* RSVP counts */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>✅ {yesCount}</span>
        <span>❓ {maybeCount}</span>
        <span>❌ {noCount}</span>
      </div>

      {/* RSVP buttons */}
      <div className="flex flex-wrap gap-2">
        {rsvpButtons.map(({ status, label, emoji }) => {
          const isActive = myRsvp?.status === status;
          return (
            <button
              key={status}
              onClick={() => handleRsvp(status)}
              disabled={loading !== null}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors disabled:opacity-60 ${
                isActive
                  ? "bg-orange-500 text-white border-orange-500"
                  : "bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600"
              }`}
            >
              {emoji} {label}
            </button>
          );
        })}
      </div>

      {/* Creator */}
      <p className="text-xs text-gray-400">
        Created by {event.createdBy.name ?? "Unknown"}
      </p>
    </div>
  );
}
