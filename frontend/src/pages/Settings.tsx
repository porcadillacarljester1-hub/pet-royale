import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Building2, UserCircle, Users, ShieldCheck, Loader2, Check,
  Smartphone, MapPin, Phone, Mail, Clock, ExternalLink, Wallet, AlertTriangle,
  KeyRound, LogOut, ArrowRight, Eye, EyeOff,
} from "lucide-react";

type SectionKey = "general" | "account" | "users" | "security";

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType }[] = [
  { key: "general", label: "Clinic details", icon: Building2 },
  { key: "account", label: "Your account", icon: UserCircle },
  { key: "users", label: "Users & roles", icon: Users },
  { key: "security", label: "Security", icon: ShieldCheck },
];

const FIELD = "h-11 rounded-xl border-[hsl(var(--input))] bg-[hsl(var(--background))] focus-visible:border-[hsl(var(--primary))] focus-visible:ring-[hsl(var(--primary))]/20";
const LABEL = "mb-2 block text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]";
const BTN_PRIMARY = "flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))] transition disabled:opacity-40";
const BTN_GHOST = "flex h-11 items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* Postgres returns "08:30:00" — nobody reads a signboard in 24-hour
   seconds. */
function fmtTime(t?: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function openDays(closedDay: number) {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => d !== closedDay);
  return `${DAYS[order[0]].slice(0, 3)} to ${DAYS[order[order.length - 1]].slice(0, 3)}`;
}

/* The last bookable slot isn't closing time — a 6:30 PM appointment
   runs past 6:30. */
function closingTime(lastSlot?: string | null) {
  if (!lastSlot) return "";
  const [h, m] = lastSlot.split(":").map(Number);
  const end = h * 60 + m + 30;
  return fmtTime(`${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`);
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="display-face text-[26px] leading-none">{title}</h2>
      <p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        {description}
      </p>
    </div>
  );
}

