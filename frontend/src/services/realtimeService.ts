import { supabase } from "@/integrations/supabase/client";

type QueryInvalidator = (queryKey: string[]) => void;

// Tables that change constantly and don't need a screen refresh
const IGNORED_TABLES = new Set(["audit_log", "inventory_logs"]);

// How long to wait before each reconnect attempt (ms). The last value repeats.
const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];

/* Same job as before: watch every table and refresh every screen's data
   when something changes. What's new is that it recovers by itself:

   - if the channel closes or errors, it reconnects with a growing delay;
   - after a reconnect it refreshes everything, to catch up on changes
     that happened while it was disconnected;
   - it also reconnects when the browser comes back online or the tab
     becomes visible again;
   - every connection gets its own channel name, so a closing channel
     can never cancel the one that replaces it.

   Closing the channel on purpose (disconnect) is silent. If the console
   ever prints "REALTIME: CLOSED" now, the connection dropped by itself,
   and a "reconnecting" line follows. */
class RealtimeService {
  private channel: any = null;
  private isInitialized = false; // true from init() until disconnect()
  private timer: ReturnType<typeof setTimeout> | null = null; // refresh debounce
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private hasConnectedBefore = false;
  private invalidateQuery: QueryInvalidator = () => {};

  setQueryInvalidator(fn: QueryInvalidator) {
    this.invalidateQuery = fn;
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.retries = 0;
    this.hasConnectedBefore = false;
    window.addEventListener("online", this.onWake);
    document.addEventListener("visibilitychange", this.onWake);
    this.connect();
  }

  disconnect() {
    this.isInitialized = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    window.removeEventListener("online", this.onWake);
    document.removeEventListener("visibilitychange", this.onWake);
    this.dropChannel();
  }

  private onWake = () => {
    if (!this.isInitialized) return;
    if (document.visibilityState === "hidden") return;
    const state = this.channel?.state;
    if (state !== "joined" && state !== "joining") this.reconnect(0);
  };

  private connect() {
    this.dropChannel();

    const channel = supabase
      .channel(`all_changes_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: any) => {
        if (IGNORED_TABLES.has(payload.table)) return;
        console.log("CHANGE RECEIVED:", payload.table, payload.eventType);
        this.scheduleRefresh();
      })
      .subscribe((status: string, err?: Error) => {
        // Ignore callbacks from a channel we have already replaced or closed.
        if (this.channel !== channel) return;
        console.log("REALTIME:", status, err?.message ?? "");

        if (status === "SUBSCRIBED") {
          this.retries = 0;
          if (this.hasConnectedBefore) this.scheduleRefresh(); // catch up
          this.hasConnectedBefore = true;
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.reconnect();
        }
      });

    this.channel = channel;
  }

  private reconnect(delay?: number) {
    if (!this.isInitialized || this.retryTimer) return;
    const wait = delay ?? RETRY_DELAYS[Math.min(this.retries, RETRY_DELAYS.length - 1)];
    this.retries += 1;
    console.log(`REALTIME: reconnecting in ${wait} ms`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.isInitialized) this.connect();
    }, wait);
  }

  private dropChannel() {
    const old = this.channel;
    this.channel = null; // set first, so the old channel's CLOSED is ignored
    if (old) void supabase.removeChannel(old);
  }

  // Wait briefly so a burst of changes causes just one refresh
  private scheduleRefresh() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.invalidateQuery([]); // empty key = refresh every screen's data
    }, 400);
  }
}

export const realtimeService = new RealtimeService();