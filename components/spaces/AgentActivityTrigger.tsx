"use client";

import { useEffect } from "react";

/** When rendered, triggers one round of agent discussion. Fires at most once per mount. */
export function AgentActivityTrigger() {
  useEffect(() => {
    fetch("/api/agents/discuss", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