export default function Settings() {
  const [section, setSection] = useState<SectionKey>("general");
  const navigate = useNavigate();

  return (
    <AdminLayout title="Settings" eyebrow="Clinic details, your account, and access">
      <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">

          <nav className="workspace-card h-fit rounded-[24px] p-2" aria-label="Settings sections">
            {SECTIONS.map(({ key, label, icon: Icon }) => {
              const active = section === key;
              return (
                <button
                  key={key}
                  onClick={() => setSection(key)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-bold transition ${
                    active
                      ? "bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  <Icon size={16} className="shrink-0" />
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            {section === "general" && <ClinicSection />}
            {section === "account" && <AccountSection />}
            {section === "users" && <UsersSection onManage={() => navigate("/staff")} />}
            {section === "security" && <SecuritySection />}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

/* ══════════════════ Clinic details ══════════════════
   These four fields are the ones pet owners see on the app's About
   screen, so the panel shows exactly how they'll appear. Staff editing
   an address here had no way of knowing it was public. */

function ClinicSection() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["clinic-settings"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clinic_settings").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  /* Opening hours aren't stored here — they come from
     booking_categories, the same rows the booking screen obeys, so what
     the app advertises can't contradict what's bookable. Shown
     read-only with a pointer to where they're set. */
  const { data: categories = [] } = useQuery({
    queryKey: ["booking-categories-hours"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("booking_categories")
        .select("name, opening_time, last_slot, closed_day, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      return data || [];
    },
  });

  const [clinicName, setClinicName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [walletNumber, setWalletNumber] = useState("");
  const [walletName, setWalletName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setClinicName(settings.clinic_name || "");
    setPhoneNumber(settings.phone_number || "");
    setEmail(settings.email || "");
    setAddress(settings.address || "");
    setWalletNumber(settings.payment_wallet_number || "");
    setWalletName(settings.payment_wallet_name || "");
  }, [settings]);

  const isDirty = !!settings && (
    clinicName !== (settings.clinic_name || "") ||
    phoneNumber !== (settings.phone_number || "") ||
    email !== (settings.email || "") ||
    address !== (settings.address || "") ||
    walletNumber !== (settings.payment_wallet_number || "") ||
    walletName !== (settings.payment_wallet_name || "")
  );

  const handleSave = async () => {
    if (!clinicName.trim()) { toast.error("Clinic name is required."); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("That doesn't look like a valid email address.");
      return;
    }

    setSaving(true);
    const { error } = await (supabase as any)
      .from("clinic_settings")
      .update({
        clinic_name: clinicName,
        phone_number: phoneNumber || null,
        email: email || null,
        address: address || null,
        payment_wallet_number: walletNumber.trim() || null,
        payment_wallet_name: walletName.trim() || null,
        payment_wallet_type: walletNumber.trim() ? "GCash" : null,
      })
      .eq("id", settings.id);
    setSaving(false);

    if (error) { toast.error("Couldn't save those details."); return; }
    toast.success("Clinic details updated.");
    queryClient.invalidateQueries({ queryKey: ["clinic-settings"] });
  };

  /* Categories sharing a schedule collapse into one line — listing all
     five would repeat the clinic's hours four times. */
  const schedules = categories.reduce((acc: any[], c: any) => {
    const key = `${c.opening_time}-${c.last_slot}-${c.closed_day}`;
    const found = acc.find((s: any) => s.key === key);
    if (found) found.names.push(c.name);
    else acc.push({
      key,
      names: [c.name],
      label: c.name === "Grooming" ? "Grooming" : "Clinic",
      days: openDays(c.closed_day),
      from: fmtTime(c.opening_time),
      to: closingTime(c.last_slot),
    });
    return acc;
  }, []);

  if (isLoading) {
    return (
      <div className="workspace-card flex justify-center rounded-[26px] py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="workspace-card rounded-[26px] p-6 sm:p-7">
        <SectionHeader
          title="Clinic details"
          description="Your name, address and contact details, used across the system."
        />

        {/* Staff had no way of knowing these fields were public. */}
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[hsl(var(--secondary))] bg-[hsl(var(--secondary)/.3)] p-4">
          <Smartphone size={17} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />
          <p className="text-xs leading-relaxed text-[hsl(var(--foreground))]">
            Pet owners see these on the app&apos;s <strong>About Pet Royale</strong> screen.
            Changing them here updates the app straight away — no new version needed.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className={LABEL}>Clinic name</label>
            <Input
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              placeholder="Pet Royale Clinic and Veterinary Services"
              className={FIELD}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Phone number</label>
              <Input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="09XX XXX XXXX"
                className={FIELD}
              />
              <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                Owners tap this to call you.
              </p>
            </div>

            <div>
              <label className={LABEL}>Email address</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="clinic@email.com"
                className={FIELD}
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>Address</label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, barangay, city"
              className={FIELD}
            />
            <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              Tapping this in the app opens directions, so write it as you&apos;d
              search for it on a map.
            </p>
          </div>
        </div>

        {/* ── Where deposits go ──
               Editable here rather than set in the database, because
               changing GCash accounts shouldn't need a developer. The
               app reads this every time someone opens the booking
               screen, so a change takes effect immediately. */}
        <div className="mt-7 border-t border-[hsl(var(--border)/.7)] pt-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--secondary))]">
              <Wallet size={18} className="text-[hsl(var(--primary))]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold">Where deposits go</h3>
              <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                Clients send their reservation deposit here when booking, then
                enter the reference number for you to check.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>GCash number</label>
              <Input
                value={walletNumber}
                onChange={(e) => setWalletNumber(e.target.value)}
                placeholder="09XX XXX XXXX"
                className={FIELD}
              />
            </div>

            <div>
              <label className={LABEL}>Account name</label>
              <Input
                value={walletName}
                onChange={(e) => setWalletName(e.target.value)}
                placeholder="As it shows in GCash"
                className={FIELD}
              />
              <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                Clients check this before sending.
              </p>
            </div>
          </div>

          {/* Changing the number mid-stream is the one way this breaks:
              a deposit paid to the old account won't be in the new one,
              and staff would reject a genuine booking. */}
          {settings?.payment_wallet_number
            && walletNumber.trim()
            && walletNumber.trim() !== settings.payment_wallet_number && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[hsl(40_55%_75%)] bg-[hsl(40_55%_95%)] px-4 py-3.5">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[hsl(40_55%_30%)]" />
              <p className="text-xs leading-relaxed text-[hsl(40_55%_25%)]">
                Bookings already waiting to be checked were paid to{" "}
                <strong>{settings.payment_wallet_number}</strong>. Verify those in
                the old account before you stop using it.
              </p>
            </div>
          )}

          {!walletNumber.trim() && (
            <p className="mt-4 text-[11px] text-[hsl(var(--muted-foreground))]">
              With no number set, bookings that need a deposit can&apos;t be
              completed in the app.
            </p>
          )}
        </div>

        <div className="mt-7 flex items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] pt-6">
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {isDirty ? "You have unsaved changes." : "Everything is saved."}
          </p>
          <button onClick={handleSave} disabled={!isDirty || saving} className={BTN_PRIMARY}>
            {saving
              ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
              : <>Save changes <Check size={16} /></>}
          </button>
        </div>
      </div>

      {/* ── What the app shows ──
             A live preview, not a mock-up — it reads the same values
             the app does, so what's on screen here is what an owner
             sees. */}
      <div className="workspace-card rounded-[26px] p-6 sm:p-7">
        <div className="mb-5 flex items-center gap-2">
          <Smartphone size={16} className="text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-bold">How this looks in the app</h3>
        </div>

        <div className="rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-5">
          <p className="display-face text-[22px] leading-none">
            {clinicName || "Pet Royale"}
          </p>
          <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            Clinic and Veterinary Services
          </p>

          <div className="mt-5 space-y-3">
            {[
              { Icon: MapPin, label: "Address", value: address },
              { Icon: Phone, label: "Phone", value: phoneNumber },
              { Icon: Mail, label: "Email", value: email },
            ].map(({ Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted))]">
                  <Icon size={15} className={value ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"} />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{label}</p>
                  <p className={`truncate text-xs ${value ? "" : "italic text-[hsl(var(--muted-foreground))]"}`}>
                    {value || "Not set — owners won't see this row"}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* The deposit screen, which is where an out-of-date number
              does real damage — someone pays the wrong account. */}
          {walletNumber.trim() && (
            <div className="mt-5 border-t border-[hsl(var(--border)/.7)] pt-4">
              <div className="flex items-center gap-2">
                <Wallet size={14} className="text-[hsl(var(--primary))]" />
                <p className="text-[11px] font-bold">Deposits go to</p>
              </div>
              <p className="mt-2 text-sm font-bold">{walletNumber}</p>
              {walletName.trim() && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{walletName}</p>
              )}
            </div>
          )}

          {/* Hours live on booking_categories, not here. Shown so the
              preview matches the app, with a pointer to where they're
              actually changed. */}
          <div className="mt-5 border-t border-[hsl(var(--border)/.7)] pt-4">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-[hsl(var(--primary))]" />
              <p className="text-[11px] font-bold">Opening hours</p>
            </div>
            <div className="mt-2 space-y-1">
              {schedules.length === 0 ? (
                <p className="text-xs italic text-[hsl(var(--muted-foreground))]">
                  Not set yet
                </p>
              ) : (
                schedules.map((s: any) => (
                  <p key={s.key} className="text-xs text-[hsl(var(--muted-foreground))]">
                    {s.label} · {s.days}, {s.from} – {s.to}
                  </p>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2">
          <ExternalLink size={13} className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            Opening hours come from <strong>Services → Booking categories</strong>,
            so what the app advertises always matches what clients can actually book.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════ Your account ══════════════════ */

function AccountSection() {
  const fullName = useAdminStore((s) => s.fullName);
  const email = useAdminStore((s) => s.email);
  const role = useAdminStore((s) => s.role);

  /* No photo upload. Nothing in the admin identifies staff by face —
     the header and this panel are the only places an avatar appeared,
     and initials do that job without a storage bucket, a size limit, a
     failure path and a policy to get wrong. */
  return (
    <div className="workspace-card rounded-[26px] p-6 sm:p-7">
      <SectionHeader
        title="Your account"
        description="How you appear to the rest of the clinic."
      />

      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[26px] bg-[hsl(var(--secondary))]">
          <span className="display-face text-[28px] text-[hsl(var(--primary))]">
            {fullName?.[0]?.toUpperCase() || "?"}
          </span>
        </div>

        <div className="min-w-0">
          <p className="text-lg font-bold">{fullName || "—"}</p>
          <p className="mt-0.5 truncate text-sm text-[hsl(var(--muted-foreground))]">{email}</p>
          <span className="status-pill mt-2 bg-[hsl(200_30%_88%)] text-[hsl(200_40%_31%)]">
            {role === "admin" ? "Administrator" : "Staff"}
          </span>
        </div>
      </div>

      {/* Name, email and role come from the staff record, which only an
          administrator can change — so this says where to go rather than
          offering fields that would fail on save. */}
      <p className="mt-6 border-t border-[hsl(var(--border)/.7)] pt-5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        Your name, email and role are set on your staff record. Ask an
        administrator to change them, or update your password under Security.
      </p>
    </div>
  );
}

/* ══════════════════ Users & roles ══════════════════ */

function UsersSection({ onManage }: { onManage: () => void }) {
  /* NOT ["staff"] — that key belongs to Staff Management, which selects
     full records. This query fetches three columns, so sharing the key
     meant whichever screen loaded first won: navigate from here to
     Staff Management and it read this partial data from the cache,
     found full_name undefined, and crashed on initials(). A distinct
     key keeps the two caches apart. */
  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["staff-counts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("staff").select("id, role, status");
      if (error) throw error;
      return data || [];
    },
  });

  const active = staff.filter((s: any) => s.status === "active").length;
  const suspended = staff.filter((s: any) => s.status === "suspended").length;
  const admins = staff.filter((s: any) => s.role === "admin" && s.status === "active").length;
  const staffCount = staff.filter((s: any) => s.role === "staff" && s.status === "active").length;

  return (
    <div className="workspace-card rounded-[26px] p-6 sm:p-7">
      <SectionHeader
        title="Users & roles"
        description="Who can sign in, and what they're allowed to do."
      />

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Active", active],
              ["Administrators", admins],
              ["Staff", staffCount],
              ["Suspended", suspended],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-2xl bg-[hsl(var(--muted)/.6)] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
                  {label}
                </p>
                <p className="mt-2 text-xl font-bold">{value as number}</p>
              </div>
            ))}
          </div>

          <button onClick={onManage} className={`${BTN_PRIMARY} mt-6 w-full sm:w-auto`}>
            Manage staff accounts <ArrowRight size={16} />
          </button>
        </>
      )}
    </div>
  );
}

/* ══════════════════ Security ══════════════════ */

function SecuritySection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleChangePassword = async () => {
    if (!current || !next || !confirm) { toast.error("Fill in every field."); return; }
    if (next !== confirm) { toast.error("Those passwords don't match."); return; }
    if (next.length < 12) { toast.error("Password must be at least 12 characters."); return; }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: next });
    setSaving(false);

    if (error) { toast.error(error.message); return; }
    toast.success("Password updated.");
    setCurrent(""); setNext(""); setConfirm("");
  };

  const handleSignOutEverywhere = async () => {
    setSigningOut(true);
    await supabase.auth.signOut({ scope: "global" });
    // No redirect needed — the auth listener handles it.
  };

  return (
    <div className="space-y-5">
      <div className="workspace-card rounded-[26px] p-6 sm:p-7">
        <SectionHeader
          title="Change password"
          description="Use something you don't use anywhere else."
        />

        <div className="space-y-4">
          <div>
            <label className={LABEL}>Current password</label>
            <Input
              type={show ? "text" : "password"}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={FIELD}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>New password</label>
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="At least 12 characters"
                  className={`${FIELD} pr-11`}
                />
                <button
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide passwords" : "Show passwords"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className={LABEL}>Confirm new password</label>
              <Input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={`${FIELD} ${
                  confirm && next !== confirm ? "border-[hsl(var(--destructive))]" : ""
                }`}
              />
              {/* Fixed-height slot, so the message appearing doesn't
                  shift the button under a cursor already moving to it. */}
              <div className="min-h-[20px] pt-1.5">
                {confirm && next !== confirm && (
                  <p className="text-[11px] text-[hsl(var(--destructive))]">
                    Those don&apos;t match.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleChangePassword}
          disabled={saving}
          className={`${BTN_PRIMARY} mt-3`}
        >
          {saving
            ? <><Loader2 size={15} className="animate-spin" /> Updating…</>
            : <><KeyRound size={16} /> Update password</>}
        </button>
      </div>

      <div className="workspace-card rounded-[26px] p-6 sm:p-7">
        <SectionHeader
          title="Sign out everywhere"
          description="Ends your session on every device, including any you've left signed in elsewhere."
        />
        <button
          onClick={handleSignOutEverywhere}
          disabled={signingOut}
          className="flex h-11 items-center gap-2 rounded-xl border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/.06)] px-5 text-sm font-bold text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.12)] disabled:opacity-60"
        >
          {signingOut
            ? <><Loader2 size={15} className="animate-spin" /> Signing out…</>
            : <><LogOut size={16} /> Sign out of all devices</>}
        </button>
      </div>
    </div>
  );
}
