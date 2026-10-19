import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Check, X, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/* ══════════════════ Operating hours ══════════════════
   Reads and writes booking_categories, the same rows the booking
   screen obeys and the Clinic details preview reads, so the hours
   advertised and the hours bookable can't drift apart.

   Always editable (columns that already exist):
     opening_time, last_slot, closed_day, is_active

   Editable once migration 041 has run (new columns):
     duration_minutes  how long one appointment takes (Duration)
     slot_minutes      gap between bookable start times
     break_start/end   one break for the whole clinic

   Until 041 runs, those fields are hidden and a notice says why.

   Layout (matches Appointments / Billing / Inventory): a break card, then
   one card with a card per service. Each service has its name and summary
   on the left with the Open and Delete buttons always visible on the right,
   and its fields in a wrapping row underneath, so nothing scrolls sideways
   and no button is ever pushed off screen. */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const CUSTOM = "custom";
/* One shared empty list. A new [] on every render makes the effect below run again forever. */
const NO_ROWS: Cat[] = [];

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";
const CARD = "overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))]";
const FLOAT_BOX = "w-full rounded-xl border border-[hsl(var(--input))] bg-white text-[15px] font-semibold transition focus:border-[hsl(var(--primary))] focus:outline-none";
const FLOAT_LABEL_UP = "pointer-events-none absolute left-4 top-2 text-[12px] font-semibold leading-4 text-[hsl(var(--muted-foreground))]";
/* Compact buttons, the same size and shape as the other admin screens. */
const BTN_OUTLINE_SM = `inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border-[1.5px] border-[hsl(var(--primary))] bg-transparent px-4 text-[14px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${FOCUS_RING}`;
const BTN_SOLID_SM = `inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[hsl(var(--primary))] px-5 text-[14px] font-semibold text-[hsl(var(--primary-foreground))] shadow-[0_4px_12px_rgb(5_31_66/.22)] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none ${FOCUS_RING}`;

interface Cat {
  id: string;
  name: string;
  opening_time: string;
  last_slot: string;
  closed_day: number;
  is_active: boolean;
  slot_minutes?: number;
  duration_minutes?: number;
  break_start?: string | null;
  break_end?: string | null;
  description?: string | null;
  sort_order?: number | null;
}

interface NewService {
  name: string;
  description: string;
  open: string;
  last: string;
  closed: number;
  duration: number;
  slot: number;
  active: boolean;
}

interface Draft {
  active: boolean;
  open: string;
  last: string;
  closed: number;
  slot: number;
  duration: number;
  brk: boolean;
  bs: string;
  be: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : "");
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const fmtMin = (n: number) => {
  const h = Math.floor(n / 60) % 24;
  const m = n % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
};

/* The most visits one service can take on an open day. A booking holds only
   its own start time, so this is how many start times the booking screen
   offers: one every `slot` minutes from opening to the last booking, skipping
   any time whose visit would run into the break. */
function visitsPerDay(d: Draft): number {
  const open = toMin(d.open);
  const last = toMin(d.last);
  if (!(d.slot > 0) || !(d.duration > 0) || !(last >= open)) return 0;
  let n = 0;
  for (let t = open; t <= last; t += d.slot) {
    if (d.brk && t < toMin(d.be) && t + d.duration > toMin(d.bs)) continue;
    n++;
  }
  return n;
}

const toDraft = (c: Cat): Draft => ({
  active: !!c.is_active,
  open: hhmm(c.opening_time),
  last: hhmm(c.last_slot),
  closed: c.closed_day,
  slot: c.slot_minutes ?? 30,
  duration: c.duration_minutes ?? 30,
  brk: !!c.break_start && !!c.break_end,
  bs: hhmm(c.break_start) || "12:00",
  be: hhmm(c.break_end) || "13:00",
});

function problem(d: Draft, extras: boolean): string {
  if (!d.open || !d.last) return "Set the opening time and the last booking time.";
  if (toMin(d.last) < toMin(d.open)) return "The last booking must be after opening.";
  if (extras) {
    if (!(d.slot >= 5 && d.slot <= 240)) return "Start times need to be between 5 and 240 minutes apart.";
    if (!(d.duration >= 5 && d.duration <= 480)) return "Duration needs to be between 5 and 480 minutes.";
  }
  return "";
}

/* One break for the whole clinic, so it's checked once, not per service. */
function breakProblem(d: Draft): string {
  if (d.brk && !(toMin(d.be) > toMin(d.bs))) return "The break must end after it starts.";
  return "";
}

