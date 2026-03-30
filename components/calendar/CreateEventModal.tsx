"use client";

import { useState } from "react";

interface CreateEventModalProps {
  onClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCreated: (event: any) => void;
  spaces: { id: string; name: string }[];
  defaultSpaceId?: string;
}

export function CreateEventModal({ onClose, onCreated, spaces, defaultSpaceId }: CreateEventModalProps) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [spaceId, setSpaceId] = useState(defaultSpaceId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildDateTime = (dateStr: string, timeStr: string): string => {
    // Combine date and time into ISO datetime string
    if (!timeStr) {
      // Default to midnight if no time provided
      return new Date(`${dateStr}T00:00:00`).toISOString();
    }
    return new Date(`${dateStr}T${timeStr}:00`).toISOString();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;

    setLoading(true);
    setError(null);

    const startAt = buildDateTime(date, allDay ? "" : startTime);
    const endAt = endTime && !allDay ? buildDateTime(date, endTime) : undefined;

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      startAt,
      ...(endAt && { endAt }),
      allDay,
      ...(spaceId && { spaceId }),
    };

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.formErrors?.[0] ?? "Failed to create event");
        return;
      }

      const newEvent = await res.json();
      onCreated(newEvent);
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:w-[520px] sm:rounded-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[95vh] sm:max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">Create Event</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Title <span className="text-orange-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              maxLength={100}
              required
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>

          {/* All day toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="allDay"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="accent-orange-500 w-4 h-4"
            />
            <label htmlFor="allDay" className="text-sm font-medium text-gray-700 cursor-pointer">
              All day
            </label>
          </div>

          {/* Date */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Date <span className="text-orange-500">*</span>
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>

          {/* Times */}
          {!allDay && (
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-sm font-medium text-gray-700">Start time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-sm font-medium text-gray-700">End time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
            </div>
          )}

          {/* Location */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional location"
              maxLength={200}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              maxLength={1000}
              rows={3}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none"
            />
          </div>

          {/* Space selector */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Space</label>
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 bg-white"
            >
              <option value="">Global (visible to all family)</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-gray-600 hover:text-gray-800 px-4 py-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !title.trim() || !date}
            className="bg-orange-500 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:bg-orange-600 disabled:opacity-40 transition-colors"
          >
            {loading ? "Creating…" : "Create Event"}
          </button>
        </div>
      </div>
    </div>
  );
}
