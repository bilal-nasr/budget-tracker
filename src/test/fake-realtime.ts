/**
 * A stand-in for the browser Supabase client's Realtime surface: `realtime.setAuth()`,
 * `channel(topic).on(...).subscribe(cb)` and `removeChannel`. Tests drive it with `emit`
 * (a postgres change), `system` (a server notice on the channel) and `status` (a subscribe state).
 */
type Filter = { event?: string; schema?: string; table?: string; filter?: string };
type Binding = { type: string; filter: Filter; callback: (payload: unknown) => void };
export type SubscribeState = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export type FakeChannel = {
  topic: string;
  bindings: Binding[];
  callback: ((state: SubscribeState, error?: Error) => void) | null;
  removed: boolean;
  on: (type: string, filter: Filter, callback: (payload: unknown) => void) => FakeChannel;
  subscribe: (callback: (state: SubscribeState, error?: Error) => void) => FakeChannel;
  /** Delivers a change to the bindings for `table` (event "*" or matching `eventType`). */
  emit: (table: string, change: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: unknown; old: unknown }) => void;
  /** Delivers a `system` message, as the server sends when it cannot set up postgres changes. */
  system: (payload: Record<string, unknown>) => void;
};

export function fakeRealtime() {
  const channels: FakeChannel[] = [];
  /** "auth" and "join" in the order they happened. */
  const order: string[] = [];
  let authFailure: Error | null = null;
  const client = {
    realtime: { setAuth: async () => { order.push("auth"); if (authFailure) throw authFailure; } },
    channel(topic: string) {
      if (channels.some((channel) => !channel.removed && channel.topic === topic)) throw new Error(`duplicate channel ${topic}`);
      const channel: FakeChannel = {
        topic, bindings: [], callback: null, removed: false,
        on(type, filter, callback) { channel.bindings.push({ type, filter, callback }); return channel; },
        subscribe(callback) {
          if (channel.callback) throw new Error("subscribed twice");
          order.push("join");
          channel.callback = callback;
          return channel;
        },
        emit(table, change) {
          for (const binding of channel.bindings) {
            if (binding.type !== "postgres_changes" || binding.filter.table !== table) continue;
            if (binding.filter.event !== "*" && binding.filter.event !== change.eventType) continue;
            binding.callback({ schema: "public", table, commit_timestamp: "2026-11-09T10:00:00Z", errors: null, ...change });
          }
        },
        system(payload) {
          for (const binding of channel.bindings) if (binding.type === "system") binding.callback(payload);
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel: async (channel: FakeChannel) => { channel.removed = true; return "ok" as const; },
  };
  const active = () => channels.filter((channel) => !channel.removed);
  return {
    client,
    channels,
    order,
    active,
    /** Makes `setAuth()` reject (or, with null, work again). */
    failAuth(error: Error | null = new Error("no session")) { authFailure = error; },
    /** Reports a subscribe state on the one open channel. */
    status(state: SubscribeState) {
      const [channel] = active();
      if (!channel?.callback) throw new Error("no subscribed channel");
      channel.callback(state);
    },
  };
}
