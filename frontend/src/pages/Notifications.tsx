import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import AdminLayout from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchNotifications, markAsRead, markAllAsRead,
  deleteNotification, deleteAllNotifications,
  isAwaitingAppointmentAlert, type Notification,
} from "@/api/notifications";
import { fetchProducts } from "@/api/products";
import { fetchInventory } from "@/api/inventory";
import { fetchClientsWithPets } from "@/api/clients";
import { getProductImage } from "@/components/InventoryCard";
import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";
import { toast } from "sonner";
import {
  Search, Package, Box, Bell, CheckCheck, Trash2,
  Loader2, AlertTriangle, ChevronRight, CalendarCheck, Check, X,
} from "lucide-react";

const LOW_STOCK_THRESHOLD = 10;

type CategoryKey = "awaiting" | "essentials" | "supplies";
type TabKey = "all" | "unread" | "out" | "low";
type StockLevel = "out" | "low";

interface StockRow {
  id: string;
  name: string;
  category: string;
  stock: number | null | undefined;
  image: string | null;
  fit: "cover" | "contain";
}

interface StockAlert extends Omit<StockRow, "stock"> {
  stock: number;
  level: StockLevel;
}

const CATEGORIES: {
  key: CategoryKey; label: string; caption: string; blurb: string; icon: React.ElementType;
}[] = [
  {
    key: "awaiting", label: "Awaiting Confirmation", caption: "Unread booking requests",
    blurb: "Booking requests from pet owners waiting for a decision", icon: CalendarCheck,
  },
  {
    key: "essentials", label: "Pet Essentials", caption: "Retail products to restock",
    blurb: `Retail products at ${LOW_STOCK_THRESHOLD} units or fewer`, icon: Package,
  },
  {
    key: "supplies", label: "Supplies", caption: "Clinic stock to restock",
    blurb: `Clinic-use stock at ${LOW_STOCK_THRESHOLD} units or fewer`, icon: Box,
  },
];

const LEVEL_LABEL: Record<StockLevel, string> = { out: "Out of stock", low: "Running low" };
const LEVEL_PILL: Record<StockLevel, string> = {
  out: "border-[hsl(12_58%_42%)] bg-[hsl(12_58%_94%)] text-[hsl(12_58%_34%)]",
  low: "border-[hsl(40_60%_72%)] bg-[hsl(40_80%_93%)] text-[hsl(40_70%_26%)]",
};

/* Long lists show this many rows, then "Show more". */
const PAGE_SIZE = 8;

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";
const CTL_BASE =
  `flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[12px] border-[1.5px] bg-[hsl(var(--card))] px-5 text-[15px] font-bold transition ${FOCUS_RING}`;

function stockLevel(stock: number | null | undefined): StockLevel | null {
  const n = stock ?? 0;
  if (n <= 0) return "out";
  if (n <= LOW_STOCK_THRESHOLD) return "low";
  return null;
}

/* Out of stock first, then running low; within each, the fewest units
   left at the top. */
function toAlerts(rows: StockRow[]): StockAlert[] {
  const alerts: StockAlert[] = [];
  for (const r of rows) {
    const level = stockLevel(r.stock);
    if (level) alerts.push({ ...r, stock: r.stock ?? 0, level });
  }
  return alerts.sort((a, b) =>
    a.level !== b.level
      ? (a.level === "out" ? -1 : 1)
      : a.stock - b.stock || a.name.localeCompare(b.name)
  );
}

function groupLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "d MMMM yyyy");
}

/* Booking alerts read "<owner name> booked <service> for <pet>", so the
   owner's name is everything before " booked ". It is used to find the
   owner's profile photo and to put their name in bold. */
function ownerNameOf(message?: string | null) {
  const m = (message ?? "").match(/^(.+?) booked /);
  return m ? m[1].trim() : null;
}

/* Names compared without caring about case or extra spaces. */
const normName = (s?: string | null) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function initialsOf(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
}

