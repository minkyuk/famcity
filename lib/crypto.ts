import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const key = process.env.CHAT_ENCRYPTION_KEY;
  if (!key) throw new Error("CHAT_ENCRYPTION_KEY not set");
  return Buffer.from(key, "hex");
}

export function encryptMessage(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptMessage(ciphertext: string): string {
  try {
    const [ivHex, authTagHex, dataHex] = ciphertext.split(":");
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "[encrypted message]";
  }
}
