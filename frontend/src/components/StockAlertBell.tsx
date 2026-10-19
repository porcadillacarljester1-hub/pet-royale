import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Package, ArrowUpRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchNotifications, markAsRead, type Notification } from "@/api/notifications";
import { formatDistanceToNow } from "date-fns";

/* Postgres returns timestamps without a zone marker when the column is
   `timestamp` rather than `timestamptz` — without the Z the browser
   reads it as local time. Same fix as the Notifications page, kept
   here too since this component reads the same table independently. */
function normalizeTimestamp(n: Notification): Notification {
  return {
    ...n,
    created_at:
      n.created_at.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(n.created_at)
        ? n.created_at
        : n.created_at + "Z",
  };
}

const MAX_SHOWN = 6;

/* The warning icon inventory deserves on its own — split out of the
   general notification bell so critical stock doesn't get buried
   among appointment alerts, and so clicking it goes straight to the
   specific products rather than a generic "go read your
   notifications" hand-off. */
export function StockAlertBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications();
      setItems(
        data.filter((n) => n.type === "inventory").map(normalizeTimestamp)
      );
    } catch {
      // A failed fetch shouldn't surface an error in the header.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const channel = (supabase as any)
      .channel("stock-alert-bell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload: any) => {
          const type = (payload.new as any)?.type ?? (payload.old as any)?.type;
          if (type === "inventory") void load();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unreadCount = items.filter((n) => !n.is_read).length;
  const shown = items.slice(0, MAX_SHOWN);

  const openItem = async (n: Notification) => {
    setOpen(false);
    if (!n.is_read) {
      await markAsRead(n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    }
    navigate("/supplies");
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Stock alerts, ${unreadCount} unread` : "Stock alerts"}
        title="Stock alerts"
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[hsl(38_85%_72%)] transition hover:bg-[hsl(var(--primary-foreground)/.1)]"
      >
        <AlertTriangle size={17} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[hsl(var(--destructive))] px-1 text-[10px] font-bold text-[hsl(var(--destructive-foreground))] ring-2 ring-[hsl(var(--primary))]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        /* Opaque background, same as the profile dropdown — a floating
           menu needs a solid backdrop or the page underneath shows
           through it. */
        <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-[0_18px_50px_-24px_hsl(175_33%_18%/.5)]">
          <div className="flex items-center justify-between border-b border-[hsl(var(--border)/.7)] px-4 py-3">
            <p className="text-[13px] font-bold">Stock alerts</p>
            {items.length > 0 && (
              <span className="rounded-full bg-[hsl(15_72%_90%)] px-1.5 py-0.5 text-[10px] font-bold text-[hsl(15_60%_38%)]">
                {items.length}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Package className="mx-auto text-[hsl(var(--muted-foreground))]" size={20} />
              <p className="mt-2 text-xs font-bold">Stock is healthy</p>
              <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                No low or critical items right now.
              </p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {shown.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-3 border-b border-[hsl(var(--border)/.55)] px-4 py-3 text-left transition last:border-0 hover:bg-[hsl(var(--muted)/.4)] ${
                    n.is_read ? "" : "bg-[hsl(15_72%_90%)/.28]"
                  }`}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]">
                    <Package size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className={`min-w-0 flex-1 truncate text-[12.5px] ${n.is_read ? "" : "font-bold"}`}>
                        {n.title}
                      </p>
                      {!n.is_read && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                      {n.message}
                    </p>
                    <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="p-1.5">
            <button
              onClick={() => { setOpen(false); navigate("/notifications"); }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))]"
            >
              View all in Notifications <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
