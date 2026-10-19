import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import * as XLSX from "xlsx-js-style";

/* ── Props ───────────────────────────────────────────────────────────────── */

/* The only fields attendance needs from a staff row. StaffRow in
   StaffManagement.tsx has all of them, so it can be passed in as it is. */
export interface AttendanceMember {
  id: string;
  full_name: string;
  email: string;
  title: string | null;
  job_title: string | null;
  avatar_url: string | null;
}

interface AttendanceTabProps {
  members: AttendanceMember[];
  membersLoading: boolean;
  membersError: boolean;
  onRetryMembers: () => void;
  /* Kept so StaffManagement can keep passing it. The new screen decides who
     can do what from the admin role, and the database enforces the same. */
  canManageSchedule?: boolean;
}

/* ── Rules ───────────────────────────────────────────────────────────────── */

const CLINIC_TZ = "Asia/Manila";
const GRACE_MINUTES = 10;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
const ACTION_LABEL: Record<string, string> = {
  am_in: "Morning in",
  am_out: "Morning out",
  pm_in: "Afternoon in",
  pm_out: "Afternoon out",
};

/* ── Types ───────────────────────────────────────────────────────────────── */

type ClockAction = "am_in" | "am_out" | "pm_in" | "pm_out";
type MsgKind = "ok" | "err" | "info";
interface Msg { kind: MsgKind; text: string }
type Tone = "ok" | "late" | "open" | "none" | "bad";
interface Status { label: string; tone: Tone }
type Panel = "today" | "report" | "staff" | "leave" | "workdays" | "audit";

/* One day's punches. Afternoon punches are optional. */
interface Rec { am_in: string | null; am_out: string | null; pm_in: string | null; pm_out: string | null }
/* Shift, admin-set break window, and work days for one person. */
interface Shiftish { shift_start: string; break_start: string; break_end: string; work_days: number[] }

interface BoardPerson extends Shiftish, Rec { name: string; leave_type: string | null }
interface Board { today: string; people: BoardPerson[] }

interface Person extends Shiftish {
  att_id: string;
  staff_id: string | null;
  full_name: string;
  role_text: string;
  shift_end: string;
  start_day: string;
  active: boolean;
}
interface DayRec extends Rec { att_id: string; day: string }
interface Leave { att_id: string; day: string; type: string; note: string | null; request_id: string | null }
interface LeaveType { id: string; name: string }
interface Punch { id: number; at: string; att_id: string | null; action: string; result: string }
interface AuditRow { id: number; at: string; who: string; action: string; detail: string }

