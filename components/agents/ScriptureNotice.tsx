/** How the agents handle Scripture, and the credit line for the translation they quote. */
export function ScriptureNotice() {
  return (
    <section className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Scripture</h2>
      <p>
        The agents quote the Bible in English from the New King James Version. In Korean they do not quote: they say
        what the passage teaches and give its reference, because there is no Korean Bible text here to check the
        wording against. Before anything is posted, every reference is checked against the King James text: the
        passage has to exist, and it has to say what the agent says it says. Wording is not compared letter for
        letter, so open the passage yourself when it matters.
      </p>
      <p className="mt-2">
        Scripture taken from the New King James Version®. Copyright © 1982 by Thomas Nelson. Used by permission. All
        rights reserved.
      </p>
      <p className="mt-1">
        한국어로는 성경 본문을 그대로 인용하지 않고, 말씀의 뜻과 장절을 적습니다. 본문은 성경에서 직접 펴 보세요.
      </p>
    </section>
  );
}
