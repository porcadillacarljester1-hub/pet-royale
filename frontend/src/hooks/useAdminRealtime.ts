import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* Keeps every admin screen live.

   Mount it ONCE, in the layout that wraps the signed-in pages (inside
   QueryClientProvider):

     useAdminRealtime();

   When any of the tables below changes, every query that is currently on
   screen refetches. Queries for screens that aren't open are only marked
   stale and load the next time you visit them. Changes arrive in bursts
   (one booking touches several rows), so refreshes are debounced into one.

   The old per-screen refetch timers and the invalidations after your own
   saves can stay as they are. */

const TABLES = [
  "appointments",
  "pets",
  "clients",
  "invoices",
  "invoice_items",
  "payments",
  "services",
  "service_price_tiers",
  "products",
  "product_sales",
  "inventory",
  "inventory_logs",
  "notifications",
  "staff",
  "clinic_settings",
  "booking_categories",
  "categories",
  "breeds",
];

export function useAdminRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries();
      }, 400);
    };

    let channel = supabase.channel(`admin-realtime-${Math.random().toString(36).slice(2)}`);
    for (const table of TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }

    let firstConnect = true;
    channel.subscribe((status, err) => {
      if (import.meta.env.DEV) console.log("[admin-realtime]", status, err?.message ?? "");
      if (status === "SUBSCRIBED") {
        // After a dropped connection, catch up on anything missed. The very
        // first connect needs no refresh: the screens just loaded.
        if (!firstConnect) refresh();
        firstConnect = false;
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