/* ── Look (colors and sizes from the mock) ───────────────────────────────── */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e0a82e] focus-visible:ring-offset-2";
/* Flat full-width section with a hairline below, like the Appointments screen. */
const CARD = "border-b border-[#e6e1d8] bg-white px-5 pb-5 pt-3 text-[#14213d]";
const H2 = "mb-1 text-[18px] font-bold";
const SUB = "mb-4 text-[13px] text-[#667085]";
const NOTE = "mt-3 text-[13px] text-[#667085]";
const LABEL = "mb-1.5 mt-3 block text-[13px] font-semibold";
const INPUT = `h-11 w-full rounded-[10px] border border-[#d8d2c6] bg-white px-3 text-[15px] text-[#14213d] ${FOCUS}`;
const BTN = `h-11 min-w-[110px] rounded-[10px] border-[1.5px] px-4 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const BTN_PRI = `${BTN} border-[#06204d] bg-[#06204d] text-white`;
const BTN_OUT = `${BTN} border-[#d8d2c6] bg-white text-[#14213d]`;
const BTN_SM = "!h-[34px] !min-w-0 !px-2.5 !text-[13px]";
/* Table headings sit on a light band; rows are separated by hairlines. */
const TH = "whitespace-nowrap border-b border-[#e6e1d8] bg-[#f1f3f6] px-3 py-2.5 text-left text-[12.5px] font-bold text-[#667085]";
const TD = "border-b border-[#e6e1d8] px-3 py-3 align-middle";
const NUM = "whitespace-nowrap tabular-nums";
const ID = "font-mono font-semibold";

const MSG_TONE: Record<MsgKind, string> = {
  ok: "bg-[#e7f3ec] text-[#2f7a4a]",
  err: "bg-[#fde7e4] text-[#b42318]",
  info: "bg-[#eef2fb] text-[#06204d]",
};
const PILL_TONE: Record<Tone, string> = {
  ok: "bg-[#e7f3ec] text-[#2f7a4a]",
  late: "bg-[#f8e8c8] text-[#8a5a00]",
  open: "bg-[#eef2fb] text-[#06204d]",
  none: "bg-[#f0efeb] text-[#667085]",
  bad: "bg-[#fde7e4] text-[#b42318]",
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold ${PILL_TONE[tone]}`}>
      {children}
    </span>
  );
}

function MsgBox({ msg }: { msg: Msg | null }) {
  if (!msg) return null;
  return (
    <div className={`mt-3.5 rounded-[10px] px-3.5 py-3 text-[14px] ${MSG_TONE[msg.kind]}`} role="status" aria-live="polite">
      {msg.text}
    </div>
  );
}

function Table({ label, head, children }: { label: string; head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full border-collapse text-[14px]">
        <thead>
          <tr>{head.map((h) => <th key={h || "blank"} className={TH}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const EmptyRow = ({ cols, text }: { cols: number; text: string }) => (
  <tr><td colSpan={cols} className={TD}>{text}</td></tr>
);

/* ── Time helpers (the clinic's own time zone, same as the database) ─────── */

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: CLINIC_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const dayKey = (value: Date | string | number) => dayFmt.format(new Date(value));
const minuteOfDay = (ts: string) => {
  const [h, m] = clockFmt.format(new Date(ts)).split(":").map(Number);
  return h * 60 + m;
};
const hm = (ts?: string | null) =>
  ts ? new Date(ts).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: CLINIC_TZ }) : "—";
/* A stored time of day ("12:00") shown the same way as a punch. */
const timeLabel = (t: string) =>
  new Date(`1970-01-01T${t.slice(0, 5)}:00+08:00`).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: CLINIC_TZ });
/* "9:00 AM – 12:00 PM", or a dash when the session has not started. */
const span = (from: string | null, to: string | null) => (from ? `${hm(from)} – ${to ? hm(to) : "—"}` : "—");
const stamp = (ts: string) =>
  new Date(ts).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: CLINIC_TZ });
const longDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: CLINIC_TZ });
const toMin = (value: string) => {
  const [h, m] = value.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};
const fmtMin = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const worksOn = (p: Shiftish, day: string) => (p.work_days.length ? p.work_days : DEFAULT_WORK_DAYS).includes(weekdayOf(day));
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { start: `${month}-01`, end: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
};
const errText = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || "Something went wrong.");

/* ── Hours, late and status: one set of rules for the clock and the report ── */

/* Minutes of the admin's break window that fall inside a span on a given day. */
function breakOverlap(start: number, end: number, day: string, p: Shiftish) {
  const bs = new Date(`${day}T${p.break_start.slice(0, 5)}:00+08:00`).getTime();
  const be = new Date(`${day}T${p.break_end.slice(0, 5)}:00+08:00`).getTime();
  return Math.max(0, Math.round((Math.min(end, be) - Math.max(start, bs)) / 60000));
}

/* Same rule as the database: first clock-in to last clock-out, minus the break window when it falls inside. */
function workedMinutes(rec: Rec, p: Shiftish, day: string, nowMs: number) {
  if (!rec.am_in) return 0;
  const start = new Date(rec.am_in).getTime();
  const last = rec.pm_out ?? (rec.pm_in ? null : rec.am_out);
  let end: number;
  if (last) end = new Date(last).getTime();
  else if (day === dayKey(nowMs)) end = nowMs;
  else return 0; /* a past day with no clock-out counts nothing until it is fixed */
  const span = Math.max(0, Math.round((end - start) / 60000));
  return Math.max(0, span - breakOverlap(start, end, day, p));
}

function lateMinutes(rec: Rec, shiftStart: string) {
  if (!rec.am_in) return 0;
  const late = minuteOfDay(rec.am_in) - toMin(shiftStart);
  return late > GRACE_MINUTES ? late : 0;
}

function statusOf(rec: Rec | undefined, p: Shiftish, day: string, nowMs: number): Status {
  if (!rec || !rec.am_in) return { label: "Not clocked in", tone: "none" };
  const late = lateMinutes(rec, p.shift_start);
  const worked = workedMinutes(rec, p, day, nowMs);
  const live = day === dayKey(nowMs);
  const finished = !!rec.pm_out || (!!rec.am_out && !rec.pm_in);
  if (late > 120) return { label: "Late, needs review", tone: "bad" };
  if (live && rec.am_out && !rec.pm_in) return { label: "Out for lunch", tone: "open" };
  if (!finished) return live ? { label: "Working", tone: "open" } : { label: "No clock out", tone: "bad" };
  if (worked >= 60 && worked < 240) return { label: "Half day", tone: "late" };
  if (late > 0) return { label: `Late ${late} min`, tone: "late" };
  return { label: "On time", tone: "ok" };
}

function statusFor(p: Shiftish, day: string, rec: Rec | undefined, leaveType: string | null | undefined, nowMs: number): Status {
  if (leaveType && !rec?.am_in) return { label: `On leave · ${leaveType}`, tone: "none" };
  if (rec?.am_in && !worksOn(p, day)) return { label: "Rest day work", tone: "late" };
  return statusOf(rec, p, day, nowMs);
}

function scheduledDates(month: string, p: Person, today: string) {
  const { end } = monthBounds(month);
  const last = Number(end.slice(8));
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    const key = `${month}-${String(d).padStart(2, "0")}`;
    if (key < (p.start_day || "2000-01-01") || key > today) continue;
    if (worksOn(p, key)) out.push(key);
  }
  return out;
}

const dayShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });
/* Last day of the leave request this record belongs to (one day when it has no request number). */
const leaveEndOf = (leaves: Leave[], l: Leave) =>
  leaves
    .filter((x) => x.att_id === l.att_id && (l.request_id ? x.request_id === l.request_id : x.day === l.day))
    .reduce((max, x) => (x.day > max ? x.day : max), l.day);

function monthRows(month: string, people: Person[], days: DayRec[], leaves: Leave[], today: string, nowMs: number) {
  return people.map((p) => {
    const recs = days.filter((d) => d.att_id === p.att_id && d.day.slice(0, 7) === month);
    const myLeaves = leaves.filter((l) => l.att_id === p.att_id && l.day.slice(0, 7) === month);
    const sched = scheduledDates(month, p, today);
    const schedSet = new Set(sched);

    /* Present, late and absent only count scheduled days. A clock-in on a rest day still adds hours. */
    const onSched = recs.filter((r) => r.am_in && schedSet.has(r.day));
    const presentDays = new Set(onSched.map((r) => r.day));
    const present = presentDays.size;
    const late = onSched.filter((r) => lateMinutes(r, p.shift_start) > 0).length;
    const lateMin = onSched.reduce((t, r) => t + lateMinutes(r, p.shift_start), 0);

    /* On leave: a scheduled day with approved leave and no clock-in. */
    const leaveDays = new Set(myLeaves.map((l) => l.day));
    const leaveDates = sched.filter((k) => leaveDays.has(k) && !presentDays.has(k));
    const leave = leaveDates.length;
    /* Leave booked after today: not counted yet, shown as upcoming. */
    const upcoming = myLeaves.filter((l) => l.day > today && worksOn(p, l.day) && !presentDays.has(l.day)).length;

    /* Absent: a scheduled day that has already ended, with no clock-in and no leave. Today is not counted until it ends. */
    const absent = sched.filter((k) => k < today && !presentDays.has(k) && !leaveDays.has(k)).length;

    /* Hours: finished sessions only. An unfinished past day adds nothing until it is fixed. */
    const worked = recs.reduce((t, r) => t + workedMinutes(r, p, r.day, nowMs), 0);

    return { person: p, scheduled: sched.length, present, absent, leave, leaveDates, upcoming, late, lateMin, worked };
  });
}

/* ── Data ────────────────────────────────────────────────────────────────── */

const db = supabase as any;

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data as T;
}

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const normPerson = (row: Person): Person => ({
  ...row,
  shift_start: row.shift_start.slice(0, 5),
  shift_end: row.shift_end.slice(0, 5),
  break_start: row.break_start.slice(0, 5),
  break_end: row.break_end.slice(0, 5),
  work_days: row.work_days ?? DEFAULT_WORK_DAYS,
});

const fetchBoard = async (): Promise<Board> => {
  const board = await rpc<Board>("att_today_board");
  return {
    ...board,
    people: (board.people ?? []).map((p) => ({
      ...p,
      shift_start: p.shift_start.slice(0, 5),
      break_start: p.break_start.slice(0, 5),
      break_end: p.break_end.slice(0, 5),
    })),
  };
};

const fetchPeople = async (): Promise<Person[]> =>
  (await selectAll<Person>((from, to) =>
    db.from("att_people")
      .select("att_id, staff_id, full_name, role_text, shift_start, shift_end, break_start, break_end, work_days, start_day, active")
      .order("full_name").range(from, to),
  )).map(normPerson);

const fetchDays = (start: string, end: string) =>
  selectAll<DayRec>((from, to) =>
    db.from("att_days").select("att_id, day, am_in, am_out, pm_in, pm_out").gte("day", start).lte("day", end).order("day").range(from, to),
  );

const fetchLeaves = (start: string, end: string) =>
  selectAll<Leave>((from, to) =>
    db.from("att_leaves").select("att_id, day, type, note, request_id").gte("day", start).lte("day", end).order("day").range(from, to),
  );

const fetchPunches = async (): Promise<Punch[]> => {
  const { data, error } = await db.from("att_punches").select("id, at, att_id, action, result").order("at", { ascending: false }).limit(60);
  if (error) throw error;
  return data ?? [];
};

const fetchLeaveTypes = async (): Promise<LeaveType[]> => {
  const { data, error } = await db.from("att_leave_types").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
};

const fetchAudit = async (): Promise<AuditRow[]> => {
  const { data, error } = await db.from("att_audit").select("id, at, who, action, detail").order("at", { ascending: false }).limit(200);
  if (error) throw error;
  return data ?? [];
};

/* ── Clock in / out ──────────────────────────────────────────────────────── */

function ClockPanel({ board, nowMs }: { board?: Board; nowMs: number }) {
  const queryClient = useQueryClient();
  const [cid, setCid] = useState("");
  const [cpin, setCpin] = useState("");
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const today = board?.today ?? dayKey(nowMs);
  const own = board?.people[0];

  const act = async (action: ClockAction) => {
    const id = cid.trim().toUpperCase();
    const pin = cpin.trim();
    if (!id) { setMsg({ kind: "err", text: "Type your attendance ID." }); return; }
    if (!/^[0-9]{4,6}$/.test(pin)) { setMsg({ kind: "err", text: "PIN must be 4 to 6 digits." }); return; }
    setBusy(true);
    try {
      const res = await rpc<{ kind: MsgKind; message: string }>("att_clock", { p_id: id, p_pin: pin, p_action: action });
      setMsg({ kind: res.kind, text: res.message });
      if (res.kind === "ok") setCpin("");
      void queryClient.invalidateQueries({ queryKey: ["att"] });
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid md:grid-cols-[minmax(300px,380px)_1fr]">
      <div className={CARD}>
        <h2 className={H2}>Clock in or out</h2>
        <p className={SUB}>Type your attendance ID and your personal PIN. Nobody else's PIN works for your ID.</p>
        <div className="text-[34px] font-bold leading-tight tracking-[-.01em] tabular-nums">
          {new Date(nowMs).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: CLINIC_TZ })}
        </div>
        <label htmlFor="att-cid" className={LABEL}>Attendance ID</label>
        <input
          id="att-cid" className={INPUT} value={cid} autoComplete="off" autoCapitalize="characters"
          placeholder="Your attendance ID" onChange={(e) => setCid(e.target.value)}
        />
        <label htmlFor="att-cpin" className={LABEL}>Personal PIN</label>
        <input
          id="att-cpin" className={INPUT} type="password" inputMode="numeric" autoComplete="off" maxLength={6}
          placeholder="4 to 6 digits" value={cpin}
          onChange={(e) => setCpin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void act("am_in"); }}
        />
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button type="button" className={`${BTN_PRI} flex-1`} disabled={busy} onClick={() => void act("am_in")}>Morning in</button>
          <button type="button" className={`${BTN_OUT} flex-1`} disabled={busy} onClick={() => void act("am_out")}>Morning out</button>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2.5">
          <button type="button" className={`${BTN_PRI} flex-1`} disabled={busy} onClick={() => void act("pm_in")}>Afternoon in</button>
          <button type="button" className={`${BTN_OUT} flex-1`} disabled={busy} onClick={() => void act("pm_out")}>Afternoon out</button>
        </div>
        <MsgBox msg={msg} />
        {own && (
          <p className={NOTE}>
            Your break is {timeLabel(own.break_start)} to {timeLabel(own.break_end)}. It is deducted automatically. Afternoon punches are optional on a half day.
          </p>
        )}
        <p className={NOTE}>Five wrong PINs for one ID lock that ID for 10 minutes. Every attempt is recorded.</p>
      </div>

      <div className={CARD}>
        <h2 className={H2}>Today's punches</h2>
        <p className={SUB}>{longDate(nowMs)}</p>
        <Table label="Today's punches" head={["Staff", "Morning", "Afternoon", "Worked", "Status"]}>
          {board?.people.length ? board.people.map((p, i) => {
            const st = statusFor(p, today, p, p.leave_type, nowMs);
            return (
              <tr key={`${p.name}-${i}`}>
                <td className={TD}>{p.name}</td>
                <td className={`${TD} ${NUM}`}>{span(p.am_in, p.am_out)}</td>
                <td className={`${TD} ${NUM}`}>{span(p.pm_in, p.pm_out)}</td>
                <td className={`${TD} ${NUM}`}>{p.am_in ? fmtMin(workedMinutes(p, p, today, nowMs)) : "—"}</td>
                <td className={TD}><Pill tone={st.tone}>{st.label}</Pill></td>
              </tr>
            );
          }) : <EmptyRow cols={5} text={board ? "No staff yet. Ask the admin to add them." : "Loading…"} />}
        </Table>
      </div>
    </section>
  );
}

/* ── Admin ───────────────────────────────────────────────────────────────── */

const ADMIN_PANELS: { id: Panel; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "report", label: "Monthly report" },
  { id: "staff", label: "Staff IDs" },
  { id: "leave", label: "Leave" },
  { id: "workdays", label: "Work days" },
  { id: "audit", label: "Audit log" },
];

function SubNav<T extends string>({ items, value, onChange, label }: {
  items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="flex gap-6 overflow-x-auto border-b border-[#e6e1d8] px-5" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id} type="button" role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={`-mb-px whitespace-nowrap border-b-2 px-0 py-3 text-[14px] ${FOCUS} ${
            value === it.id ? "border-[#06204d] font-bold text-[#14213d]" : "border-transparent font-semibold text-[#667085]"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function AdminArea({ members, membersLoading, membersError, onRetryMembers, nowMs }: Omit<AttendanceTabProps, "canManageSchedule"> & { nowMs: number }) {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>("today");
  const today = dayKey(nowMs);
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const cur = monthBounds(currentMonth);
  const sel = monthBounds(month);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["att"] });

  const needPeople = panel !== "audit";
  const people = useQuery({ queryKey: ["att", "people"], queryFn: fetchPeople, enabled: needPeople, refetchOnWindowFocus: false });
  const daysToday = useQuery({
    queryKey: ["att", "days", today, today], queryFn: () => fetchDays(today, today),
    enabled: panel === "today", refetchInterval: 15_000, refetchOnWindowFocus: false,
  });
  const punches = useQuery({
    queryKey: ["att", "punches"], queryFn: fetchPunches,
    enabled: panel === "today", refetchInterval: 15_000, refetchOnWindowFocus: false,
  });
  const daysMonth = useQuery({
    queryKey: ["att", "days", sel.start, sel.end], queryFn: () => fetchDays(sel.start, sel.end),
    enabled: panel === "report", refetchOnWindowFocus: false,
  });
  const leavesMonth = useQuery({
    queryKey: ["att", "leaves", sel.start, sel.end], queryFn: () => fetchLeaves(sel.start, sel.end),
    enabled: panel === "report", refetchOnWindowFocus: false,
  });
  const leavesNow = useQuery({
    queryKey: ["att", "leaves", cur.start, cur.end], queryFn: () => fetchLeaves(cur.start, cur.end),
    enabled: panel === "today" || panel === "leave", refetchOnWindowFocus: false,
  });
  const leaveTypes = useQuery({
    queryKey: ["att", "leave-types"], queryFn: fetchLeaveTypes,
    enabled: panel === "leave", refetchOnWindowFocus: false,
  });
  const audit = useQuery({
    queryKey: ["att", "audit"], queryFn: fetchAudit,
    enabled: panel === "audit", refetchInterval: 30_000, refetchOnWindowFocus: false,
  });

  const peopleList = people.data ?? [];
  const byId = useMemo(() => new Map(peopleList.map((p) => [p.att_id, p])), [peopleList]);

  const loadError = (q: { isError: boolean; error: unknown; refetch: () => unknown }) =>
    q.isError ? (
      <div className="mb-3 rounded-[10px] bg-[#fde7e4] px-3.5 py-3 text-[14px] text-[#b42318]" role="alert">
        Couldn't load this: {errText(q.error)}{" "}
        <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button>
      </div>
    ) : null;

  return (
    <section>
      <SubNav items={ADMIN_PANELS} value={panel} onChange={setPanel} label="Admin sections" />
      {needPeople && loadError(people)}

      {panel === "today" && (
        <TodayPanel
          people={peopleList} byId={byId} nowMs={nowMs} today={today}
          days={daysToday.data ?? []} leaves={leavesNow.data ?? []} punches={punches.data ?? []}
        />
      )}
      {panel === "report" && (
        <>
          {loadError(daysMonth)}
          <ReportPanel
            month={month} onMonth={setMonth} people={peopleList} days={daysMonth.data ?? []}
            leaves={leavesMonth.data ?? []} today={today} nowMs={nowMs}
          />
        </>
      )}
      {panel === "staff" && (
        <StaffPanel
          people={peopleList} members={members} membersLoading={membersLoading} membersError={membersError}
          onRetryMembers={onRetryMembers} onChanged={refresh}
        />
      )}
      {panel === "leave" && (
        <LeavePanel
          people={peopleList} byId={byId} leaves={leavesNow.data ?? []} today={today}
          types={leaveTypes.data ?? []} onChanged={refresh}
        />
      )}
      {panel === "workdays" && <WorkDaysPanel people={peopleList} onChanged={refresh} />}
      {panel === "audit" && (
        <>
          {loadError(audit)}
          <AuditPanel rows={audit.data ?? []} />
        </>
      )}
    </section>
  );
}

function TodayPanel({ people, byId, nowMs, today, days, leaves, punches }: {
  people: Person[]; byId: Map<string, Person>; nowMs: number; today: string;
  days: DayRec[]; leaves: Leave[]; punches: Punch[];
}) {
  return (
    <div className={CARD}>
      <h2 className={H2}>Attendance for today</h2>
      <p className={SUB}>Break time is deducted automatically. A morning clock-in more than two hours late is marked Late and needs review.</p>
      <Table label="Attendance for today" head={["Staff", "ID", "Role", "Shift", "Morning", "Afternoon", "Worked", "Status"]}>
        {people.length ? people.map((p) => {
          const rec = days.find((d) => d.att_id === p.att_id);
          const lv = leaves.find((l) => l.att_id === p.att_id && l.day === today);
          const st = statusFor(p, today, rec, lv?.type, nowMs);
          const onLeaveUntil = lv && !rec?.am_in ? leaveEndOf(leaves, lv) : null;
          const statusLabel = lv && !rec?.am_in
            ? `On leave · ${lv.type}${onLeaveUntil ? ` until ${dayShort(onLeaveUntil)}` : ""}`
            : st.label;
          return (
            <tr key={p.att_id}>
              <td className={TD}>{p.full_name}</td>
              <td className={`${TD} ${ID}`}>{p.att_id}</td>
              <td className={TD}>{p.role_text}</td>
              <td className={`${TD} ${NUM}`}>{p.shift_start}–{p.shift_end}</td>
              <td className={`${TD} ${NUM}`}>{span(rec?.am_in ?? null, rec?.am_out ?? null)}</td>
              <td className={`${TD} ${NUM}`}>{span(rec?.pm_in ?? null, rec?.pm_out ?? null)}</td>
              <td className={`${TD} ${NUM}`}>{rec?.am_in ? fmtMin(workedMinutes(rec, p, today, nowMs)) : "—"}</td>
              <td className={TD}><span title={lv?.note || undefined}><Pill tone={st.tone}>{statusLabel}</Pill></span></td>
            </tr>
          );
        }) : <EmptyRow cols={8} text="No staff yet." />}
      </Table>

      <h2 className={`${H2} mt-6`}>Punch log</h2>
      <p className={SUB}>Every attempt, including wrong PINs. Nothing here is edited.</p>
      <Table label="Punch log" head={["Time", "ID", "Action", "Result"]}>
        {punches.length ? punches.map((p) => {
          const who = p.att_id ? byId.get(p.att_id) : undefined;
          const bad = /Wrong|Unknown|Locked|Not clocked|Already|On leave/.test(p.result);
          return (
            <tr key={p.id}>
              <td className={`${TD} ${NUM}`}>{stamp(p.at)}</td>
              <td className={`${TD} ${ID}`}>{p.att_id ?? "—"}{who ? ` · ${who.full_name}` : ""}</td>
              <td className={TD}>{ACTION_LABEL[p.action] ?? p.action}</td>
              <td className={TD}><Pill tone={bad ? "bad" : "ok"}>{p.result}</Pill></td>
            </tr>
          );
        }) : <EmptyRow cols={4} text="No attempts yet." />}
      </Table>
    </div>
  );
}

function ReportPanel({ month, onMonth, people, days, leaves, today, nowMs }: {
  month: string; onMonth: (m: string) => void; people: Person[]; days: DayRec[]; leaves: Leave[]; today: string; nowMs: number;
}) {
  const rows = useMemo(() => monthRows(month, people, days, leaves, today, nowMs), [month, people, days, leaves, today, nowMs]);

  /* Excel export: one sheet, styled header, wide columns so titles are never cut off. */
  const download = () => {
    const head = ["Period", "Staff", "ID", "Scheduled days", "Days present", "Absent", "On leave", "Late days", "Late minutes", "Hours worked (decimal)"];
    const body = rows.map((r) => [
      month, r.person.full_name, r.person.att_id, r.scheduled, r.present, r.absent, r.leave, r.late, r.lateMin,
      Number((r.worked / 60).toFixed(2)),
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([head, ...(body.length > 0 ? body : [["No staff yet"]])]);
    sheet["!cols"] = [
      { wch: 10 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
      { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 14 }, { wch: 24 },
    ];
    sheet["!rows"] = [{ hpt: 34 }];
    const HEAD_STYLE = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: "06204D" } },
      alignment: { vertical: "center", horizontal: "center", wrapText: true },
    };
    for (let c = 0; c < head.length; c++) {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (sheet[ref]) sheet[ref].s = HEAD_STYLE;
    }
    for (let r = 1; r <= body.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: 9 });
      if (sheet[ref] && typeof sheet[ref].v === "number") sheet[ref].z = "0.00";
    }
    sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(head.length - 1)}${Math.max(body.length, 1) + 1}` };
    sheet["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Monthly report");
    XLSX.writeFile(book, `attendance-${month}.xlsx`);
  };

  return (
    <div className={CARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className={`${H2} !mb-0`}>Monthly report · {monthLabel(month)}</h2>
          <p className="mt-1 text-[13px] text-[#667085]">
            {month === today.slice(0, 7) ? "Month to date. Absent counts only days that have ended." : "Full month."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input type="month" aria-label="Month" className={`${INPUT} !w-[180px]`} value={month} onChange={(e) => e.target.value && onMonth(e.target.value)} />
          <button type="button" className={BTN_OUT} onClick={download}>Download Excel</button>
        </div>
      </div>
      <div className="mt-3.5">
        <Table label="Monthly report" head={["Staff", "ID", "Scheduled days", "Days present", "Absent", "On leave", "Late days", "Late (min)", "Hours worked"]}>
          {rows.length ? rows.map((r) => (
            <tr key={r.person.att_id}>
              <td className={TD}>{r.person.full_name}</td>
              <td className={`${TD} ${ID}`}>{r.person.att_id}</td>
              <td className={`${TD} ${NUM}`}>{r.scheduled}</td>
              <td className={`${TD} ${NUM}`}>{r.present}</td>
              <td className={`${TD} ${NUM}`}>{r.absent}</td>
              <td className={`${TD} ${NUM}`} title={r.leaveDates.map(dayShort).join(", ") || undefined}>
                {r.leave}
                {r.upcoming > 0 && <span className="ml-1.5 text-[12.5px] text-[#667085]">+{r.upcoming} upcoming</span>}
              </td>
              <td className={`${TD} ${NUM}`}>{r.late}</td>
              <td className={`${TD} ${NUM}`}>{r.lateMin}</td>
              <td className={`${TD} ${NUM}`}>{fmtMin(r.worked)}</td>
            </tr>
          )) : <EmptyRow cols={9} text="No staff yet." />}
        </Table>
      </div>
    </div>
  );
}

const memberName = (m: AttendanceMember) => [m.title, m.full_name].filter(Boolean).join(" ").trim();

function StaffPanel({ people, members, membersLoading, membersError, onRetryMembers, onChanged }: {
  people: Person[]; members: AttendanceMember[]; membersLoading: boolean; membersError: boolean;
  onRetryMembers: () => void; onChanged: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("17:00");
  const [pin, setPin] = useState("");
  const [addMsg, setAddMsg] = useState<Msg | null>(null);
  const [resetMsg, setResetMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [brkWho, setBrkWho] = useState("");
  const [brkStart, setBrkStart] = useState("12:00");
  const [brkEnd, setBrkEnd] = useState("13:00");
  const [brkMsg, setBrkMsg] = useState<Msg | null>(null);

  const issued = useMemo(() => new Set(people.map((p) => p.staff_id)), [people]);
  const available = members.filter((m) => !issued.has(m.id));
  const chosen = available.some((m) => m.id === staffId) ? staffId : available[0]?.id ?? "";

  const brkPerson = people.find((p) => p.att_id === brkWho) ?? people[0];
  /* Show the saved break window for the chosen person. */
  useEffect(() => {
    if (!brkPerson) return;
    setBrkStart(brkPerson.break_start);
    setBrkEnd(brkPerson.break_end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brkPerson?.att_id, brkPerson?.break_start, brkPerson?.break_end]);

  const add = async () => {
    const member = available.find((m) => m.id === chosen);
    if (!member) { setAddMsg({ kind: "err", text: "Choose a staff member." }); return; }
    if (!start || !end || toMin(end) <= toMin(start)) { setAddMsg({ kind: "err", text: "The shift end must be after the start." }); return; }
    if (!/^[0-9]{4,6}$/.test(pin.trim())) { setAddMsg({ kind: "err", text: "Starting PIN must be 4 to 6 digits." }); return; }
    setBusy(true);
    try {
      const id = await rpc<string>("att_issue_id", { p_staff_id: member.id, p_pin: pin.trim(), p_shift_start: start, p_shift_end: end });
      setPin("");
      setAddMsg({ kind: "ok", text: `${memberName(member)} was added. Attendance ID: ${id}. Give them the PIN in person.` });
      onChanged();
    } catch (e) {
      setAddMsg({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const reset = async (p: Person) => {
    try {
      const newPin = await rpc<string>("att_reset_pin", { p_att_id: p.att_id });
      setResetMsg({ kind: "info", text: `New PIN for ${p.full_name} (${p.att_id}): ${newPin}. Show it once and tell them to change it. It will not be shown again.` });
      onChanged();
    } catch (e) {
      setResetMsg({ kind: "err", text: errText(e) });
    }
  };

  const toggle = async (p: Person) => {
    try {
      await rpc("att_set_active", { p_att_id: p.att_id, p_active: !p.active });
      setResetMsg(null);
      onChanged();
    } catch (e) {
      setResetMsg({ kind: "err", text: errText(e) });
    }
  };

  const saveBreak = async () => {
    if (!brkPerson) return;
    try {
      await rpc("att_set_break_window", { p_att_id: brkPerson.att_id, p_start: brkStart, p_end: brkEnd });
      setBrkMsg({ kind: "ok", text: `${brkPerson.full_name} has a break from ${timeLabel(brkStart)} to ${timeLabel(brkEnd)}.` });
      onChanged();
    } catch (e) {
      setBrkMsg({ kind: "err", text: errText(e) });
    }
  };

  return (
    <div className="grid md:grid-cols-[minmax(300px,380px)_1fr]">
      <div className={CARD}>
        <h2 className={H2}>Add staff</h2>
        <p className={SUB}>The ID is random and issued by the system. It is checked so no two people share one.</p>
        <label htmlFor="att-n-staff" className={LABEL}>Staff member</label>
        {membersError ? (
          <p className="text-[13px] text-[#b42318]">
            Couldn't load the staff list.{" "}
            <button type="button" className="font-semibold underline" onClick={onRetryMembers}>Try again</button>
          </p>
        ) : (
          <select id="att-n-staff" className={INPUT} value={chosen} onChange={(e) => setStaffId(e.target.value)} disabled={membersLoading || !available.length}>
            {membersLoading && <option value="">Loading…</option>}
            {!membersLoading && !available.length && <option value="">Everyone already has an ID</option>}
            {available.map((m) => <option key={m.id} value={m.id}>{memberName(m)}{m.job_title ? ` · ${m.job_title}` : ""}</option>)}
          </select>
        )}
        <div className="flex flex-wrap gap-2.5">
          <div className="flex-1">
            <label htmlFor="att-n-in" className={LABEL}>Shift start</label>
            <input id="att-n-in" type="time" className={INPUT} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="flex-1">
            <label htmlFor="att-n-out" className={LABEL}>Shift end</label>
            <input id="att-n-out" type="time" className={INPUT} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <label htmlFor="att-n-pin" className={LABEL}>Starting PIN (4 to 6 digits)</label>
        <input
          id="att-n-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off" className={INPUT}
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <div className="mt-4">
          <button type="button" className={BTN_PRI} disabled={busy || !chosen} onClick={() => void add()}>Add staff and issue ID</button>
        </div>
        <MsgBox msg={addMsg} />
      </div>

      <div className={CARD}>
        <h2 className={H2}>Staff and IDs</h2>
        <p className={SUB}>Give each person their ID and PIN in person. Reset a PIN if someone forgets it.</p>
        <Table label="Staff" head={["Name", "ID", "Shift", "Status", ""]}>
          {people.length ? people.map((p) => (
            <tr key={p.att_id}>
              <td className={TD}>
                {p.full_name}
                <div className="text-[12px] text-[#667085]">{p.role_text}</div>
              </td>
              <td className={`${TD} ${ID}`}>{p.att_id}</td>
              <td className={`${TD} ${NUM}`}>{p.shift_start}–{p.shift_end}</td>
              <td className={TD}><Pill tone={p.active ? "ok" : "none"}>{p.active ? "Active" : "Inactive"}</Pill></td>
              <td className={`${TD} whitespace-nowrap`}>
                <button type="button" className={`${BTN_OUT} ${BTN_SM}`} onClick={() => void reset(p)}>Reset PIN</button>{" "}
                <button type="button" className={`${BTN_OUT} ${BTN_SM}`} onClick={() => void toggle(p)}>{p.active ? "Deactivate" : "Reactivate"}</button>
              </td>
            </tr>
          )) : <EmptyRow cols={5} text="No staff yet." />}
        </Table>
        <MsgBox msg={resetMsg} />

        <h2 className={`${H2} mt-[22px]`}>Break time</h2>
        <p className={SUB}>The break is deducted from hours when the punches cover it. Staff do not punch their break.</p>
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-[160px] flex-1">
            <label htmlFor="att-br-staff" className={LABEL}>Staff</label>
            <select
              id="att-br-staff" className={INPUT} value={brkPerson?.att_id ?? ""} disabled={!people.length}
              onChange={(e) => { setBrkWho(e.target.value); setBrkMsg(null); }}
            >
              {!people.length && <option value="">No staff yet</option>}
              {people.map((p) => <option key={p.att_id} value={p.att_id}>{p.full_name} · {p.att_id}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="att-br-start" className={LABEL}>Break start</label>
            <input id="att-br-start" type="time" className={INPUT} value={brkStart} disabled={!brkPerson} onChange={(e) => setBrkStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="att-br-end" className={LABEL}>Break end</label>
            <input id="att-br-end" type="time" className={INPUT} value={brkEnd} disabled={!brkPerson} onChange={(e) => setBrkEnd(e.target.value)} />
          </div>
          <button type="button" className={BTN_PRI} disabled={!brkPerson} onClick={() => void saveBreak()}>Save break</button>
        </div>
        <MsgBox msg={brkMsg} />
      </div>
    </div>
  );
}

interface LeaveGroup { key: string; requestId: string | null; att_id: string; type: string; note: string | null; days: string[] }

function LeavePanel({ people, byId, leaves, today, types, onChanged }: {
  people: Person[]; byId: Map<string, Person>; leaves: Leave[]; today: string; types: LeaveType[]; onChanged: () => void;
}) {
  const [who, setWho] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [type, setType] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<Msg | null>(null);
  const [newType, setNewType] = useState("");
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [typeMsg, setTypeMsg] = useState<Msg | null>(null);
  const chosen = people.some((p) => p.att_id === who) ? who : people[0]?.att_id ?? "";
  const chosenType = types.some((t) => t.name === type) ? type : types[0]?.name ?? "";
  /* One line per leave request. Records without a request number stay one line per day. */
  const groups = useMemo<LeaveGroup[]>(() => {
    const map = new Map<string, LeaveGroup>();
    for (const l of leaves) {
      const key = l.request_id ?? `${l.att_id}|${l.day}`;
      const g = map.get(key) ?? { key, requestId: l.request_id, att_id: l.att_id, type: l.type, note: l.note, days: [] };
      g.days.push(l.day);
      map.set(key, g);
    }
    return [...map.values()]
      .map((g) => ({ ...g, days: [...g.days].sort() }))
      .sort((a, b) => b.days[b.days.length - 1].localeCompare(a.days[a.days.length - 1]));
  }, [leaves]);
  const shortDay = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  const mark = async () => {
    if (!chosen) { setMsg({ kind: "err", text: "Add a staff member first." }); return; }
    if (!from || !to) { setMsg({ kind: "err", text: "Choose the dates." }); return; }
    if (to < from) { setMsg({ kind: "err", text: "The To date must be on or after the From date." }); return; }
    if (!chosenType) { setMsg({ kind: "err", text: "Add a leave type first." }); return; }
    try {
      const res = await rpc<{ marked: number; skipped: number }>("att_mark_leave_range", {
        p_att_id: chosen, p_from: from, p_to: to, p_type: chosenType, p_note: note.trim() || null,
      });
      setNote("");
      setMsg({
        kind: "ok",
        text: `${byId.get(chosen)?.full_name ?? chosen} is on leave ${from} to ${to} (${chosenType}): ${res.marked} work day(s) marked${res.skipped ? `, ${res.skipped} rest day(s) skipped` : ""}.`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      onChanged();
    }
  };

  /* Remove a whole leave request, or one day for records made before requests were tracked. */
  const unmark = async (g: LeaveGroup) => {
    const n = g.days.length;
    if (!window.confirm(g.requestId ? `Remove this leave (${n} day${n === 1 ? "" : "s"})?` : `Remove leave on ${g.days[0]}?`)) return;
    try {
      if (g.requestId) await rpc("att_leave_remove_request", { p_request_id: g.requestId });
      else await rpc("att_remove_leave", { p_att_id: g.att_id, p_day: g.days[0] });
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    }
  };

  const addType = async () => {
    try {
      await rpc("att_leave_type_add", { p_name: newType.trim() });
      setNewType("");
      setTypeMsg({ kind: "ok", text: `"${newType.trim()}" was added.` });
      onChanged();
    } catch (e) {
      setTypeMsg({ kind: "err", text: errText(e) });
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await rpc("att_leave_type_rename", { p_id: editing.id, p_name: editing.name.trim() });
      setTypeMsg({ kind: "ok", text: `Renamed to "${editing.name.trim()}".` });
      setEditing(null);
      onChanged();
    } catch (e) {
      setTypeMsg({ kind: "err", text: errText(e) });
    }
  };

  const removeType = async (t: LeaveType) => {
    if (!window.confirm(`Delete the leave type "${t.name}"?`)) return;
    try {
      await rpc("att_leave_type_delete", { p_id: t.id });
      setTypeMsg({ kind: "ok", text: `"${t.name}" was deleted.` });
      onChanged();
    } catch (e) {
      setTypeMsg({ kind: "err", text: errText(e) });
    }
  };

  return (
    <div className={CARD}>
      <h2 className={H2}>Mark leave</h2>
      <p className={SUB}>Leave is recorded by the admin. A person on leave on a day cannot clock in that day, and the day counts as On leave in the report.</p>
      <div className="flex flex-wrap gap-2.5">
        <div className="min-w-[160px] flex-1">
          <label htmlFor="att-lv-staff" className={LABEL}>Staff</label>
          <select id="att-lv-staff" className={INPUT} value={chosen} onChange={(e) => setWho(e.target.value)}>
            {!people.length && <option value="">No staff yet</option>}
            {people.map((p) => <option key={p.att_id} value={p.att_id}>{p.full_name} · {p.att_id}</option>)}
          </select>
        </div>
        <div className="min-w-[160px] flex-1">
          <label htmlFor="att-lv-from" className={LABEL}>From</label>
          <input id="att-lv-from" type="date" className={INPUT} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="min-w-[160px] flex-1">
          <label htmlFor="att-lv-to" className={LABEL}>To</label>
          <input id="att-lv-to" type="date" className={INPUT} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="min-w-[160px] flex-1">
          <label htmlFor="att-lv-type" className={LABEL}>Leave type</label>
          <select id="att-lv-type" className={INPUT} value={chosenType} onChange={(e) => setType(e.target.value)} disabled={!types.length}>
            {!types.length && <option value="">No leave types yet</option>}
            {types.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <label htmlFor="att-lv-note" className={LABEL}>Reason or note (optional)</label>
      <input id="att-lv-note" className={INPUT} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
      <p className={NOTE}>Rest days in the range are skipped. After the To date, the person is marked Absent if they do not clock in.</p>
      <div className="mt-4"><button type="button" className={BTN_PRI} onClick={() => void mark()}>Mark leave</button></div>
      <MsgBox msg={msg} />

      <h2 className={`${H2} mt-[22px]`}>Leave recorded this month</h2>
      <Table label="Leave recorded" head={["Staff", "ID", "Dates", "Work days", "Type", "Note", ""]}>
        {groups.length ? groups.map((g) => {
          const first = g.days[0];
          const last = g.days[g.days.length - 1];
          return (
            <tr key={g.key}>
              <td className={TD}>{byId.get(g.att_id)?.full_name ?? "Removed staff"}</td>
              <td className={`${TD} ${ID}`}>{g.att_id}</td>
              <td className={`${TD} ${NUM}`}>{first === last ? shortDay(first) : `${shortDay(first)} – ${shortDay(last)}`}</td>
              <td className={`${TD} ${NUM}`}>{g.days.length}</td>
              <td className={TD}>{g.type}</td>
              <td className={TD}>{g.note ?? ""}</td>
              <td className={`${TD} whitespace-nowrap text-right`}>
                <button type="button" className={`${BTN_OUT} ${BTN_SM}`} onClick={() => void unmark(g)}>Remove</button>
              </td>
            </tr>
          );
        }) : <EmptyRow cols={7} text="No leave recorded this month." />}
      </Table>

      <h2 className={`${H2} mt-[22px]`}>Leave types</h2>
      <p className={SUB}>These appear in the Leave type list above. A type used on a leave record can be renamed, but not deleted.</p>
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="att-lt-new" className={LABEL}>New leave type</label>
          <input id="att-lt-new" className={INPUT} autoComplete="off" maxLength={40} value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="e.g. Paternity" />
        </div>
        <button type="button" className={BTN_PRI} disabled={!newType.trim()} onClick={() => void addType()}>Add type</button>
      </div>
      <MsgBox msg={typeMsg} />
      <div className="mt-4">
        <Table label="Leave types" head={["Type", ""]}>
          {types.length ? types.map((t) => (
            <tr key={t.id}>
              <td className={TD}>
                {editing?.id === t.id ? (
                  <input
                    aria-label="Leave type name" className={INPUT} maxLength={40} autoFocus value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") setEditing(null); }}
                  />
                ) : t.name}
              </td>
              <td className={`${TD} whitespace-nowrap text-right`}>
                {editing?.id === t.id ? (
                  <>
                    <button type="button" className={`${BTN_PRI} ${BTN_SM}`} disabled={!editing.name.trim()} onClick={() => void saveEdit()}>Save</button>{" "}
                    <button type="button" className={`${BTN_OUT} ${BTN_SM}`} onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={`${BTN_OUT} ${BTN_SM}`} onClick={() => setEditing({ id: t.id, name: t.name })}>Edit</button>{" "}
                    <button type="button" className={`${BTN_OUT} ${BTN_SM}`} onClick={() => void removeType(t)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          )) : <EmptyRow cols={2} text="No leave types yet. Add one above." />}
        </Table>
      </div>
    </div>
  );
}

function WorkDaysPanel({ people, onChanged }: { people: Person[]; onChanged: () => void }) {
  const [who, setWho] = useState("");
  const [days, setDays] = useState<number[]>(DEFAULT_WORK_DAYS);
  const [msg, setMsg] = useState<Msg | null>(null);
  const chosen = people.some((p) => p.att_id === who) ? who : people[0]?.att_id ?? "";
  const person = people.find((p) => p.att_id === chosen);

  /* Show the saved days whenever the person (or their saved days) change. */
  const savedKey = person ? `${person.att_id}:${person.work_days.join(",")}` : "";
  useEffect(() => {
    setDays(person ? [...person.work_days] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const flip = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));

  const save = async () => {
    if (!person) { setMsg({ kind: "err", text: "Add a staff member first." }); return; }
    if (!days.length) { setMsg({ kind: "err", text: "Choose at least one work day." }); return; }
    try {
      await rpc("att_set_work_days", { p_att_id: person.att_id, p_days: days });
      setMsg({ kind: "ok", text: `${person.full_name} works ${days.map((d) => DAY_NAMES[d]).join(" ")}.` });
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    }
  };

  return (
    <div className={CARD}>
      <h2 className={H2}>Work days</h2>
      <p className={SUB}>Scheduled days are counted from these days. A clock-in on any other day is recorded as rest day work.</p>
      <label htmlFor="att-wd-staff" className={LABEL}>Staff</label>
      <select id="att-wd-staff" className={INPUT} value={chosen} onChange={(e) => { setWho(e.target.value); setMsg(null); }}>
        {!people.length && <option value="">No staff yet</option>}
        {people.map((p) => <option key={p.att_id} value={p.att_id}>{p.full_name} · {p.att_id}</option>)}
      </select>
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {DAY_NAMES.map((name, d) => (
          <label key={name} className="inline-flex items-center gap-1.5 text-[13px] font-medium">
            <input type="checkbox" className="h-4 w-4" checked={days.includes(d)} disabled={!person} onChange={() => flip(d)} /> {name}
          </label>
        ))}
      </div>
      <div className="mt-4"><button type="button" className={BTN_PRI} onClick={() => void save()}>Save work days</button></div>
      <MsgBox msg={msg} />
    </div>
  );
}

function AuditPanel({ rows }: { rows: AuditRow[] }) {
  return (
    <div className={CARD}>
      <h2 className={H2}>Audit log</h2>
      <p className={SUB}>Admin changes, newest first. Clock attempts are in the Today tab's punch log.</p>
      <Table label="Audit log" head={["Time", "By", "Action", "Detail"]}>
        {rows.length ? rows.map((a) => (
          <tr key={a.id}>
            <td className={`${TD} ${NUM}`}>{stamp(a.at)}</td>
            <td className={TD}>{a.who}</td>
            <td className={TD}>{a.action}</td>
            <td className={TD}>{a.detail}</td>
          </tr>
        )) : <EmptyRow cols={4} text="No admin changes yet." />}
      </Table>
    </div>
  );
}

/* ── Attendance tab ──────────────────────────────────────────────────────── */

export default function AttendanceTab({ members, membersLoading, membersError, onRetryMembers }: AttendanceTabProps) {
  /* Staff accounts get the clock screen only. Admin accounts get the Admin screen only. */
  const isAdmin = useAdminStore((s) => s.role) === "admin";
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const board = useQuery({ queryKey: ["att", "board"], queryFn: fetchBoard, refetchInterval: 30_000, enabled: !isAdmin });

  return (
    <div className="-mx-5 text-[15px] leading-[1.45] text-[#14213d] sm:-mx-8 lg:-mx-10">
      {isAdmin ? (
        <AdminArea
          members={members} membersLoading={membersLoading} membersError={membersError}
          onRetryMembers={onRetryMembers} nowMs={nowMs}
        />
      ) : (
        <ClockPanel board={board.data} nowMs={nowMs} />
      )}
    </div>
  );
}
