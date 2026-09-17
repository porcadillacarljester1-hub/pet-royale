import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchNotifications, markAsRead, markAllAsRead,
  deleteNotification, deleteAllNotifications, type Notification,
} from "@/api/notifications";
import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";
import { toast } from "sonner";
import {
  Bell, CalendarCheck, Package, CheckCheck, Trash2,
  Loader2, AlertTriangle, ArrowUpRight, X,
} from "lucide-react";

type Category = "appointment" | "inventory";

/* Two kinds of notification, both of which need someone to do
   something:

     appointment — a request waiting to be confirmed
     inventory   — stock at or below its critical level

   Client registrations and system messages were dropped. Neither needs
   a response, and a list where most rows need no action trains people
   to stop reading it. New registrations are visible on Patients, which
   is where you'd look for them. */
const CATEGORY: Record<Category, {
  label: string; icon: React.ElementType; bg: string; fg: string;
  route: string; action: string;
}> = {
  appointment: {
    label: "Awaiting confirmation", icon: CalendarCheck,
    bg: "bg-[hsl(40_55%_88%)]", fg: "text-[hsl(40_55%_30%)]",
    route: "/appointments", action: "Open appointments",
  },
  inventory: {
    label: "Critical stock", icon: Package,
    bg: "bg-[hsl(15_72%_90%)]", fg: "text-[hsl(15_60%_38%)]",
    route: "/supplies", action: "Open supplies",
  },
};

function categoryOf(type: string): Category | null {
  if (type === "appointment") return "appointment";
  if (type === "inventory") return "inventory";
  return null;
}

/* Postgres returns timestamps without a zone marker when the column is
   `timestamp` rather than `timestamptz`. Without the Z, the browser
   reads them as local time — so a notification from an hour ago shows
   as eight hours ago at UTC+8. */
function normalizeTimestamp(n: Notification): Notification {
  return {
    ...n,
    created_at:
      n.created_at.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(n.created_at)
        ? n.created_at
        : n.created_at + "Z",
  };
}

function groupLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "d MMMM yyyy");
}

