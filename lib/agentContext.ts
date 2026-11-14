import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which agent's turn is running. Set once at the start of a turn with withAgent(); every
 * Claude call inside it (generation, gates, flight parsing...) is then logged under that agent,
 * without passing the name through every function.
 */
const agentTurn = new AsyncLocalStorage<string>();

export function withAgent<T>(agentName: string, fn: () => Promise<T>): Promise<T> {
  return agentTurn.run(agentName, fn);
}

export function currentAgent(): string | null {
  return agentTurn.getStore() ?? null;
}
