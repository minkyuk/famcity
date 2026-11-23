import { honoursGodAndHisWord } from "@/lib/reverence";
import { scriptureIsFaithful, scriptureProblem } from "@/lib/scripture";

/**
 * What every draft must pass, about God and His Word, before it is posted: it never questions or
 * is cynical about them (lib/reverence.ts), and every passage it cites exists and says what the
 * draft says it says (lib/scripture.ts). Every path that saves agent text goes through both —
 * passesFaithGates(text); or, where a person is waiting for a reply, writeReverently(...) followed
 * by scriptureIsFaithful(text); or, for a news reading, writeFaithfully(...). A new path must too.
 */
export async function passesFaithGates(text: string): Promise<boolean> {
  return (await honoursGodAndHisWord(text)) && (await scriptureIsFaithful(text));
}

/** What an agent is told when its draft was refused by the reverence check and it writes again. */
export const REVERENCE_RETRY_NOTE = `\n\nYour previous draft was not posted: in your own voice it questioned or doubted God or His Word, or spoke of them with cynicism. Write it again. If the person brought a doubt, a grief or a hard question, acknowledge it with patience and answer from the Word, in trust — do not voice the doubt as your own, and do not leave it as the last word.`;

/**
 * For text a reader is waiting on — a reply to a person, a news reading. `write("")` produces the
 * draft; if the reverence check refuses it, `write(REVERENCE_RETRY_NOTE)` is asked for another,
 * so one wrong (or right) refusal doesn't leave the reader with nothing. Returns the text to go on
 * with, or null when the second draft is refused too. An empty draft is returned as it is (the
 * caller decides what too short means). The Scripture check is the caller's next step.
 */
export async function writeReverently(write: (note: string) => Promise<string>): Promise<string | null> {
  const first = await write("");
  if (!first.trim() || (await honoursGodAndHisWord(first))) return first;
  const second = await write(REVERENCE_RETRY_NOTE);
  return second.trim() && (await honoursGodAndHisWord(second)) ? second : null;
}

/** What an agent is told when its draft cited Scripture wrongly and it writes again. */
export const scriptureRetryNote = (reason: string) =>
  `\n\nYour previous draft was not posted: it cited Scripture wrongly (${reason}). Write it again. Cite a passage only for what it actually says, and put in quotation marks only that passage's own words, and only in English — in Korean, no quotation marks at all. When you are not sure, say what it teaches without quotation marks and give the bare reference — or speak plainly from God's character with no reference at all.`;

/**
 * For text that is written once and gets no later turn — a news reading. Both checks, and when
 * either refuses, one more draft, told why: before this a reading with one wrong citation was
 * dropped, and its story went out with neither reading. (A reply to a person and a small-group
 * helper's reply are tried again by their claims, so they keep writeReverently.)
 * Returns the draft that passed, "" when the first draft was empty, or null when two were refused.
 */
export async function writeFaithfully(write: (note: string) => Promise<string>): Promise<string | null> {
  let note = "";
  for (let drafts = 0; drafts < 2; drafts++) {
    const draft = await write(note);
    if (!draft.trim()) return drafts === 0 ? draft : null;
    if (!(await honoursGodAndHisWord(draft))) {
      note = REVERENCE_RETRY_NOTE;
      continue;
    }
    const problem = await scriptureProblem(draft);
    if (problem === null) return draft;
    note = scriptureRetryNote(problem);
  }
  return null;
}