export default function Notifications() {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | Category>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications();
      /* Filtered here rather than hidden behind a tab — a client
         registration shouldn't count towards the unread badge either. */
      setNotifications(
        data.filter((n) => categoryOf(n.type) !== null).map(normalizeTimestamp)
      );
    } catch {
      toast.error("Couldn't load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const channel = (supabase as any)
      .channel("notifications-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => void load()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const counts = {
    all: notifications.length,
    unread: notifications.filter((n) => !n.is_read).length,
    appointment: notifications.filter((n) => categoryOf(n.type) === "appointment").length,
    inventory: notifications.filter((n) => categoryOf(n.type) === "inventory").length,
  };

  const filtered = tab === "all"
    ? notifications
    : notifications.filter((n) => categoryOf(n.type) === tab);

  const selected = notifications.find((n) => n.id === selectedId) || null;

  // Grouped by day, in order, so the list has landmarks when scrolling.
  const groups: { label: string; items: Notification[] }[] = [];
  filtered.forEach((n) => {
    const label = groupLabel(new Date(n.created_at));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  });

  const openNotification = async (n: Notification) => {
    setSelectedId(n.id);
    if (!n.is_read) {
      await markAsRead(n.id);
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
      );
    }
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    toast.success("All notifications marked as read.");
  };

  const handleDelete = async (id: string) => {
    await deleteNotification(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    toast.success("Notification deleted.");
  };

  const handleDeleteAll = async () => {
    await deleteAllNotifications();
    setNotifications([]);
    setSelectedId(null);
    setConfirmClear(false);
    toast.success("All notifications cleared.");
  };

  const TABS: { key: "all" | Category; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "appointment", label: "Awaiting confirmation", count: counts.appointment },
    { key: "inventory", label: "Critical stock", count: counts.inventory },
  ];

  return (
    <AdminLayout
      title="Notifications"
      eyebrow={counts.unread > 0 ? `${counts.unread} unread` : "Nothing unread"}
      actions={
        <>
          {counts.unread > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="flex h-9 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-bold transition hover:bg-[hsl(var(--muted))]"
            >
              <CheckCheck size={15} /> Mark all read
            </button>
          )}
          {counts.all > 0 && (
            <button
              onClick={() => setConfirmClear(true)}
              className="flex h-9 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-bold text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--destructive)/.4)] hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]"
            >
              <Trash2 size={15} /> Clear all
            </button>
          )}
        </>
      }
    >
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        {/* ── Tabs ── */}
        <div className="workspace-card flex items-center gap-1 overflow-x-auto rounded-[24px] p-2">
          {TABS.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold transition ${
                tab === key
                  ? "bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  tab === key
                    ? "bg-[hsl(var(--primary)/.15)]"
                    : "bg-[hsl(var(--muted))]"
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">

          {/* ── List ── */}
          <section className="workspace-card overflow-hidden rounded-[26px]">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-20 text-center">
                <Bell className="mx-auto text-[hsl(var(--muted-foreground))]" />
                <p className="mt-3 text-sm font-bold">
                  {counts.all === 0 ? "No notifications" : `Nothing under ${
                    TABS.find((t) => t.key === tab)?.label.toLowerCase()
                  }`}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-[hsl(var(--muted-foreground))]">
                  {counts.all === 0
                    ? "Appointment requests and critical stock alerts appear here."
                    : "Try the other category."}
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 border-b border-[hsl(var(--border)/.7)] bg-[hsl(var(--card))] px-5 py-2.5 sm:px-6">
                    <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
                      {group.label}
                    </p>
                  </div>

                  {group.items.map((n) => {
                    const key = categoryOf(n.type);
                    if (!key) return null;
                    const cat = CATEGORY[key];
                    const Icon = cat.icon;
                    const active = selectedId === n.id;

                    return (
                      <button
                        key={n.id}
                        onClick={() => openNotification(n)}
                        className={`flex w-full items-start gap-3 border-b border-[hsl(var(--border)/.55)] px-5 py-4 text-left transition last:border-0 sm:px-6 ${
                          active ? "bg-[hsl(var(--secondary)/.4)]" : "hover:bg-[hsl(var(--muted)/.35)]"
                        }`}
                      >
                        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cat.bg} ${cat.fg}`}>
                          <Icon size={16} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <p className={`min-w-0 flex-1 text-sm ${n.is_read ? "" : "font-bold"}`}>
                              {n.title}
                            </p>
                            {/* An unread dot rather than a bold row
                                alone — bold is hard to spot in a list
                                where half the rows are bold. */}
                            {!n.is_read && (
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
                            )}
                          </div>

                          <p className="mt-0.5 line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
                            {n.message}
                          </p>

                          <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </section>

          {/* ── Detail ── */}
          <section className="workspace-card h-fit rounded-[26px] xl:sticky xl:top-5">
            {!selected ? (
              <div className="px-6 py-20 text-center">
                <Bell className="mx-auto text-[hsl(var(--muted-foreground))]" />
                <p className="mt-3 text-sm font-bold">Nothing selected</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-[hsl(var(--muted-foreground))]">
                  Choose a notification to read it in full.
                </p>
              </div>
            ) : (
              <NotificationDetail
                notification={selected}
                onClose={() => setSelectedId(null)}
                onDelete={() => handleDelete(selected.id)}
                onNavigate={(route) => navigate(route)}
              />
            )}
          </section>
        </div>
      </div>

      {/* ── Clear all ── */}
      {confirmClear && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-5">
          <div className="workspace-card w-full max-w-[420px] rounded-[28px] p-7">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]">
                <AlertTriangle size={21} />
              </div>
              <div className="min-w-0">
                <h2 className="display-face text-[26px] leading-none">
                  Clear all notifications?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                  All {counts.all} will be removed. The appointment requests and
                  stock levels themselves aren&apos;t affected — only these alerts
                  about them.
                </p>
              </div>
            </div>

            <div className="mt-7 flex justify-end gap-2">
              <button
                onClick={() => setConfirmClear(false)}
                className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]"
              >
                Keep them
              </button>
              <button
                onClick={handleDeleteAll}
                className="h-11 rounded-xl bg-[hsl(var(--destructive))] px-5 text-sm font-bold text-[hsl(var(--destructive-foreground))]"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function NotificationDetail({
  notification, onClose, onDelete, onNavigate,
}: {
  notification: Notification;
  onClose: () => void;
  onDelete: () => void;
  onNavigate: (route: string) => void;
}) {
  const key = categoryOf(notification.type);
  if (!key) return null;
  const cat = CATEGORY[key];
  const Icon = cat.icon;

  return (
    <div className="p-6 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${cat.bg} ${cat.fg}`}>
          <Icon size={20} />
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
        >
          <X size={17} />
        </button>
      </div>

      <p className="mt-5 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">
        {cat.label}
      </p>
      <h2 className="mt-2 text-lg font-bold leading-snug">{notification.title}</h2>

      <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">
        {format(new Date(notification.created_at), "d MMMM yyyy 'at' h:mm a")}
      </p>

      <p className="mt-5 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
        {notification.message}
      </p>

      <div className="mt-7 space-y-2 border-t border-[hsl(var(--border)/.7)] pt-6">
        <button
          onClick={() => onNavigate(cat.route)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))]"
        >
          {cat.action} <ArrowUpRight size={16} />
        </button>

        <button
          onClick={onDelete}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] text-sm font-bold text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--destructive)/.4)] hover:bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]"
        >
          <Trash2 size={15} /> Delete
        </button>
      </div>
    </div>
  );
}