/* Search field: same height as the buttons beside it, a magnifier, a visible
   hint, and a clear button once something is typed. */
function SearchField({
  value, onChange, className = "",
}: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search notifications"
        aria-label="Search notifications"
        autoComplete="off"
        className="h-11 w-full rounded-[12px] border border-[hsl(var(--card-border))] bg-[hsl(var(--muted)/.6)] pl-11 pr-11 text-[15px] font-medium transition placeholder:font-normal placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:bg-[hsl(var(--card))] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className={`absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[10px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
        >
          <X size={16} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

/* Count in a small pill. `onDark` is for the selected (navy) tab. A dash
   while a count is still loading or failed to load — a zero there would
   read as "nothing needs attention". */
function CountChip({ n, onDark }: { n: number | null; onDark?: boolean }) {
  return (
    <span
      className={`inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-bold tabular-nums ${
        onDark
          ? "bg-[hsl(var(--primary-foreground)/.2)] text-[hsl(var(--primary-foreground))]"
          : "bg-[#E6E3D6] text-[hsl(var(--muted-foreground))]"
      }`}
    >
      {n === null ? "–" : n}
    </span>
  );
}

/* A labelled band that starts each group (a day, or a stock level). */
function Band({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 border-t border-[hsl(var(--card-border))] bg-[hsl(var(--muted)/.35)] px-5 py-2 text-[12px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))] sm:px-6">
      {label} <CountChip n={count} />
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <div className="border-t border-[hsl(var(--card-border))] px-6 py-14 text-center">
      <Icon className="mx-auto text-[hsl(var(--muted-foreground))]" />
      <p className="mt-3 text-[15px] font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[14px] text-[hsl(var(--muted-foreground))]">{text}</p>
    </div>
  );
}

function ListFooter({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--card-border))] px-5 py-4 text-[14px] text-[hsl(var(--muted-foreground))] sm:px-6">
      <span>
        Showing <b className="text-[hsl(var(--foreground))]">{shown}</b> of <b className="text-[hsl(var(--foreground))]">{total}</b>
      </span>
      {shown < total && (
        <button
          onClick={onMore}
          className={`flex h-10 items-center rounded-[12px] border-[1.5px] border-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
        >
          Show more ({total - shown} left)
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center border-t border-[hsl(var(--card-border))] py-16">
      <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
    </div>
  );
}

/* Same table language as the Dashboard and Appointments: a column header,
   one line per item, a small ringed photo, a status chip and the action at
   the end. Each row has two zones that are siblings, never a button inside
   a button. */
const AWAIT_GRID =
  "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,.9fr)_84px_176px] items-center gap-x-4 px-5 sm:px-6";
const STOCK_GRID =
  "grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_110px_132px_132px] items-center gap-x-4 px-5 sm:px-6";
const HEAD_ROW =
  "border-t border-[hsl(var(--card-border))] bg-[hsl(var(--muted)/.6)] py-3 text-[13px] font-semibold text-[hsl(var(--muted-foreground))]";
const ICON_BTN =
  `grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`;
const ROW_BTN =
  `inline-flex h-9 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] px-3 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`;
const CHIP = "inline-flex h-[28px] items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-3 text-[13px] font-bold";

function TableAvatar({
  src, initials, fit = "cover", Icon,
}: { src?: string | null; initials?: string; fit?: "cover" | "contain"; Icon: React.ElementType }) {
  return (
    <div
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[hsl(var(--primary))] text-[13px] font-bold ${
        src && fit === "contain" ? "bg-[hsl(var(--card))]" : "bg-[hsl(var(--primary))] text-[hsl(var(--accent))]"
      }`}
    >
      {src ? (
        <img src={src} alt="" className={`h-full w-full ${fit === "contain" ? "object-contain p-0.5" : "object-cover"}`} />
      ) : initials ? (
        initials
      ) : (
        <Icon size={18} />
      )}
    </div>
  );
}

