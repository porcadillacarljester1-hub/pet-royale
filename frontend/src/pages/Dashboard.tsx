import { useMemo } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAppointmentsInRange } from "@/api/appointments";
import { Link } from "react-router-dom";
import {
  CalendarDays, Clock3, PawPrint, UsersRound, Check, Wallet,
  ChevronRight, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Stethoscope,
} from "lucide-react";

const pesoShort = (n: number) => `₱${Math.round(Number(n)).toLocaleString("en-PH")}`;

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* Times are stored as text, so "10:30 AM" sorts before "9:00 AM" on a
   plain string compare. */
function timeToMinutes(t?: string | null) {
  if (!t) return 9999;
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 9999;
  let h = parseInt(m[1]);
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return h * 60 + parseInt(m[2]);
}

/* requested_date can be null or a timestamp on older rows, and
   `new Date(null + "T00:00:00")` renders as "Invalid Date" rather than
   failing — so it ends up on screen. */
function fmtDate(iso?: string | null) {
  if (!iso) return "No date";
  const clean = iso.length > 10 ? iso.slice(0, 10) : iso;
  const d = new Date(clean + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "No date";

  const today = toLocalISO(new Date());
  const yesterday = toLocalISO(new Date(Date.now() - 86_400_000));
  if (clean === today) return "Today";
  if (clean === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const STATUS_LABEL: Record<string, string> = {
  incoming: "Pending", confirmed: "Confirmed",
  completed: "Completed", cancelled: "Cancelled",
};

const STATUS_PILL: Record<string, string> = {
  Pending: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]",
  Confirmed: "bg-[hsl(174_35%_88%)] text-[hsl(174_43%_28%)]",
  Completed: "bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]",
  Cancelled: "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]",
};

const ACTIVITY_ICON: Record<string, React.ElementType> = {
  Completed: CheckCircle2,
  Confirmed: Check,
  Cancelled: XCircle,
  Pending: Clock3,
};

function Pill({ label }: { label: string }) {
  return (
    <span className={`status-pill ${STATUS_PILL[label] ?? "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

async function fetchDashboard() {
  const todayStr = toLocalISO(new Date());
  const weekAgo = toLocalISO(new Date(Date.now() - 7 * 86_400_000));
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const dayEnd = new Date(new Date().setHours(24, 0, 0, 0)).toISOString();

  const [
    todayApptsRaw, pendingRes, petsRes, ownersRes, paymentsRes, weekRes,
  ] = await Promise.all([
    fetchAppointmentsInRange(todayStr, todayStr),

    /* Awaiting confirmation counts every date, not just today — a
       pending request for next week still needs a decision now. */
    (supabase as any)
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "incoming"),

    (supabase as any).from("pets").select("id", { count: "exact", head: true }),
    (supabase as any).from("clients").select("id", { count: "exact", head: true }),

    /* Money taken today, read from `payments` rather than invoices.
       This card used to filter invoices on status "paid", which hasn't
       been a valid value since the statuses became "Fully Paid" — so it
       showed zero permanently. Payments is also the truer source: a
       balance settled today on last month's invoice is today's money. */
    (supabase as any)
      .from("payments")
      .select("amount")
      .gte("paid_at", dayStart)
      .lt("paid_at", dayEnd),

    /* The week's patient activity — appointments only. The old feed
       came from fetchHistoryFeed, which mixes in client registrations,
       shop sales and stock changes; that's why a section called
       "Patient Activity" showed someone signing up. */
    (supabase as any)
      .from("appointments")
      .select("id, pet_name, client_name, service, requested_date, scheduled_time, status")
      .gte("requested_date", weekAgo)
      .order("requested_date", { ascending: false })
      .limit(8),
  ]);

  const todayAppts = [...todayApptsRaw].sort(
    (a, b) => timeToMinutes(a.scheduled_time) - timeToMinutes(b.scheduled_time)
  );

  const takenToday = (paymentsRes.data || [])
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  return {
    todayAppts,
    todayCount: todayAppts.length,
    completedToday: todayAppts.filter((a) => a.status === "completed").length,
    pendingCount: pendingRes.count ?? 0,
    registeredPatientsCount: petsRes.count ?? 0,
    petOwnersCount: ownersRes.count ?? 0,
    takenToday,
    weekActivity: weekRes.data || [],
  };
}

/* Completed visits with no invoice — care delivered that nobody has
   charged for. The one thing on this screen that quietly costs the
   clinic money if it's missed. */
async function fetchUnbilled() {
  const { data: completed } = await (supabase as any)
    .from("appointments")
    .select("id, pet_name")
    .eq("status", "completed")
    .order("requested_date", { ascending: false })
    .limit(50);

  const ids = (completed || []).map((a: any) => a.id);
  if (ids.length === 0) return [];

  const { data: invoices } = await (supabase as any)
    .from("invoices").select("appointment_id").in("appointment_id", ids);

  const billed = new Set((invoices || []).map((i: any) => i.appointment_id));
  return (completed || []).filter((a: any) => !billed.has(a.id));
}

function StatCard({
  label, value, caption, icon: Icon, accent, delay, to,
}: {
  label: string; value: string; caption: string;
  icon: React.ElementType; accent: string; delay?: string; to?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        {/* min-w-0 and the gap stop a two-line label running under the
            icon — "Awaiting confirmation" wraps at this width, and
            without them the second line sat behind the badge. */}
        <p className="min-w-0 text-[11px] font-bold uppercase leading-snug tracking-[.12em] text-[hsl(var(--muted-foreground))]">
          {label}
        </p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${accent}`}>
          <Icon size={17} />
        </span>
      </div>

      {/* A peso amount is far longer than a count, so the type scales
          down rather than wrapping or running past the card edge.
          ₱124,500 still fits at 21px. */}
      <p className={`mt-5 font-bold tracking-[-.05em] ${
        value.length > 9 ? "text-[21px]" : value.length > 6 ? "text-[25px]" : "text-[29px]"
      }`}>
        {value}
      </p>

      <p className="mt-1 text-xs leading-snug text-[hsl(var(--muted-foreground))]">{caption}</p>
    </>
  );

  const className = `workspace-card workspace-rise ${delay ?? ""} block rounded-[24px] p-5 text-left transition ${
    to ? "hover:-translate-y-0.5" : ""
  }`;

  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard-data"], queryFn: fetchDashboard });
  const { data: unbilled = [] } = useQuery({ queryKey: ["unbilled"], queryFn: fetchUnbilled });

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const todayAppointments = data?.todayAppts ?? [];
  const nextUp = todayAppointments.find((a) => a.status === "confirmed" || a.status === "incoming");

  return (
    <AdminLayout title="Dashboard" eyebrow={`${greeting} · Here's what's happening at Pet Royale today`}>
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        {/* ── Needs attention ──
               Above the figures, because a number nobody acts on is
               worth less than a task somebody has to. Only rendered
               when there's something to do. */}
        {unbilled.length > 0 && (
          <Link
            to="/appointments"
            className="flex items-start gap-3 rounded-2xl border border-[hsl(40_55%_75%)] bg-[hsl(40_55%_95%)] px-4 py-3.5 transition hover:bg-[hsl(40_55%_92%)]"
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[hsl(40_55%_30%)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-[hsl(40_55%_25%)]">
                {unbilled.length} completed {unbilled.length === 1 ? "visit hasn't" : "visits haven't"} been billed
              </p>
              <p className="mt-0.5 text-xs text-[hsl(40_55%_30%)]">
                {unbilled.slice(0, 3).map((a: any) => a.pet_name).join(", ")}
                {unbilled.length > 3 && ` and ${unbilled.length - 3} more`}
              </p>
            </div>
            <ChevronRight size={16} className="mt-0.5 shrink-0 text-[hsl(40_55%_30%)]" />
          </Link>
        )}

        {/* ── Six figures ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Today's appointments"
            value={isLoading ? "—" : String(data?.todayCount ?? 0)}
            caption={isLoading ? "" : `${data?.completedToday ?? 0} completed so far`}
            to="/appointments"
            icon={CalendarDays}
            accent="bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
          />
          <StatCard
            label="Awaiting confirmation"
            value={isLoading ? "—" : String(data?.pendingCount ?? 0)}
            caption="Requests from the app"
            to="/appointments"
            icon={Clock3}
            accent="bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]"
            delay="workspace-rise-1"
          />
          <StatCard
            label="Registered patients"
            value={isLoading ? "—" : String(data?.registeredPatientsCount ?? 0)}
            caption="Total number of registered patients"
            to="/clients"
            icon={PawPrint}
            accent="bg-[hsl(200_30%_88%)] text-[hsl(200_40%_31%)]"
            delay="workspace-rise-2"
          />
          <StatCard
            label="Pet owners"
            value={isLoading ? "—" : String(data?.petOwnersCount ?? 0)}
            caption="Registered owners"
            to="/clients"
            icon={UsersRound}
            accent="bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
            delay="workspace-rise-2"
          />
          <StatCard
            label="Today's visits"
            value={isLoading ? "—" : String(data?.completedToday ?? 0)}
            caption="Completed visits today"
            to="/appointments"
            icon={Stethoscope}
            accent="bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]"
            delay="workspace-rise-3"
          />
          {/* Was "Settled Today", counting invoices with status "paid" —
              a value that stopped existing when the statuses changed, so
              it read zero every day. */}
          <StatCard
            label="Taken today"
            value={isLoading ? "—" : pesoShort(data?.takenToday ?? 0)}
            caption="Payments received today"
            to="/billing"
            icon={Wallet}
            accent="bg-[hsl(174_35%_88%)] text-[hsl(174_43%_28%)]"
            delay="workspace-rise-3"
          />
        </div>

        {/* ── Today's schedule ── */}
        <section className="workspace-card overflow-hidden rounded-[26px]">
          <div className="flex items-center justify-between gap-4 border-b border-[hsl(var(--border)/.72)] px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-bold">Today&apos;s schedule</h2>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {todayAppointments.length === 0
                  ? "No appointments scheduled today"
                  : `${todayAppointments.length} appointment${todayAppointments.length === 1 ? "" : "s"} today`}
              </p>
            </div>
            <Link to="/appointments" className="shrink-0 text-xs font-bold text-[hsl(var(--primary))]">
              Full schedule <ChevronRight size={14} className="inline" />
            </Link>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : todayAppointments.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <CalendarDays className="mx-auto text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-bold">Nothing booked today</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Bookings from the mobile app appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border)/.55)]">
              {todayAppointments.map((apt) => {
                const isNext = nextUp?.id === apt.id;
                return (
                  <Link
                    key={apt.id}
                    to="/appointments"
                    className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-[hsl(var(--muted)/.35)] sm:px-6"
                  >
                    {/* The next visit gets an accent bar — on a list of
                        eight, "which one is now" is the question being
                        asked. */}
                    <span className={`h-10 w-1 shrink-0 rounded-full ${
                      isNext ? "bg-[hsl(var(--accent))]" : "bg-transparent"
                    }`} />

                    <div className="w-[76px] shrink-0">
                      <p className="text-sm font-bold">{apt.scheduled_time || "—"}</p>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{apt.pet_name}</p>
                      <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                        {apt.client_name} · {apt.service}
                      </p>
                    </div>

                    <Pill label={STATUS_LABEL[apt.status]} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Recent patient activity ──
               Appointments only. A feed rather than a table: these are
               events read top to bottom, not columns anyone sorts or
               compares. */}
        <section className="workspace-card overflow-hidden rounded-[26px]">
          <div className="flex items-center justify-between border-b border-[hsl(var(--border)/.72)] px-5 py-5 sm:px-6">
            <div>
              <h2 className="text-base font-bold">Recent patient activity</h2>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Appointments over the last seven days
              </p>
            </div>
            {/* Was /medical-records, which no longer exists. */}
            <Link to="/appointments" className="shrink-0 text-xs font-bold text-[hsl(var(--primary))]">
              View all <ChevronRight size={14} className="inline" />
            </Link>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : (data?.weekActivity.length ?? 0) === 0 ? (
            <div className="px-6 py-14 text-center">
              <PawPrint className="mx-auto text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-bold">Nothing recorded this week</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Appointments appear here as they&apos;re booked and completed.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border)/.55)]">
              {data?.weekActivity.map((row: any) => {
                const label = STATUS_LABEL[row.status] || row.status;
                const Icon = ACTIVITY_ICON[label] || Check;
                return (
                  <Link
                    key={row.id}
                    to="/appointments"
                    className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-[hsl(var(--muted)/.35)] sm:px-6"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted)/.8)] text-[hsl(var(--primary))]">
                      <Icon size={16} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-bold">{row.pet_name}</span> · {row.service}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                        {row.client_name}
                      </p>
                    </div>

                    <p className="hidden shrink-0 text-xs text-[hsl(var(--muted-foreground))] sm:block">
                      {fmtDate(row.requested_date)}
                    </p>

                    <Pill label={label} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