/* The name is what owners see in the app, and what past appointments and
   invoices were recorded under, so it is checked before anything is saved. */
const tidyName = (v: string) => v.replace(/\s+/g, " ").trim();

function nameProblem(raw: string, existing: string[]): string {
  const n = tidyName(raw);
  if (!n) return "";
  if (n.length < 2) return "Use at least 2 characters.";
  if (n.length > 40) return "Keep the name to 40 characters or fewer.";
  if (existing.some((e) => tidyName(e).toLowerCase() === n.toLowerCase())) {
    return "There's already a service with this name.";
  }
  return "";
}

function FloatText({
  id, label, value, onChange, error, hint, optional, maxLength, autoFocus,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  error?: string; hint?: string; optional?: boolean; maxLength?: number; autoFocus?: boolean;
}) {
  const note = error || hint;
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          aria-describedby={note ? `${id}-note` : undefined}
          className={`h-14 ${FLOAT_BOX} px-4 pb-1.5 pt-6 ${error ? "!border-[hsl(var(--destructive))]" : ""}`}
        />
        <label htmlFor={id} className={FLOAT_LABEL_UP}>
          {label}{optional && <span className="font-normal"> · Optional</span>}
        </label>
      </div>
      {note && (
        <p
          id={`${id}-note`}
          role={error ? "alert" : undefined}
          className={`mt-1.5 px-1 text-[14px] ${error ? "font-semibold text-[hsl(var(--destructive))]" : "text-[hsl(var(--muted-foreground))]"}`}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function FloatSelect({
  id, label, value, onChange, children,
}: { id: string; label: string; value: number; onChange: (v: number) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`h-14 ${FLOAT_BOX} appearance-none px-4 pb-1.5 pt-6 pr-10`}
      >
        {children}
      </select>
      <label htmlFor={id} className={FLOAT_LABEL_UP}>{label}</label>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

function FloatMinutes({
  id, label, value, onChange, error, min, max,
}: { id: string; label: string; value: number; onChange: (v: number) => void; error?: boolean; min: number; max: number }) {
  return (
    <div className="relative">
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={5}
        value={value || ""}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        aria-invalid={!!error}
        className={`h-14 ${FLOAT_BOX} px-4 pb-1.5 pt-6 pr-12 tabular-nums ${error ? "!border-[hsl(var(--destructive))]" : ""}`}
      />
      <label htmlFor={id} className={FLOAT_LABEL_UP}>{label}</label>
      <span aria-hidden="true" className="pointer-events-none absolute right-4 top-[30px] text-[14px] text-[hsl(var(--muted-foreground))]">min</span>
    </div>
  );
}

function FloatTime({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-[180px]">
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`h-14 ${FLOAT_BOX} px-4 pb-1.5 pt-6`}
      />
      <span className={FLOAT_LABEL_UP}>{label}</span>
    </div>
  );
}

/* Same filled pill as the status chips on Appointments, but pressable. */
function StatePill({
  on, onLabel, offLabel, onClick, label,
}: { on: boolean; onLabel: string; offLabel: string; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className={`inline-flex h-10 scroll-mb-24 items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-4 text-[14px] font-semibold transition ${FOCUS_RING} ${
        on
          ? "border-transparent bg-[hsl(145_40%_90%)] text-[hsl(145_42%_24%)] hover:bg-[hsl(145_40%_85%)]"
          : "border-dashed border-[hsl(var(--muted-foreground))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
      }`}
    >
      {on ? <Check size={15} strokeWidth={2.6} aria-hidden="true" /> : <X size={15} strokeWidth={2.6} aria-hidden="true" />}
      {on ? onLabel : offLabel}
    </button>
  );
}

/* The clinic-wide break switch: a pill with the state in words and a
   sliding switch at its right edge. */
function BreakSwitch({
  on, onLabel, offLabel, onClick, label,
}: { on: boolean; onLabel: string; offLabel: string; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-11 items-center gap-2.5 whitespace-nowrap rounded-full border-[1.5px] bg-transparent pl-4 pr-1.5 text-[14px] font-bold transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING} ${
        on
          ? "border-[hsl(145_42%_27%)] text-[hsl(145_42%_27%)]"
          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
      }`}
    >
      <span>{on ? onLabel : offLabel}</span>
      <span
        aria-hidden="true"
        className={`relative h-[26px] w-10 rounded-full transition-colors ${on ? "bg-[hsl(145_42%_27%)]" : "bg-[#C9C5B4]"}`}
      >
        <span
          className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-[14px]" : ""}`}
        />
      </span>
    </button>
  );
}

export default function HoursSection() {
  const queryClient = useQueryClient();

  const { data: rows = NO_ROWS, isLoading } = useQuery<Cat[]>({
    queryKey: ["settings-hours"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("booking_categories")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const extras = rows.length > 0 && "slot_minutes" in rows[0];

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  /* Services whose start-time spacing is typed in rather than picked. */
  const [customIds, setCustomIds] = useState<Set<string>>(new Set());

  /* ── Adding a service ── */
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSvc, setNewSvc] = useState<NewService>({
    name: "", description: "", open: "08:30", last: "18:30", closed: 0, duration: 30, slot: 30, active: true,
  });

  /* ── Deleting a service ── */
  const [deleteTarget, setDeleteTarget] = useState<Cat | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* How many visits are still ahead for the service about to be deleted.
     Past visits and invoices keep the service name as text, so only
     pending and confirmed visits from today on block a delete. */
  const { data: upcoming, isLoading: checkingUpcoming, isError: upcomingFailed } = useQuery<number>({
    queryKey: ["service-upcoming", deleteTarget?.name],
    enabled: !!deleteTarget,
    queryFn: async () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      const { count, error } = await (supabase as any)
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("service", deleteTarget!.name)
        .in("status", ["incoming", "confirmed"])
        .gte("requested_date", today);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const reset = () => {
    const next: Record<string, Draft> = {};
    const custom = new Set<string>();
    rows.forEach((c) => {
      next[c.id] = toDraft(c);
      if (!STEPS.includes(next[c.id].slot)) custom.add(c.id);
    });
    setDrafts(next);
    setCustomIds(custom);
  };
  useEffect(reset, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));

  /* The break is one setting for the whole clinic. It's stored on every
     service row (that's where the booking screen reads it), so changing it
     here changes it on all of them. */
  const firstDraft = rows[0] ? drafts[rows[0].id] : undefined;
  const mixedBreak =
    !!firstDraft &&
    rows.some((c) => {
      const d = drafts[c.id];
      return d && (d.brk !== firstDraft.brk || (d.brk && (d.bs !== firstDraft.bs || d.be !== firstDraft.be)));
    });
  const differing = firstDraft
    ? rows.filter((c) => {
        const d = drafts[c.id];
        return d && (d.brk !== firstDraft.brk || (d.brk && (d.bs !== firstDraft.bs || d.be !== firstDraft.be)));
      }).map((c) => c.name)
    : [];
  const setBreakAll = (p: Partial<Pick<Draft, "brk" | "bs" | "be">>) =>
    setDrafts((prev) => {
      const next = { ...prev };
      rows.forEach((c) => { if (next[c.id]) next[c.id] = { ...next[c.id], ...p }; });
      return next;
    });
  const breakErr = extras && firstDraft ? breakProblem(firstDraft) : "";

  const dirtyIds = rows
    .filter((c) => drafts[c.id] && JSON.stringify(drafts[c.id]) !== JSON.stringify(toDraft(c)))
    .map((c) => c.id);
  const problems = rows.filter((c) => drafts[c.id] && problem(drafts[c.id], extras));
  const isDirty = dirtyIds.length > 0;
  /* True when the break on screen differs from what is saved, so the page can
     say plainly that owners are not using it yet. */
  const breakDirty = rows.some((c) => {
    const d = drafts[c.id];
    if (!d) return false;
    const o = toDraft(c);
    return d.brk !== o.brk || (d.brk && (d.bs !== o.bs || d.be !== o.be));
  });
  const canSave = isDirty && !saving && problems.length === 0 && !breakErr;

  /* The Save bar floats over the bottom of the screen. When the first change
     makes it appear, move the control being edited up so the bar doesn't
     hide it. The same happens on each later click while changes are pending
     (see onFocusCapture below). */
  useEffect(() => {
    if (!isDirty) return;
    const el = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => el?.scrollIntoView?.({ block: "nearest" }));
    return () => cancelAnimationFrame(id);
  }, [isDirty]);

  /* Starts from the first service's hours, so a new service begins with
     the clinic's usual day and only the differences need typing. */
  const openAdd = () => {
    const f = rows[0];
    setNewSvc({
      name: "",
      description: "",
      open: f ? hhmm(f.opening_time) : "08:30",
      last: f ? hhmm(f.last_slot) : "18:30",
      closed: f ? f.closed_day : 0,
      duration: f?.duration_minutes ?? 30,
      slot: f?.slot_minutes ?? 30,
      active: true,
    });
    setAdding(true);
  };

  const patchNew = (p: Partial<NewService>) => setNewSvc((n) => ({ ...n, ...p }));

  const newName = tidyName(newSvc.name);
  const newNameErr = nameProblem(newSvc.name, rows.map((c) => c.name));
  const newTimeErr = problem(
    { active: true, open: newSvc.open, last: newSvc.last, closed: newSvc.closed, slot: newSvc.slot,
      duration: newSvc.duration, brk: false, bs: "", be: "" },
    extras,
  );
  const canCreate = newName.length >= 2 && !newNameErr && !newTimeErr && !creating;

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    const nextSort = rows.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0) + 1;
    const payload: Record<string, unknown> = {
      name: newName,
      description: newSvc.description.trim() || null,
      opening_time: `${newSvc.open}:00`,
      last_slot: `${newSvc.last}:00`,
      closed_day: newSvc.closed,
      is_active: newSvc.active,
      sort_order: nextSort,
    };
    if (extras) {
      // The break is one setting for the whole clinic, so the new service
      // gets the saved one, not whatever is half-typed above.
      const f = rows[0];
      payload.slot_minutes = newSvc.slot;
      payload.duration_minutes = newSvc.duration;
      payload.break_start = f?.break_start ?? null;
      payload.break_end = f?.break_end ?? null;
    }
    const { error } = await (supabase as any).from("booking_categories").insert([payload]);
    setCreating(false);
    if (error) {
      if (error.code === "23505") toast.error("There's already a service with this name.");
      else toast.error("Couldn't add the service. Check your permissions and try again.");
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["settings-hours"] }),
      queryClient.invalidateQueries({ queryKey: ["booking-categories-hours"] }),
      // The Appointments screen and its walk-in keep their own copy of every
      // service's hours and duration. Refresh those too, or they keep using
      // the old numbers (a 45-minute visit after it was changed to 30).
      queryClient.invalidateQueries({ queryKey: ["booking-cats-all"] }),
      queryClient.invalidateQueries({ queryKey: ["booking-categories-walkin"] }),
      queryClient.invalidateQueries({ queryKey: ["day-bookings"] }),
    ]);
    setAdding(false);
    toast.success(newSvc.active ? `${newName} added. Owners can book it now.` : `${newName} added, but it's off for booking.`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await (supabase as any).from("booking_categories").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      if (error.code === "23503") toast.error("Other records still use this service, so it can't be deleted. Close it for booking instead.");
      else toast.error("Couldn't delete the service. Check your permissions and try again.");
      return;
    }
    const name = deleteTarget.name;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["settings-hours"] }),
      queryClient.invalidateQueries({ queryKey: ["booking-categories-hours"] }),
      queryClient.invalidateQueries({ queryKey: ["booking-cats-all"] }),
      queryClient.invalidateQueries({ queryKey: ["booking-categories-walkin"] }),
      queryClient.invalidateQueries({ queryKey: ["day-bookings"] }),
    ]);
    setDeleteTarget(null);
    toast.success(`${name} deleted.`);
  };

  const handleSave = async () => {
    setSaving(true);
    let failed = 0;
    for (const id of dirtyIds) {
      const d = drafts[id];
      const payload: Record<string, unknown> = {
        is_active: d.active,
        opening_time: `${d.open}:00`,
        last_slot: `${d.last}:00`,
        closed_day: d.closed,
      };
      if (extras) {
        payload.slot_minutes = d.slot;
        payload.duration_minutes = d.duration;
        payload.break_start = d.brk ? `${d.bs}:00` : null;
        payload.break_end = d.brk ? `${d.be}:00` : null;
      }
      const { error } = await (supabase as any).from("booking_categories").update(payload).eq("id", id);
      if (error) failed++;
    }
    setSaving(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["settings-hours"] }),
      queryClient.invalidateQueries({ queryKey: ["booking-categories-hours"] }),
      // The Appointments screen and its walk-in keep their own copy of every
      // service's hours and duration. Refresh those too, or they keep using
      // the old numbers (a 45-minute visit after it was changed to 30).
      queryClient.invalidateQueries({ queryKey: ["booking-cats-all"] }),
      queryClient.invalidateQueries({ queryKey: ["booking-categories-walkin"] }),
      queryClient.invalidateQueries({ queryKey: ["day-bookings"] }),
    ]);
    if (failed) toast.error(`Couldn't save ${failed} of ${dirtyIds.length} services. Check your permissions and try again.`);
    else toast.success("Operating hours updated.");
  };

  if (isLoading) {
    return (
      <div className={`${CARD} flex justify-center py-16`}>
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
      </div>
    );
  }

  /* Fields per service: 5 once migration 041 has run, otherwise 3. */
  const FIELDS_GRID = extras
    ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
    : "grid-cols-2 md:grid-cols-3";

  return (
    <div
      className={`space-y-4 ${isDirty || saving ? "pb-24" : ""}`}
      onFocusCapture={(e) => { if (isDirty) (e.target as HTMLElement).scrollIntoView?.({ block: "nearest" }); }}
    >
      {!extras && rows.length > 0 && (
        <p
          role="status"
          className="flex w-full items-center gap-3 rounded-xl border border-[hsl(40_55%_75%)] bg-[hsl(40_55%_92%)] px-4 py-3 text-[14px] font-semibold text-[hsl(40_55%_26%)]"
        >
          <AlertTriangle size={17} className="shrink-0 text-[hsl(40_55%_30%)]" aria-hidden="true" />
          Duration, start-time spacing and break aren&apos;t set up in the database yet. Run migration 041 to turn them on.
        </p>
      )}

      {/* ── Break ── */}
      {extras && firstDraft && (
        <section className={CARD} aria-labelledby="break-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id="break-heading" className="text-[16px] font-bold">Break for all services</h2>
              <p className="mt-0.5 text-[14px] text-[hsl(var(--muted-foreground))]">
                No start time is offered during the break, or if the appointment would run into it.
              </p>
            </div>
            <BreakSwitch
              on={firstDraft.brk}
              onLabel="Break on"
              offLabel="Break off"
              label="Pause bookings for a break"
              onClick={() => setBreakAll({ brk: !firstDraft.brk })}
            />
          </div>
          {(firstDraft.brk || breakErr || mixedBreak || breakDirty) && (
            <div className="space-y-3 border-t border-[hsl(var(--border)/.72)] px-5 py-4 sm:px-6">
              {firstDraft.brk && (
                <div className="flex flex-wrap gap-3">
                  <FloatTime id="break-start" label="Break starts" value={firstDraft.bs} onChange={(v) => setBreakAll({ bs: v })} />
                  <FloatTime id="break-end" label="Break ends" value={firstDraft.be} onChange={(v) => setBreakAll({ be: v })} />
                </div>
              )}
              {breakErr && (
                <p role="alert" className="text-[14px] font-semibold text-[hsl(var(--destructive))]">{breakErr}</p>
              )}
              {breakDirty && (
                <p role="status" className="text-[14px] font-semibold text-[hsl(40_55%_30%)]">
                  Not saved yet. Owners keep seeing the old break until you press Save changes.
                </p>
              )}
              {mixedBreak && firstDraft && (
                <div role="status" className="space-y-2 rounded-xl bg-[hsl(40_55%_92%)] px-4 py-3">
                  <p className="text-[14px] font-semibold text-[hsl(40_55%_26%)]">
                    {differing.join(", ")} {differing.length === 1 ? "has" : "have"} a different break from the first service.
                    Until they match, owners can book {differing.length === 1 ? "it" : "them"} during the break.
                  </p>
                  <button
                    type="button"
                    onClick={() => setBreakAll({ brk: firstDraft.brk, bs: firstDraft.bs, be: firstDraft.be })}
                    className={`flex h-10 items-center rounded-xl border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-4 text-[14px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                  >
                    {firstDraft.brk
                      ? `Use ${fmtMin(toMin(firstDraft.bs))} – ${fmtMin(toMin(firstDraft.be))} for all services`
                      : "Use no break for all services"}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Services ── */}
      <section className={CARD} aria-labelledby="services-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <h2 id="services-heading" className="text-[15px] font-normal text-[hsl(var(--muted-foreground))]">
            {rows.length} service{rows.length === 1 ? "" : "s"} · hours{extras ? " and duration" : ""}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            {isDirty && (
              <p className="text-[14px] text-[hsl(var(--muted-foreground))]">Save or discard your changes to add or delete a service.</p>
            )}
            <button
              type="button"
              onClick={openAdd}
              disabled={isDirty || saving}
              className={BTN_OUTLINE_SM}
            >
              <Plus size={16} strokeWidth={2.4} aria-hidden="true" /> Add service
            </button>
          </div>
        </div>

        {rows.length === 0 && (
          <div className="border-t border-[hsl(var(--border)/.72)] p-14 text-center">
            <p className="text-[15px] font-bold">No booking services found</p>
            <p className="mx-auto mt-1 max-w-sm text-[14px] text-[hsl(var(--muted-foreground))]">
              Use Add service to create the first one, then set its hours here.
            </p>
          </div>
        )}

        {rows.map((c) => {
          const d = drafts[c.id];
          if (!d) return null;
          const err = problem(d, extras);
          const bad = (cond: boolean) => (cond || err ? "!border-[hsl(var(--destructive))]" : "");
          const closeAt = d.last ? fmtMin(toMin(d.last) + (extras ? d.duration : 30)) : "";
          const id = (s: string) => `${c.id}-${s}`;
          const isCustom = customIds.has(c.id);
          return (
            <div
              key={c.id}
              className="border-t border-[hsl(var(--border)/.72)] px-5 py-4 transition hover:bg-[hsl(var(--muted)/.35)] sm:px-6"
            >
              {/* Name and summary on the left; Open and Delete always visible on the right. */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-[260px]">
                  <p className="text-[16px] font-bold">{c.name}</p>
                  {err ? (
                    <p role="alert" className="mt-0.5 text-[14px] font-semibold text-[hsl(var(--destructive))]">{err}</p>
                  ) : (
                    <p className="mt-0.5 text-[14px] leading-snug text-[hsl(var(--muted-foreground))]">
                      {d.active
                        ? `Closed ${DAYS[d.closed]}s · last appointment ends ${closeAt}${extras ? ` · up to ${visitsPerDay(d)} visits a day` : ""}`
                        : "Not bookable"}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <StatePill on={d.active} onLabel="Open" offLabel="Off" label={`${c.name} open for booking`} onClick={() => patch(c.id, { active: !d.active })} />
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(c)}
                    disabled={isDirty || saving}
                    title={isDirty ? "Save or discard your changes first" : undefined}
                    aria-label={`Delete ${c.name}`}
                    className={`inline-flex h-10 items-center gap-1.5 rounded-xl border-[1.5px] border-[hsl(var(--destructive))] bg-transparent px-3.5 text-[14px] font-semibold text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.08)] disabled:opacity-40 disabled:hover:bg-transparent ${FOCUS_RING}`}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Delete
                  </button>
                </div>
              </div>

              {/* The fields wrap onto more lines on narrower screens instead of scrolling sideways. */}
              <div className={`mt-3 grid items-start gap-3 ${FIELDS_GRID}`}>
                <div className="relative">
                  <input id={id("open")} type="time" value={d.open} onChange={(e) => patch(c.id, { open: e.target.value })} className={`h-14 scroll-mb-24 ${FLOAT_BOX} px-4 pb-1.5 pt-6 ${bad(!d.open)}`} />
                  <label htmlFor={id("open")} className={FLOAT_LABEL_UP}>Opens</label>
                </div>

                <div className="relative">
                  <input id={id("last")} type="time" value={d.last} onChange={(e) => patch(c.id, { last: e.target.value })} className={`h-14 scroll-mb-24 ${FLOAT_BOX} px-4 pb-1.5 pt-6 ${bad(!d.last)}`} />
                  <label htmlFor={id("last")} className={FLOAT_LABEL_UP}>Last booking</label>
                </div>

                <div className="relative">
                  <select
                    id={id("closed")}
                    value={d.closed}
                    onChange={(e) => patch(c.id, { closed: Number(e.target.value) })}
                    className={`h-14 scroll-mb-24 ${FLOAT_BOX} appearance-none px-4 pb-1.5 pt-6 pr-10`}
                  >
                    {DAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}
                  </select>
                  <label htmlFor={id("closed")} className={FLOAT_LABEL_UP}>Closed on</label>
                  <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                </div>

                {extras && (
                  <div className="relative">
                    <input
                      id={id("dur")}
                      type="number"
                      min={5}
                      step={5}
                      value={d.duration}
                      onChange={(e) => patch(c.id, { duration: parseInt(e.target.value) || 0 })}
                      className={`h-14 scroll-mb-24 ${FLOAT_BOX} px-4 pb-1.5 pt-6 pr-12 tabular-nums ${bad(!(d.duration >= 5 && d.duration <= 480))}`}
                    />
                    <label htmlFor={id("dur")} className={FLOAT_LABEL_UP}>Duration</label>
                    <span aria-hidden="true" className="pointer-events-none absolute right-4 top-[30px] text-[14px] text-[hsl(var(--muted-foreground))]">min</span>
                  </div>
                )}

                {extras && (
                  <div className="space-y-3">
                    <div className="relative">
                      <select
                        id={id("slot")}
                        value={isCustom ? CUSTOM : d.slot}
                        onChange={(e) => {
                          if (e.target.value === CUSTOM) {
                            setCustomIds((s) => new Set(s).add(c.id));
                          } else {
                            setCustomIds((s) => { const n = new Set(s); n.delete(c.id); return n; });
                            patch(c.id, { slot: Number(e.target.value) });
                          }
                        }}
                        className={`h-14 scroll-mb-24 ${FLOAT_BOX} appearance-none px-4 pb-1.5 pt-6 pr-10`}
                      >
                        {STEPS.map((v) => <option key={v} value={v}>{v} min</option>)}
                        <option value={CUSTOM}>Other…</option>
                      </select>
                      <label htmlFor={id("slot")} className={FLOAT_LABEL_UP}>Start every</label>
                      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                    </div>
                    {isCustom && (
                      <div className="relative">
                        <input
                          id={id("slot-custom")}
                          type="number"
                          min={5}
                          max={240}
                          step={1}
                          value={d.slot || ""}
                          onChange={(e) => patch(c.id, { slot: parseInt(e.target.value) || 0 })}
                          aria-label={`${c.name} start times every, in minutes`}
                          className={`h-14 scroll-mb-24 ${FLOAT_BOX} px-4 pb-1.5 pt-6 pr-12 tabular-nums ${bad(!(d.slot >= 5 && d.slot <= 240))}`}
                        />
                        <label htmlFor={id("slot-custom")} className={FLOAT_LABEL_UP}>Minutes</label>
                        <span aria-hidden="true" className="pointer-events-none absolute right-4 top-[30px] text-[14px] text-[hsl(var(--muted-foreground))]">min</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>
      {(isDirty || saving) && (
        <div className="sticky bottom-4 z-20 flex justify-center">
          <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] py-2 pl-5 pr-2 shadow-[0_12px_32px_-16px_rgb(5_31_66/.35)]">
            <p
              role="status"
              aria-live="polite"
              className={`flex items-center gap-2.5 whitespace-nowrap text-[15px] ${isDirty ? "font-bold text-[hsl(var(--foreground))]" : "font-medium text-[hsl(var(--muted-foreground))]"}`}
            >
              {isDirty ? "Unsaved changes" : "All changes saved"}
              {isDirty && (
                <span className="rounded-full bg-[hsl(40_70%_88%)] px-2.5 py-0.5 text-[13px] font-bold tabular-nums text-[hsl(40_60%_24%)]">
                  {dirtyIds.length} service{dirtyIds.length === 1 ? "" : "s"}
                </span>
              )}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={reset}
                disabled={!isDirty || saving}
                className={`flex h-11 items-center justify-center rounded-xl px-4 text-[14px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:hover:bg-transparent ${FOCUS_RING}`}
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className={BTN_SOLID_SM}
              >
                {saving ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Saving…</> : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete a service ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[460px] gap-0 rounded-[28px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">
          <DialogTitle className="text-[24px] font-bold leading-[30px] tracking-[-.01em]">
            {upcoming && upcoming > 0 ? `Can't delete ${deleteTarget?.name}` : `Delete ${deleteTarget?.name}?`}
          </DialogTitle>
          <DialogDescription className="mt-2 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            {checkingUpcoming
              ? "Checking for upcoming visits…"
              : upcomingFailed
                ? "Couldn't check for upcoming visits, so it can't be deleted right now. Try again in a moment."
                : upcoming && upcoming > 0
                  ? `It still has ${upcoming} upcoming visit${upcoming === 1 ? "" : "s"}.`
                  : "Owners will no longer see it in the app, and it can't be booked. Past visits and invoices keep its name, so nothing already recorded changes."}
          </DialogDescription>
          {!checkingUpcoming && !upcomingFailed && !!upcoming && upcoming > 0 && (
            <p role="alert" className="mt-4 rounded-[16px] bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-[15px] font-semibold leading-snug text-[hsl(var(--destructive))]">
              Cancel or move those visits first. Or close the service for booking, so nobody can book it while you sort them out.
            </p>
          )}
          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className={`flex h-12 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-6 text-[16px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 ${FOCUS_RING}`}
            >
              Keep it
            </button>
            {!checkingUpcoming && !upcomingFailed && !!upcoming && upcoming > 0 ? (
              <button
                type="button"
                onClick={() => {
                  if (deleteTarget) patch(deleteTarget.id, { active: false });
                  setDeleteTarget(null);
                  toast.success("Closed for booking. Press Save changes to apply it.");
                }}
                className={`flex h-12 items-center justify-center rounded-full border-[1.5px] border-transparent bg-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)] transition hover:opacity-90 ${FOCUS_RING}`}
              >
                Close for booking
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || checkingUpcoming || upcomingFailed}
                className={`flex h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--destructive))] px-6 text-[16px] font-bold text-[hsl(var(--destructive-foreground))] transition hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
              >
                {deleting ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Deleting…</> : "Delete service"}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add a service ── */}
      <Dialog open={adding} onOpenChange={(o) => { if (!o && !creating) setAdding(false); }}>
        <DialogContent className="max-w-[560px] gap-0 rounded-[28px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-[24px] font-bold leading-[30px] tracking-[-.01em]">Add a service</DialogTitle>
              <DialogDescription className="mt-1 text-[15px] text-[hsl(var(--muted-foreground))]">
                Owners see it in the app&apos;s booking list as soon as it is open.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => !creating && setAdding(false)}
              aria-label="Close"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-6 space-y-4">
            <FloatText
              id="new-name"
              label="Service name"
              value={newSvc.name}
              onChange={(v) => patchNew({ name: v })}
              error={newNameErr}
              hint="This is the name owners see, and the name past visits are recorded under."
              maxLength={40}
              autoFocus
            />
            <FloatText
              id="new-desc"
              label="Short description"
              value={newSvc.description}
              onChange={(v) => patchNew({ description: v })}
              hint="Shown under the name in the app."
              optional
              maxLength={120}
            />

            <div className="grid grid-cols-2 gap-4">
              <div className="[&>div]:w-full">
                <FloatTime id="new-open" label="Opens" value={newSvc.open} onChange={(v) => patchNew({ open: v })} />
              </div>
              <div className="[&>div]:w-full">
                <FloatTime id="new-last" label="Last booking" value={newSvc.last} onChange={(v) => patchNew({ last: v })} />
              </div>
            </div>

            <div className={`grid gap-4 ${extras ? "grid-cols-3" : "grid-cols-1"}`}>
              <FloatSelect id="new-closed" label="Closed on" value={newSvc.closed} onChange={(v) => patchNew({ closed: v })}>
                {DAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </FloatSelect>
              {extras && (
                <FloatMinutes
                  id="new-duration"
                  label="Takes"
                  value={newSvc.duration}
                  min={5}
                  max={480}
                  error={!(newSvc.duration >= 5 && newSvc.duration <= 480)}
                  onChange={(v) => patchNew({ duration: v })}
                />
              )}
              {extras && (
                <FloatSelect id="new-slot" label="Start every" value={newSvc.slot} onChange={(v) => patchNew({ slot: v })}>
                  {Array.from(new Set([...STEPS, newSvc.slot])).sort((a, b) => a - b).map((v) => (
                    <option key={v} value={v}>{v} min</option>
                  ))}
                </FloatSelect>
              )}
            </div>

            {newTimeErr && (
              <p role="alert" className="text-[14px] font-semibold text-[hsl(var(--destructive))]">{newTimeErr}</p>
            )}

            {extras && rows[0]?.break_start && rows[0]?.break_end && (
              <p className="text-[14px] text-[hsl(var(--muted-foreground))]">
                It uses the clinic&apos;s break, {fmtMin(toMin(hhmm(rows[0].break_start)))} – {fmtMin(toMin(hhmm(rows[0].break_end)))}.
              </p>
            )}

            <div className="flex items-center justify-between gap-3 rounded-[20px] bg-[hsl(var(--background))] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-bold">Open for booking</p>
                <p className="text-[14px] text-[hsl(var(--muted-foreground))]">
                  {newSvc.active ? "Owners can book it right after you add it." : "Hidden from owners until you turn it on."}
                </p>
              </div>
              <StatePill
                on={newSvc.active}
                onLabel="Open"
                offLabel="Off"
                label="New service open for booking"
                onClick={() => patchNew({ active: !newSvc.active })}
              />
            </div>
          </div>

          <div className="mt-7 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setAdding(false)}
              disabled={creating}
              className={`flex h-12 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-6 text-[16px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 ${FOCUS_RING}`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate}
              className={`flex h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-transparent bg-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none ${FOCUS_RING}`}
            >
              {creating ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Adding…</> : "Add service"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
