/** One titled list inside the "what the agents remember" card. Each row can show where it came from. */
export type SketchRow = { key: string; text: string; tag?: string; quote?: string; date?: string };

export function SketchSection({ title, rows }: { title: string; rows: SketchRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.key} className="text-sm text-gray-700">
            {row.tag && (
              <span className="mr-1.5 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-600">{row.tag}</span>
            )}
            {row.text}
            {(row.quote || row.date) && (
              <p className="mt-0.5 text-[11px] text-gray-400">
                {row.quote && <span className="italic">“{row.quote}”</span>}
                {row.quote && row.date && " · "}
                {row.date}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
