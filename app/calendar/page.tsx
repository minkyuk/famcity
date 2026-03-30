"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { EventCard } from "@/components/calendar/EventCard";
import { CreateEventModal } from "@/components/calendar/CreateEventModal";

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

type Space = { id: string; name: string; isSystem?: boolean };

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildCalendarGrid(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0 = Sun

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export default function CalendarPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [events, setEvents] = useState<EventWithRSVPs[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const eventDayRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  // Load spaces once, default activeSpaceId to first non-system space
  useEffect(() => {
    fetch("/api/spaces")
      .then((r) => r.json())
      .then((data: Space[]) => {
        if (!Array.isArray(data)) return;
        const postable = data.filter((s) => !s.isSystem);
        setSpaces(postable);
        if (postable.length > 0) setActiveSpaceId(postable[0].id);
      })
      .catch(() => {});
  }, []);

  // Reload events whenever activeSpaceId changes
  useEffect(() => {
    if (!activeSpaceId) return;
    setLoadingEvents(true);
    fetch(`/api/events?spaceId=${activeSpaceId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setEvents(data); })
      .catch(() => {})
      .finally(() => setLoadingEvents(false));
  }, [activeSpaceId]);

  const handleCreated = (event: EventWithRSVPs) => {
    setEvents((prev) => [...prev, event].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()));
  };

  const handleDayClick = (day: Date) => {
    setSelectedDay(day);
    const key = day.toDateString();
    const el = eventDayRefs.current[key];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const calendarGrid = buildCalendarGrid(viewYear, viewMonth);

  const eventsInMonth = events.filter((e) => {
    const d = new Date(e.startAt);
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
  });

  const eventsOnDay = (day: Date) =>
    eventsInMonth.filter((e) => isSameDay(new Date(e.startAt), day));

  // Group upcoming events by date
  const now = new Date();
  const upcomingEvents = events.filter((e) => new Date(e.startAt) >= now);

  const groupedEvents: { dateKey: string; label: string; events: EventWithRSVPs[] }[] = [];
  const seenDates = new Set<string>();
  for (const event of upcomingEvents) {
    const d = new Date(event.startAt);
    const key = d.toDateString();
    if (!seenDates.has(key)) {
      seenDates.add(key);
      groupedEvents.push({
        dateKey: key,
        label: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
        events: [],
      });
    }
    groupedEvents[groupedEvents.length - 1].events.push(event);
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">📅 Calendar</h1>
        <div className="flex items-center gap-2 ml-auto">
          {/* Space selector */}
          {spaces.length > 1 && (
            <select
              value={activeSpaceId}
              onChange={(e) => setActiveSpaceId(e.target.value)}
              className="text-sm font-semibold text-gray-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="bg-orange-500 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-orange-600 transition-colors"
          >
            + Event
          </button>
        </div>
      </div>

      {/* Month grid */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
            aria-label="Previous month"
          >
            ‹
          </button>
          <h2 className="text-base font-bold text-gray-800">{monthLabel}</h2>
          <button
            onClick={nextMonth}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
            aria-label="Next month"
          >
            ›
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS_OF_WEEK.map((d) => (
            <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar rows */}
        {calendarGrid.map((row, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-7">
            {row.map((day, colIdx) => {
              if (!day) {
                return <div key={colIdx} className="min-h-[52px] p-1" />;
              }
              const dayEvents = eventsOnDay(day);
              const isToday = isSameDay(day, today);
              const isSelected = selectedDay && isSameDay(day, selectedDay);
              return (
                <button
                  key={colIdx}
                  onClick={() => handleDayClick(day)}
                  className={`min-h-[52px] p-1 rounded-xl flex flex-col items-center gap-0.5 transition-colors hover:bg-orange-50 ${
                    isSelected ? "bg-orange-100" : ""
                  }`}
                >
                  <span
                    className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                      isToday
                        ? "bg-orange-500 text-white"
                        : isSelected
                        ? "text-orange-600 font-bold"
                        : "text-gray-700"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {dayEvents.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-0.5">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <span
                          key={ev.id}
                          className="w-1.5 h-1.5 rounded-full bg-orange-400"
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Upcoming events list */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-bold text-gray-800">Upcoming Events</h2>

        {loadingEvents ? (
          <p className="text-sm text-gray-400">Loading events…</p>
        ) : upcomingEvents.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400 text-sm">
            No upcoming events. Create one!
          </div>
        ) : (
          groupedEvents.map((group) => (
            <div
              key={group.dateKey}
              ref={(el) => { eventDayRefs.current[group.dateKey] = el; }}
            >
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
                {group.label}
              </p>
              <div className="flex flex-col gap-3">
                {group.events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    currentUserId={session?.user?.id ?? ""}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Event Modal */}
      {showCreate && (
        <CreateEventModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          spaces={spaces}
          defaultSpaceId={activeSpaceId}
        />
      )}
    </div>
  );
}