/* "<owner> booked <service> for <pet>" into its three parts, so each gets its
   own column. If the wording ever differs, the whole text shows as the
   service and nothing is lost. */
function parseBooking(message?: string | null) {
  const m = (message ?? "").match(/^(.+?) booked (.+) for (.+)$/);
  return m
    ? { owner: m[1].trim(), service: m[2].trim(), pet: m[3].trim() }
    : { owner: ownerNameOf(message), service: message ?? "", pet: "" };
}

function AwaitingHeader() {
  return (
    <div className={`${AWAIT_GRID} ${HEAD_ROW}`}>
      <span>Owner</span><span>Request</span><span>Patient</span><span>Received</span><span>Status</span>
      <span className="text-right">Action</span>
    </div>
  );
}

function AwaitingRow({
  n, photo, onOpen, onRead, onDelete,
}: { n: Notification; photo?: string | null; onOpen: () => void; onRead: () => void; onDelete: () => void }) {
  const { owner, service, pet } = parseBooking(n.message);
  const when = new Date(n.created_at);
  return (
    <div className={`${AWAIT_GRID} border-t border-[hsl(var(--card-border))] py-3 transition hover:bg-[hsl(var(--muted)/.35)]`}>
      <button onClick={onOpen} className={`flex min-w-0 items-center gap-3 rounded-[12px] text-left ${FOCUS_RING}`}>
        <TableAvatar src={photo} initials={owner ? initialsOf(owner) : undefined} Icon={CalendarCheck} />
        <span className={`min-w-0 truncate text-[15px] ${n.is_read ? "font-medium" : "font-bold"}`}>{owner || "Unknown owner"}</span>
      </button>
      <div className="min-w-0">
        <p className={`truncate text-[15px] ${n.is_read ? "font-medium text-[hsl(var(--muted-foreground))]" : "font-bold"}`}>{service}</p>
        <p className="truncate text-[13px] text-[hsl(var(--muted-foreground))]">{n.title}</p>
      </div>
      <p className="min-w-0 truncate text-[15px]">{pet || "–"}</p>
      <div className="min-w-0" title={format(when, "d MMM yyyy, h:mm a")}>
        <p className="truncate text-[14px]">{formatDistanceToNow(when, { addSuffix: true })}</p>
        <p className="truncate text-[13px] text-[hsl(var(--muted-foreground))]">{format(when, "h:mm a")}</p>
      </div>
      <div>
        {n.is_read ? (
          <span className={`${CHIP} border-[hsl(var(--card-border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]`}>Seen</span>
        ) : (
          <span className={`${CHIP} border-[hsl(40_60%_72%)] bg-[hsl(40_80%_93%)] text-[hsl(40_70%_26%)]`}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[hsl(40_70%_40%)]" />New
          </span>
        )}
      </div>
      <div className="flex items-center justify-end gap-1">
        <button onClick={onOpen} className={ROW_BTN}>
          Review <ChevronRight size={15} strokeWidth={2.6} aria-hidden="true" />
        </button>
        {!n.is_read ? (
          <button onClick={onRead} aria-label="Mark as read" title="Mark as read" className={`${ICON_BTN} hover:text-[hsl(var(--primary))]`}>
            <Check size={17} strokeWidth={2.6} />
          </button>
        ) : (
          <span className="h-9 w-9 shrink-0" aria-hidden="true" />
        )}
        <button
          onClick={onDelete}
          aria-label="Delete notification"
          title="Delete"
          className={`${ICON_BTN} hover:!bg-[hsl(var(--destructive)/.08)] hover:text-[hsl(var(--destructive))]`}
        >
          <Trash2 size={17} />
        </button>
      </div>
    </div>
  );
}

function StockHeader() {
  return (
    <div className={`${STOCK_GRID} ${HEAD_ROW}`}>
      <span>Product</span><span>Category</span><span>On hand</span><span>Status</span>
      <span className="text-right">Action</span>
    </div>
  );
}

