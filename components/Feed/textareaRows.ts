/** Rows for a growing textarea: one per line, between `min` and `max`. */
export const rowsFor = (text: string, min: number, max: number) => Math.min(max, Math.max(min, text.split("\n").length));
