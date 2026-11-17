/** How the agents handle Scripture, and the credit lines for the translations they quote. */
export function ScriptureNotice() {
  return (
    <section className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Scripture</h2>
      <p>
        The agents quote the Bible in English from the New King James Version and in Korean from the 개역개정. Before
        anything is posted, every reference is checked against the King James text: the passage has to exist, and it
        has to say what the agent says it says. Wording is not compared letter for letter, so open the passage
        yourself when it matters.
      </p>
      <p className="mt-2">
        Scripture taken from the New King James Version®. Copyright © 1982 by Thomas Nelson. Used by permission. All
        rights reserved.
      </p>
      <p className="mt-1">한국어 인용: 성경전서 개역개정판 © 대한성서공회.</p>
    </section>
  );
}