function StockRowItem({
  a, icon: Icon, onOpen,
}: { a: StockAlert; icon: React.ElementType; onOpen: () => void }) {
  return (
    <div className={`${STOCK_GRID} border-t border-[hsl(var(--card-border))] py-3 transition hover:bg-[hsl(var(--muted)/.35)]`}>
      <button onClick={onOpen} className={`flex min-w-0 items-center gap-3 rounded-[12px] text-left ${FOCUS_RING}`}>
        <TableAvatar src={a.image} fit={a.fit} Icon={Icon} />
        <span className="min-w-0 truncate text-[15px] font-bold">{a.name}</span>
      </button>
      <p className="min-w-0 truncate text-[15px] text-[hsl(var(--muted-foreground))]">{a.category}</p>
      <p className="text-[15px] font-bold tabular-nums">
        {a.stock === 0 ? "None" : `${a.stock} unit${a.stock === 1 ? "" : "s"}`}
      </p>
      <div>
        <span className={`${CHIP} ${LEVEL_PILL[a.level]}`}>{LEVEL_LABEL[a.level]}</span>
      </div>
      <div className="flex justify-end">
        <button onClick={onOpen} className={ROW_BTN}>
          Restock <ChevronRight size={15} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [category, setCategory] = useState<CategoryKey>("awaiting");
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications();
      setNotifications(data.filter(isAwaitingAppointmentAlert));
    } catch {
      toast.error("Couldn't load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const channelName = `notifications-page-${Math.random().toString(36).slice(2)}`;
    const channel = (supabase as any)
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => void load()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const productsQuery = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const inventoryQuery = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });

  /* Owners' profile photos for the booking alerts. These come from the same
     list the Patients screen uses, so a photo shows here exactly when it
     shows there. The alert only carries the owner's name, so owners are
     matched by name; anyone without a photo (or whose name doesn't match)
     shows initials. */
  const clientsQuery = useQuery({
    queryKey: ["clients-with-pets"],
    queryFn: fetchClientsWithPets,
    staleTime: 5 * 60 * 1000,
  });
  const ownerPhotos = useMemo(() => {
    const map: Record<string, string> = {};
    (clientsQuery.data ?? []).forEach((c: any) => {
      const key = normName(c.name);
      if (key && c.avatar_url && !map[key]) map[key] = c.avatar_url;
    });
    return map;
  }, [clientsQuery.data]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const q = search.trim().toLowerCase();
  const hit = (...parts: (string | null | undefined)[]) =>
    !q || parts.some((p) => (p ?? "").toLowerCase().includes(q));

  const essentialsAll = toAlerts(
    (productsQuery.data ?? []).map((p) => ({
      id: p.id, name: p.name, category: p.category, stock: p.stock,
      image: p.image_url ?? null, fit: "cover" as const,
    }))
  );
  const suppliesAll = toAlerts(
    (inventoryQuery.data ?? []).map((i) => ({
      id: i.id, name: i.name, category: i.category, stock: i.stock,
      image: getProductImage(i.image_key) || null, fit: "contain" as const,
    }))
  );

  const awaitingMatching = notifications.filter((n) => hit(n.title, n.message));
  const essentialsMatching = essentialsAll.filter((a) => hit(a.name, a.category));
  const suppliesMatching = suppliesAll.filter((a) => hit(a.name, a.category));

  const essentialsReady = !productsQuery.isLoading && !productsQuery.isError;
  const suppliesReady = !inventoryQuery.isLoading && !inventoryQuery.isError;

  const counts: Record<CategoryKey, number | null> = {
    awaiting: loading ? null : awaitingMatching.filter((n) => !n.is_read).length,
    essentials: essentialsReady ? essentialsMatching.length : null,
    supplies: suppliesReady ? suppliesMatching.length : null,
  };

  const selectCategory = (key: CategoryKey) => { setCategory(key); setTab("all"); setLimit(PAGE_SIZE); };

  const meta = CATEGORIES.find((c) => c.key === category)!;

  const isStock = category !== "awaiting";
  const stock = category === "essentials"
    ? { all: essentialsAll, matching: essentialsMatching, query: productsQuery, ready: essentialsReady, noun: "product", allClear: `Every product has more than ${LOW_STOCK_THRESHOLD} units.` }
    : { all: suppliesAll, matching: suppliesMatching, query: inventoryQuery, ready: suppliesReady, noun: "supply", allClear: `Every supply has more than ${LOW_STOCK_THRESHOLD} units on hand.` };

  const awaitingUnread = awaitingMatching.filter((n) => !n.is_read);
  const tabs: { key: TabKey; label: string; count: number | null }[] = isStock
    ? [
        { key: "all", label: "Show all", count: stock.ready ? stock.matching.length : null },
        { key: "out", label: "Out of stock", count: stock.ready ? stock.matching.filter((a) => a.level === "out").length : null },
        { key: "low", label: "Running low", count: stock.ready ? stock.matching.filter((a) => a.level === "low").length : null },
      ]
    : [
        { key: "all", label: "Show all", count: loading ? null : awaitingMatching.length },
        { key: "unread", label: "Unread", count: loading ? null : awaitingUnread.length },
      ];

  const openNotification = async (n: Notification) => {
    if (!n.is_read) {
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
      );
      try {
        await markAsRead(n.id);
      } catch {
        setNotifications((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, is_read: false } : x))
        );
      }
    }
    navigate("/appointments");
  };

  const openInventory = (itemId: string) => navigate("/inventory", { state: { tab: category, itemId } });

  const handleMarkRead = async (id: string) => {
    setNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: true } : x)));
    try {
      await markAsRead(id);
    } catch {
      setNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: false } : x)));
      toast.error("Couldn't mark it as read.");
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Couldn't mark them as read.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      toast.success("Notification deleted.");
    } catch {
      toast.error("Couldn't delete that notification.");
    }
  };

  const handleDeleteAll = async () => {
    try {
      await deleteAllNotifications();
      setNotifications([]);
      setConfirmClear(false);
      toast.success("All notifications cleared.");
    } catch {
      toast.error("Couldn't clear notifications.");
    }
  };

  const renderBody = (): ReactNode => {
    if (!isStock) {
      if (loading) return <Spinner />;
      if (notifications.length === 0) {
        return (
          <EmptyState
            icon={Bell}
            title="No notifications"
            text="Booking requests waiting for confirmation appear here."
          />
        );
      }
      const visible = tab === "unread" ? awaitingUnread : awaitingMatching;
      if (visible.length === 0) {
        return (
          <EmptyState
            icon={Search}
            title={tab === "unread" && !q ? "Nothing unread" : "No matches"}
            text={tab === "unread" && !q ? "You've seen every request." : "Try a different search."}
          />
        );
      }
      // Grouped by day, in order, so the list has landmarks when scrolling.
      const groups: { label: string; items: Notification[] }[] = [];
      const dayTotals: Record<string, number> = {};
      visible.forEach((n) => {
        const l = groupLabel(new Date(n.created_at));
        dayTotals[l] = (dayTotals[l] || 0) + 1;
      });
      visible.slice(0, limit).forEach((n) => {
        const label = groupLabel(new Date(n.created_at));
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(n);
        else groups.push({ label, items: [n] });
      });
      return (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
          <AwaitingHeader />
          {groups.map((g) => (
            <section key={g.label}>
              <Band label={g.label} count={dayTotals[g.label]} />
              {g.items.map((n) => (
                <AwaitingRow
                  key={n.id}
                  n={n}
                  photo={ownerPhotos[normName(ownerNameOf(n.message))]}
                  onOpen={() => openNotification(n)}
                  onRead={() => void handleMarkRead(n.id)}
                  onDelete={() => handleDelete(n.id)}
                />
              ))}
            </section>
          ))}
            </div>
          </div>
          <ListFooter shown={Math.min(limit, visible.length)} total={visible.length} onMore={() => setLimit((l) => l + PAGE_SIZE)} />
        </>
      );
    }

    if (stock.query.isLoading) return <Spinner />;
    if (stock.query.isError) {
      return (
        <div className="border-t border-[hsl(var(--card-border))] px-6 py-14 text-center">
          <AlertTriangle className="mx-auto text-[hsl(var(--destructive))]" />
          <p className="mt-3 text-[15px] font-bold">Couldn&apos;t load stock levels</p>
          <button
            onClick={() => void stock.query.refetch()}
            className={`${CTL_BASE} mx-auto mt-4 border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]`}
          >
            Try again
          </button>
        </div>
      );
    }
    if (stock.all.length === 0) {
      return <EmptyState icon={CheckCheck} title="Nothing running low" text={stock.allClear} />;
    }
    const out = stock.matching.filter((a) => a.level === "out");
    const low = stock.matching.filter((a) => a.level === "low");
    const sections = [
      ...(tab !== "low" && out.length ? [{ key: "out" as const, items: out }] : []),
      ...(tab !== "out" && low.length ? [{ key: "low" as const, items: low }] : []),
    ];
    if (sections.length === 0) {
      return (
        <EmptyState
          icon={Search}
          title="No matches"
          text={q ? "Try a different search." : `No ${stock.noun} is ${tab === "out" ? "out of stock" : "running low"}.`}
        />
      );
    }
    const stockTotal = sections.reduce((t, s) => t + s.items.length, 0);
    let budget = limit;
    const trimmed = sections
      .map((s) => {
        const items = s.items.slice(0, Math.max(budget, 0));
        budget -= items.length;
        return { key: s.key, items, total: s.items.length };
      })
      .filter((s) => s.items.length > 0);
    return (
      <>
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
        <StockHeader />
        {trimmed.map((s) => (
          <section key={s.key}>
            <Band label={LEVEL_LABEL[s.key]} count={s.total} />
            {s.items.map((a) => (
              <StockRowItem key={a.id} a={a} icon={meta.icon} onOpen={() => openInventory(a.id)} />
            ))}
          </section>
        ))}
          </div>
        </div>
        <ListFooter shown={Math.min(limit, stockTotal)} total={stockTotal} onMore={() => setLimit((l) => l + PAGE_SIZE)} />
      </>
    );
  };

  return (
    <AdminLayout title="Notifications">
      <div className="min-h-full w-full space-y-4 bg-[hsl(var(--background))] px-3 pb-6 pt-0 sm:px-5">

        {/* ── Categories: each is a filter and says what needs attention ── */}
        <div role="group" aria-label="Notification categories" className="grid gap-3 sm:grid-cols-3">
          {CATEGORIES.map((c) => {
            const active = c.key === category;
            /* Stock cards say how urgent it is, not just how many: what is
               already out of stock comes first. */
            const rows = c.key === "essentials" ? essentialsMatching : c.key === "supplies" ? suppliesMatching : null;
            const outN = rows ? rows.filter((a) => a.level === "out").length : 0;
            const lowN = rows ? rows.filter((a) => a.level === "low").length : 0;
            const n = counts[c.key];
            const caption =
              n === null ? c.caption
                : rows ? (outN > 0 ? `${outN} out of stock · ${lowN} running low` : lowN > 0 ? `${lowN} running low` : "Nothing running low")
                : n === 0 ? "All caught up" : c.caption;
            const CardIcon = c.icon;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => selectCategory(c.key)}
                aria-current={active ? "true" : undefined}
                className={`block min-w-0 rounded-[20px] border bg-[hsl(var(--card))] px-5 py-4 text-left transition ${FOCUS_RING} ${
                  active
                    ? "border-[hsl(var(--primary))] shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
                    : "border-[hsl(var(--card-border))] hover:border-[hsl(var(--primary)/.45)]"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold text-[hsl(var(--muted-foreground))]">{c.label}</span>
                  <CardIcon size={18} aria-hidden="true" className={outN > 0 ? "text-[hsl(12_58%_34%)]" : "text-[hsl(var(--muted-foreground))]"} />
                </span>
                <span className={`mt-1 block text-[32px] font-bold leading-[1.1] tabular-nums ${outN > 0 ? "text-[hsl(12_58%_34%)]" : "text-[hsl(var(--foreground))]"}`}>
                  {counts[c.key] === null ? "–" : counts[c.key]}
                </span>
                <span className={`mt-0.5 block truncate text-[14px] ${outN > 0 ? "font-semibold text-[hsl(12_58%_34%)]" : "text-[hsl(var(--muted-foreground))]"}`}>{caption}</span>
              </button>
            );
          })}
        </div>

        {/* ── Selected category: title, filters, then the table ── */}
        <section
          aria-labelledby="notif-heading"
          className="overflow-hidden rounded-[20px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))]"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 sm:px-6">
            <div className="min-w-0">
              <h2 id="notif-heading" className="text-[22px] font-bold leading-[1.2] tracking-[-.02em]">
                {meta.label}
              </h2>
              <p className="mt-0.5 text-[14px] text-[hsl(var(--muted-foreground))]">{meta.blurb}</p>
            </div>
            {category === "awaiting" && (
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllAsRead}
                    className={`${CTL_BASE} border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]`}
                  >
                    <CheckCheck size={17} aria-hidden="true" /> Mark all read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className={`${CTL_BASE} border-transparent bg-transparent text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.08)]`}
                  >
                    <Trash2 size={17} aria-hidden="true" /> Clear all
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pt-4 sm:px-6">
            <div
              role="tablist"
              aria-label={`${meta.label} filters`}
              className="inline-flex max-w-full gap-1 overflow-x-auto rounded-[14px] bg-[hsl(var(--muted))] p-1"
            >
              {tabs.map((t) => {
                const active = t.key === tab;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => { setTab(t.key); setLimit(PAGE_SIZE); }}
                    className={`flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-4 text-[15px] font-semibold transition ${FOCUS_RING} ${
                      active
                        ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                        : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--card)/.7)]"
                    }`}
                  >
                    {t.label} <CountChip n={t.count} onDark={active} />
                  </button>
                );
              })}
            </div>
            <SearchField
              value={search}
              onChange={(v) => { setSearch(v); setLimit(PAGE_SIZE); }}
              className="min-w-[200px] flex-1 basis-[240px]"
            />
          </div>
          {renderBody()}
        </section>
      </div>

      {/* ── Clear all ── */}
      {confirmClear && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-5">
          <div className="workspace-card w-full max-w-[460px] rounded-[28px] p-7">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--destructive))] text-[hsl(var(--destructive))]">
                <AlertTriangle size={22} />
              </div>
              <div className="min-w-0">
                <h2 className="text-[28px] font-bold leading-[34px] tracking-[-.02em]">
                  Clear all notifications?
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  All {notifications.length} will be removed. The appointment
                  requests themselves aren&apos;t affected — only these alerts
                  about them.
                </p>
              </div>
            </div>
            <div className="mt-7 flex justify-end gap-3">
              <button
                onClick={() => setConfirmClear(false)}
                className={`${CTL_BASE} border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]`}
              >
                Keep them
              </button>
              <button
                onClick={handleDeleteAll}
                className={`flex h-10 items-center justify-center rounded-[12px] bg-[hsl(var(--destructive))] px-6 text-[15px] font-bold text-[hsl(var(--destructive-foreground))] ${FOCUS_RING}`}
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
