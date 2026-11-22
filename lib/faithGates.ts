import { honoursGodAndHisWord } from "@/lib/reverence";
import { scriptureIsFaithful } from "@/lib/scripture";

/**
 * What every draft must pass, about God and His Word, before it is posted: it never questions or
 * is cynical about them (lib/reverence.ts), and every passage it cites exists and says what the
 * draft says it says (lib/scripture.ts). Every path that saves agent text calls this — a new path
 * must too.
 */
export async function passesFaithGates(text: string): Promise<boolean> {
  return (await honoursGodAndHisWord(text)) && (await scriptureIsFaithful(text));
}
