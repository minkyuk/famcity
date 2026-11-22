/** A titled card on the Settings page. */
export function SettingsSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold text-gray-800">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-gray-400">{description}</p>}
      <div className="mt-2 divide-y divide-gray-100">{children}</div>
    </section>
  );
}
