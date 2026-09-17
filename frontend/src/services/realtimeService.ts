import { supabase } from "@/integrations/supabase/client";

type QueryInvalidator = (queryKey: string[]) => void;

/**
 * Keeps the dashboard in step with the database without anyone
 * refreshing.
 *
 * Two channels: appointments and inventory. Notifications used to have
 * a third, but it existed only to play a sound — and sounds were
 * removed. The badge on the bell has its own subscription in
 * NotificationBell, which is where the count lives.
 */
class RealtimeService {
  private channels: any[] = [];
  private isInitialized = false;
  private invalidateQuery: QueryInvalidator = () => {};

  setQueryInvalidator(fn: QueryInvalidator) {
    this.invalidateQuery = fn;
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.watchAppointments();
    this.watchInventory();
  }

  private watchAppointments() {
    const channel = supabase
      .channel("appointments_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments" },
        () => {
          /* The schedule's key is ["appointments-range", from, to], and
             React Query matches by prefix — so invalidating
             ["appointments"] matched nothing and the table never
             refreshed when a booking arrived.

             INSERT and UPDATE are handled together because the response
             is the same either way: refetch. Separate handlers only
             meant two paths doing one thing. */
          this.invalidateQuery(["appointments-range"]);
          this.invalidateQuery(["dashboard-data"]);
          this.invalidateQuery(["invoice-summary"]);
        }
      )
      .subscribe();

    this.channels.push(channel);
  }

  private watchInventory() {
    const channel = supabase
      .channel("inventory_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory" },
        () => {
          this.invalidateQuery(["inventory"]);
          this.invalidateQuery(["dashboard-data"]);
        }
      )
      .subscribe();

    this.channels.push(channel);
  }

  disconnect() {
    this.channels.forEach((channel) => supabase.removeChannel(channel));
    this.channels = [];
    this.isInitialized = false;
  }
}

export const realtimeService = new RealtimeService();