import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who a connector (MCP) request acts as. The token is the person's own Supabase
 * access token, already verified by the caller; RLS does the rest.
 */
export type ConnectorContext = { accessToken: string; userId: string };

const storage = new AsyncLocalStorage<ConnectorContext>();

/**
 * Runs `fn` as the person behind a connector bearer token. Inside it, the shared
 * Supabase factory and `getUserId` use that token and never read or write cookies.
 * Each call has its own context, so overlapping requests never see each other.
 */
export function runAsConnector<T>(ctx: ConnectorContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(Object.freeze({ accessToken: ctx.accessToken, userId: ctx.userId }), fn);
}

/** The current connector identity, or undefined for an ordinary cookie request. */
export function connectorContext(): ConnectorContext | undefined {
  return storage.getStore();
}

/**
 * For reads whose browser fallback on a database error is an empty or default answer.
 * Inside a connector request it throws a plain Error, so the tool reports a failure
 * instead of a valid-looking "nothing"; outside one it does nothing and the caller keeps
 * its fallback. `message` is internal: the tool's client only ever sees the generic error.
 */
export function throwInConnector(message: string): void {
  if (connectorContext()) throw new Error(message);
}
