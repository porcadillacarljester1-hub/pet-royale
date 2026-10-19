import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

/* Shared by Billing and Reports so the two screens count the same days and
   offer the same calendar. Save as src/components/RangePicker.tsx. Reports
   still has its own copy of this code; to keep them from drifting apart,
   delete that copy and import from here instead. */

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";
const FLOAT_BOX =
  "w-full rounded-[16px] border-[1.5px] border-[hsl(var(--input))] bg-[hsl(var(--card))] text-[16px] font-medium transition focus:border-[hsl(var(--primary))] focus:outline-none";
const FLOAT_LABEL_UP = "pointer-events-none absolute left-4 top-2 text-[13px] font-medium leading-4 text-[hsl(var(--muted-foreground))]";

/* Local date parts: toISOString() converts to UTC, which shifts a day at UTC+8. */
export function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* "Today" is the clinic's today (Philippines), not the browser's clock.
   clinicNow() is that day at local midnight, ready for date maths. */
export const clinicToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
export const clinicNow = () => new Date(`${clinicToday()}T00:00:00`);

/* A database timestamp as the clinic's calendar day (YYYY-MM-DD). */
export const clinicDay = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
};

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);

/* The longest range the calendar allows (about 12 months). */
export const MAX_RANGE_DAYS = 366;

export function fmtDisplay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function safeDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions) {
  if (!iso) return "No date";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString("en-US", opts);
}

/* One calendar for a date range: tap the first day, then the last day.
   Rules: the last day can't be before the first (tapping an earlier day
   restarts the range there), a range is at most about 12 months, and days
   after today are unavailable. Quick picks sit on top. */
export function RangePicker({
  from, to, onChange, open, onOpenChange, allowFuture = false, compact = false,
}: {
  from: string; to: string; onChange: (from: string, to: string) => void;
  open: boolean; onOpenChange: (o: boolean) => void;
  /* Reports and Billing only look backwards, so days after today are off by
     default. The Appointments screen is a schedule: it passes true, and days
     up to a year ahead can be picked. */
  allowFuture?: boolean;
  compact?: boolean;
}) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const todayIso = clinicToday();
  const start = new Date(`${from || todayIso}T00:00:00`);
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const monthName = new Date(view.y, view.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => toISO(new Date(view.y, view.m, i + 1))),
  ];
  const shift = (n: number) =>
    setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const close = () => { setAnchor(null); setHover(null); onOpenChange(false); };

  const unavailable = (iso: string) => {
    if (!allowFuture && iso > todayIso) return true;
    if (allowFuture && daysBetween(todayIso, iso) > MAX_RANGE_DAYS) return true;
    if (anchor && iso > anchor && daysBetween(anchor, iso) + 1 > MAX_RANGE_DAYS) return true;
    return false;
  };
  const pick = (iso: string) => {
    if (unavailable(iso)) return;
    if (!anchor || iso < anchor) { setAnchor(iso); setHover(null); return; }
    onChange(anchor, iso);
    close();
  };

  const now = clinicNow();
  const presets: { label: string; a: Date; b: Date }[] = allowFuture
    ? [
        { label: "Next 7 days", a: now, b: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6) },
        { label: "Next 30 days", a: now, b: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 29) },
        { label: "Last 7 days", a: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), b: now },
        { label: "Last month", a: new Date(now.getFullYear(), now.getMonth() - 1, 1), b: new Date(now.getFullYear(), now.getMonth(), 0) },
      ]
    : [
    { label: "Last 7 days", a: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), b: now },
    { label: "Last 30 days", a: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29), b: now },
    { label: "Last 90 days", a: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89), b: now },
    { label: "This year", a: new Date(now.getFullYear(), 0, 1), b: now },
    { label: "Last year", a: new Date(now.getFullYear() - 1, 0, 1), b: new Date(now.getFullYear() - 1, 11, 31) },
  ];
  const a0 = anchor ?? from;
  const b0 = anchor ? (hover && hover >= anchor && !unavailable(hover) ? hover : anchor) : to;
  const lo = a0 < b0 ? a0 : b0;
  const hi = a0 < b0 ? b0 : a0;
  const label = `${safeDate(from, { month: "short", day: "numeric" })} – ${safeDate(to, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="relative min-w-0 shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className={compact
          ? `flex h-10 min-w-[176px] items-center gap-2 rounded-xl border border-[hsl(var(--input))] bg-white px-3 text-left text-[13px] font-semibold text-[hsl(var(--foreground))] transition hover:border-[hsl(var(--primary))] ${FOCUS_RING}`
          : `relative h-14 min-w-[225px] ${FLOAT_BOX} px-4 pb-1 pt-6 text-left ${FOCUS_RING}`}
      >
        {compact ? (
          <>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-[hsl(var(--muted-foreground))]" />
          </>
        ) : (
          <>
            {label}
            <span className={FLOAT_LABEL_UP}>Date range</span>
            <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          </>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div
            onClick={(ev) => ev.stopPropagation()}
            className="max-h-[94vh] w-[400px] max-w-full overflow-y-auto rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))] p-5 shadow-[0_24px_60px_-20px_rgb(5_31_66/.55)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[22px] font-bold leading-7 tracking-[-.02em]">Select dates</h3>
              <button type="button" onClick={close} className={`flex h-12 items-center rounded-full px-3 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}>Close</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { onChange(toISO(p.a), toISO(p.b)); close(); }}
                  className={`h-10 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-[20px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-2 py-2">
              <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className={`flex h-10 w-10 items-center justify-center rounded-full text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}>
                <ChevronLeft size={22} />
              </button>
              <p className="text-[16px] font-bold">{monthName}</p>
              <button type="button" onClick={() => shift(1)} aria-label="Next month" className={`flex h-10 w-10 items-center justify-center rounded-full text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}>
                <ChevronRight size={22} />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-7 text-center text-[13px] font-bold text-[hsl(var(--muted-foreground))]">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d} className="py-1.5">{d}</span>)}
            </div>
            <div className="grid grid-cols-7" onMouseLeave={() => setHover(null)}>
              {cells.map((iso, i) => {
                if (!iso) return <span key={`b${i}`} />;
                const edge = iso === lo || iso === hi;
                const inside = iso > lo && iso < hi;
                const blocked = unavailable(iso);
                return (
                  <div
                    key={iso}
                    className={`flex h-9 items-center justify-center ${inside ? "bg-[hsl(var(--muted))]" : ""} ${inside && i % 7 === 0 ? "rounded-l-full" : ""} ${inside && i % 7 === 6 ? "rounded-r-full" : ""} ${iso === lo && hi !== lo ? "rounded-l-full bg-[hsl(var(--muted))]" : ""} ${iso === hi && hi !== lo ? "rounded-r-full bg-[hsl(var(--muted))]" : ""}`}
                  >
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => pick(iso)}
                      onMouseEnter={() => anchor && setHover(iso)}
                      aria-pressed={edge}
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS_RING} ${
                        edge
                          ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                          : `hover:bg-[hsl(var(--muted))] ${iso === todayIso ? "ring-[1.5px] ring-inset ring-[hsl(var(--primary))]" : ""}`
                      }`}
                    >
                      {Number(iso.slice(8))}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[14px] text-[hsl(var(--muted-foreground))]">
              {anchor
                ? "Now pick the last day. It can't be before the first day."
                : allowFuture
                  ? "Pick the first day, then the last day. Up to 12 months."
                  : "Pick the first day, then the last day. Up to 12 months, and not after today."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
