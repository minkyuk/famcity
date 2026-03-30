const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateInviteCode(): string {
  return Array.from(
    { length: 8 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join("");
}
