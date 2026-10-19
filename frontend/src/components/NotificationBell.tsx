import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchNotifications, isAwaitingAppointmentAlert } from "@/api/notifications";
import { fetchProducts } from "@/api/products";
import { fetchInventory } from "@/api/inventory";

/* The number on the bell is the same total the Notifications screen
   shows in its left-hand list:

     unread pet-owner requests still waiting on staff
   + Pet Essentials items that are out of stock or running low
   + Supplies items that are out of stock or running low

   so the bell and the screen can't disagree. The stock part isn't
   "unread" — it stays on the bell until the item is restocked.

   "Running low" is 10 units or fewer, out of stock is 0 — the same
   rule Inventory.tsx and the Notifications screen use. That rule
   lives in all three files, so change it in all three.

   This renders inside AdminLayout, which every page mounts on its own,
   so the bell is created again on every navigation. Two things follow
   from that: the data comes from react-query (shared with the
   Inventory and Notifications screens, so it isn't re-downloaded from
   scratch each time), and the realtime channel name is unique per
   mount — a fixed name can hand back a channel that's still being
   removed, and adding callbacks to an already subscribed channel
   throws. A failed fetch just leaves the count at zero; it shouldn't
   put an error in the header. */

const LOW_STOCK_THRESHOLD = 10;
const needsRestock = (stock: number | null | undefined) => (stock ?? 0) <= LOW_STOCK_THRESHOLD;

export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["bell-notifications"],
    queryFn: fetchNotifications,
    staleTime: 15_000,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    staleTime: 15_000,
  });
  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
    staleTime: 15_000,
  });

  useEffect(() => {
    const channelName = `notifications-bell-${Math.random().toString(36).slice(2)}`;
    const channel = (supabase as any)
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => void queryClient.invalidateQueries({ queryKey: ["bell-notifications"] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const awaitingUnread = notifications.filter(
    (n) => isAwaitingAppointmentAlert(n) && !n.is_read
  ).length;
  const stockAlerts =
    products.filter((p) => needsRestock(p.stock)).length +
    inventory.filter((i) => needsRestock(i.stock)).length;
  const total = awaitingUnread + stockAlerts;

  /* A bare bright bell, no circle behind it, with a 44px touch area. The
     badge ring uses the bar's navy so it reads as cut out of the icon. */
  return (
    <button
      onClick={() => navigate("/notifications")}
      aria-label={total > 0 ? `Notifications, ${total} need attention` : "Notifications"}
      title="Notifications"
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary-foreground)/.1)]"
    >
      <Bell size={23} strokeWidth={1.8} />
      {total > 0 && (
        <span className="absolute right-0 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(var(--destructive))] px-1 text-[11px] font-bold leading-none text-[hsl(var(--destructive-foreground))] ring-2 ring-[hsl(var(--primary))]">
          {total > 99 ? "99+" : total}
        </span>
      )}
    </button>
  );
}
