import { useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useAdminStore } from "@/store/adminStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Plus, Search, X, Check, Loader2, UserCog, ShieldCheck, ShieldOff,
  KeyRound, Trash2, AlertTriangle, Eye, EyeOff, Mail, Users,
} from "lucide-react";

type StaffRole = "admin" | "staff";
type StaffStatus = "active" | "suspended";

interface StaffRow {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  created_at: string;
}

const fetchStaff = async (): Promise<StaffRow[]> => {
  const { data, error } = await (supabase as any)
    .from("staff")
    .select("id, user_id, full_name, email, role, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
};

/* Every write goes through the edge function — the database doesn't
   accept direct client updates to `staff`, since a suspended account
   being able to un-suspend itself would defeat the point. */
async function callManageStaff(payload: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("manage-staff", { body: payload });

  if (error) {
    let message = "Action failed. Please try again.";
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // fall back to the generic message
    }
    toast.error(message);
    return false;
  }
  if (data?.error) {
    toast.error(data.error);
    return false;
  }
  return true;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* Guarded because a crash here takes the whole page down. A staff row
   with no name shouldn't be possible — the create form requires one —
   but rendering "?" is a better failure than a blank screen. */
function initials(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

function StatusBadge({ status }: { status: StaffStatus }) {
  return (
    <span className={`status-pill ${
      status === "active"
        ? "bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]"
        : "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]"
    }`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status === "active" ? "Active" : "Suspended"}
    </span>
  );
}

function StatCard({
  label, value, caption, icon: Icon, accent, delay, active, onClick,
}: {
  label: string; value: number; caption: string; icon: React.ElementType;
  accent: string; delay?: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`workspace-card workspace-rise ${delay ?? ""} rounded-[24px] p-5 text-left transition ${
        onClick ? "hover:-translate-y-0.5" : "cursor-default"
      } ${active ? "ring-2 ring-[hsl(var(--primary)/.45)]" : ""}`}
    >
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
          {label}
        </p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>
          <Icon size={17} />
        </span>
      </div>
      <p className="mt-5 text-[29px] font-bold tracking-[-.05em]">{value}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{caption}</p>
    </button>
  );
}

const FIELD = "h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm";
const LABEL = "mb-2 block text-[13px] font-bold";
const BTN_PRIMARY = "flex h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))] transition disabled:opacity-50";
const BTN_GHOST = "h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]";

export default function StaffManagement() {
  const queryClient = useQueryClient();
  /* s.id, not s.userId — the store has no userId field, so the
     self-protection checks silently never matched and an admin could
     suspend their own account. */
  const myUserId = useAdminStore((s) => s.id);

  const { data: staff = [], isLoading } = useQuery({ queryKey: ["staff"], queryFn: fetchStaff });

  const [tab, setTab] = useState<"all" | "active" | "suspended">("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("staff");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  const [resetTarget, setResetTarget] = useState<StaffRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["staff"] });
    // Settings shows counts from its own query, which would otherwise
    // go stale after adding or suspending someone.
    queryClient.invalidateQueries({ queryKey: ["staff-counts"] });
  };

  const counts = useMemo(() => ({
    total: staff.length,
    active: staff.filter((s) => s.status === "active").length,
    suspended: staff.filter((s) => s.status === "suspended").length,
    admins: staff.filter((s) => s.role === "admin" && s.status === "active").length,
  }), [staff]);

  const visible = staff
    .filter((s) => tab === "all" || s.status === tab)
    .filter((s) => {
      const q = query.trim().toLowerCase();
      return !q || s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
    });

  /* Guards against locking the clinic out of its own system.

     Suspending yourself, demoting yourself, or removing the last active
     admin all end the same way: nobody can reach Staff Management to
     undo it, and the fix is a database query. The edge function should
     enforce this too — this is the friendlier half. */
  const isSelf = (s: StaffRow) => s.user_id === myUserId;
  const isLastAdmin = (s: StaffRow) =>
    s.role === "admin" && s.status === "active" && counts.admins <= 1;

  const run = async (id: string, fn: () => Promise<boolean>, message: string) => {
    setBusyId(id);
    const ok = await fn();
    setBusyId(null);
    if (ok) { toast.success(message); refresh(); }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPassword) {
      toast.error("Every field is required.");
      return;
    }
    if (newPassword.length < 12) {
      toast.error("Password must be at least 12 characters.");
      return;
    }

    setCreating(true);
    const ok = await callManageStaff({
      action: "create",
      full_name: newName.trim(),
      email: newEmail.trim(),
      password: newPassword,
      role: newRole,
    });
    setCreating(false);

    if (ok) {
      toast.success(`Account created for ${newName.trim()}.`);
      setShowCreate(false);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("staff");
      refresh();
    }
  };

  const handleReset = async () => {
    if (!resetTarget || !resetPassword) return;
    if (resetPassword.length < 12) {
      toast.error("Password must be at least 12 characters.");
      return;
    }

    setResetting(true);
    const ok = await callManageStaff({
      action: "reset_password",
      staff_id: resetTarget.id,
      new_password: resetPassword,
    });
    setResetting(false);

    if (ok) {
      toast.success(`Password updated for ${resetTarget.full_name}.`);
      setResetTarget(null);
      setResetPassword("");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const ok = await callManageStaff({ action: "delete", staff_id: deleteTarget.id });
    setDeleting(false);
    if (ok) {
      toast.success("Staff account deleted.");
      setDeleteTarget(null);
      refresh();
    }
  };

  return (
    <AdminLayout
      title="Staff Management"
      eyebrow="Who can sign in, and what they can do"
      actions={
        <button
          onClick={() => setShowCreate(true)}
          className="flex h-9 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-0.5"
        >
          <Plus size={15} /> Add staff
        </button>
      }
    >
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Staff accounts" value={counts.total} caption="All roles"
            icon={Users} accent="bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
            active={tab === "all"} onClick={() => setTab("all")}
          />
          <StatCard
            label="Active" value={counts.active} caption="Can sign in"
            icon={ShieldCheck} accent="bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]" delay="workspace-rise-1"
            active={tab === "active"} onClick={() => setTab("active")}
          />
          <StatCard
            label="Suspended" value={counts.suspended} caption="Access blocked"
            icon={ShieldOff} accent="bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]" delay="workspace-rise-2"
            active={tab === "suspended"} onClick={() => setTab("suspended")}
          />
          <StatCard
            label="Administrators" value={counts.admins} caption="Full access"
            icon={UserCog} accent="bg-[hsl(200_30%_88%)] text-[hsl(200_40%_31%)]" delay="workspace-rise-3"
          />
        </div>

        {/* A clinic with one admin is one forgotten password away from
            nobody being able to add staff, change roles, or reach
            settings. */}
        {counts.admins === 1 && (
          <div className="flex items-start gap-3 rounded-2xl border border-[hsl(40_55%_75%)] bg-[hsl(40_55%_95%)] px-4 py-3.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[hsl(40_55%_30%)]" />
            <p className="text-xs leading-relaxed text-[hsl(40_55%_25%)]">
              There&apos;s only one administrator. If that account is lost, nobody
              can manage staff or reach settings — worth promoting a second person.
            </p>
          </div>
        )}

        {/* ── Search ── */}
        <div className="workspace-card flex flex-col gap-3 rounded-[24px] p-4 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-3 text-sm"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-[hsl(var(--muted))] p-1">
            {(["all", "active", "suspended"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition ${
                  tab === t
                    ? "bg-[hsl(var(--card))] text-[hsl(var(--primary))] shadow-sm"
                    : "text-[hsl(var(--muted-foreground))]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="workspace-card rounded-[26px]">
          <div className="hidden grid-cols-[1.5fr_1.4fr_150px_130px_120px_120px] gap-4 border-b border-[hsl(var(--border)/.7)] px-6 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] lg:grid">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Added</span>
            <span className="text-right">Actions</span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-14 text-center">
              <UserCog className="mx-auto text-[hsl(var(--muted-foreground))]" />
              <p className="mt-3 text-sm font-bold">
                {staff.length === 0 ? "No staff accounts yet" : "Nobody matches that"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[hsl(var(--muted-foreground))]">
                {staff.length === 0
                  ? "Add an account for each person who needs to sign in."
                  : "Try a different name, email, or status."}
              </p>
              {staff.length === 0 && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mx-auto mt-4 flex h-10 items-center gap-1.5 rounded-xl bg-[hsl(var(--primary))] px-4 text-xs font-bold text-[hsl(var(--primary-foreground))]"
                >
                  <Plus size={15} /> Add the first account
                </button>
              )}
            </div>
          ) : (
            visible.map((s) => {
              const busy = busyId === s.id;
              const self = isSelf(s);
              const lastAdmin = isLastAdmin(s);

              return (
                <div
                  key={s.id}
                  className="grid gap-3 border-b border-[hsl(var(--border)/.55)] px-5 py-4 transition last:border-0 hover:bg-[hsl(var(--muted)/.35)] lg:grid-cols-[1.5fr_1.4fr_150px_130px_120px_120px] lg:items-center lg:gap-4 lg:px-6"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--secondary))] text-[11px] font-bold text-[hsl(var(--secondary-foreground))]">
                      {initials(s.full_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">
                        {s.full_name}
                        {self && (
                          <span className="ml-1.5 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">
                            you
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))] lg:hidden">
                        {s.email}
                      </p>
                    </div>
                  </div>

                  <p className="hidden min-w-0 truncate text-xs lg:block">{s.email}</p>

                  {/* Role changes inline rather than through a menu —
                      it's the thing that changes most often. */}
                  <div>
                    <select
                      value={s.role}
                      disabled={busy || self || lastAdmin}
                      onChange={(e) => run(
                        s.id,
                        () => callManageStaff({
                          action: "change_role", staff_id: s.id, new_role: e.target.value,
                        }),
                        `Role updated to ${e.target.value}.`
                      )}
                      title={
                        self ? "You can't change your own role"
                          : lastAdmin ? "The last administrator can't be demoted"
                          : undefined
                      }
                      className="h-8 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 text-[11px] font-semibold disabled:opacity-50"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </div>

                  <div><StatusBadge status={s.status} /></div>

                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    {fmtDate(s.created_at)}
                  </p>

                  <div className="flex items-center justify-end gap-1">
                    {busy ? (
                      <Loader2 size={15} className="animate-spin text-[hsl(var(--primary))]" />
                    ) : (
                      <>
                        <button
                          onClick={() => { setResetTarget(s); setResetPassword(""); }}
                          title="Reset password"
                          aria-label={`Reset password for ${s.full_name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                        >
                          <KeyRound size={15} />
                        </button>

                        {s.status === "active" ? (
                          <button
                            onClick={() => run(s.id, () => callManageStaff({ action: "suspend", staff_id: s.id }), "Account suspended.")}
                            disabled={self || lastAdmin}
                            title={
                              self ? "You can't suspend yourself"
                                : lastAdmin ? "The last administrator can't be suspended"
                                : "Suspend"
                            }
                            aria-label={`Suspend ${s.full_name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <ShieldOff size={15} />
                          </button>
                        ) : (
                          <button
                            onClick={() => run(s.id, () => callManageStaff({ action: "reactivate", staff_id: s.id }), "Account restored.")}
                            title="Restore access"
                            aria-label={`Restore ${s.full_name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))]"
                          >
                            <ShieldCheck size={15} />
                          </button>
                        )}

                        <button
                          onClick={() => setDeleteTarget(s)}
                          disabled={self || lastAdmin}
                          title={
                            self ? "You can't delete your own account"
                              : lastAdmin ? "The last administrator can't be deleted"
                              : "Delete"
                          }
                          aria-label={`Delete ${s.full_name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))] disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {visible.length > 0 && (
            <div className="border-t border-[hsl(var(--border)/.7)] px-6 py-3.5">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Showing <strong className="text-[hsl(var(--foreground))]">{visible.length}</strong> of {staff.length} accounts
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Add staff ── */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!o) setShowCreate(false); }}>
        <DialogContent className="max-w-[460px] rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
                New account
              </p>
              <h2 className="display-face text-[30px] leading-none">Add staff</h2>
            </div>
            <button
              onClick={() => setShowCreate(false)}
              aria-label="Close"
              className="rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className={LABEL}>Full name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Maria Santos"
                className={FIELD}
              />
            </div>

            <div>
              <label className={LABEL}>Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="maria@petroyale.com"
                className={FIELD}
              />
            </div>

            <div>
              <label className={LABEL}>Temporary password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 12 characters"
                  className={`${FIELD} pr-11`}
                />
                <button
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                Share this with them directly. They can change it once signed in.
              </p>
            </div>

            <div>
              <label className={LABEL}>Role</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["staff", "Staff", "Day-to-day work"],
                  ["admin", "Administrator", "Full access"],
                ] as const).map(([value, label, sub]) => (
                  <button
                    key={value}
                    onClick={() => setNewRole(value)}
                    className={`rounded-xl border-2 p-3 text-left transition ${
                      newRole === value
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--secondary))]"
                        : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                    }`}
                  >
                    <p className={`text-[13px] font-bold ${
                      newRole === value ? "text-[hsl(var(--primary))]" : ""
                    }`}>
                      {label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{sub}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-7 flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className={BTN_GHOST}>Cancel</button>
            <button onClick={handleCreate} disabled={creating} className={BTN_PRIMARY}>
              {creating
                ? <><Loader2 size={15} className="animate-spin" /> Creating…</>
                : <>Create account <Check size={16} /></>}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reset password ── */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className="max-w-[440px] rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">
          <div className="mb-6 flex items-start justify-between">
            <div className="min-w-0">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">
                Reset password
              </p>
              <h2 className="display-face truncate text-[28px] leading-none">
                {resetTarget?.full_name}
              </h2>
              <p className="mt-2 flex items-center gap-1.5 truncate text-sm text-[hsl(var(--muted-foreground))]">
                <Mail size={13} />{resetTarget?.email}
              </p>
            </div>
            <button
              onClick={() => setResetTarget(null)}
              aria-label="Close"
              className="shrink-0 rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
            >
              <X size={18} />
            </button>
          </div>

          <div>
            <label className={LABEL}>New password</label>
            <input
              type="text"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="At least 12 characters"
              className={FIELD}
            />
            {/* Shown in plain text on purpose — whoever is resetting it
                has to read it out to the person. A masked field they
                can't see is a password nobody can pass on. */}
            <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              Their old password stops working immediately. Give them this one directly.
            </p>
          </div>

          <div className="mt-7 flex justify-end gap-2">
            <button onClick={() => setResetTarget(null)} className={BTN_GHOST}>Cancel</button>
            <button onClick={handleReset} disabled={resetting} className={BTN_PRIMARY}>
              {resetting
                ? <><Loader2 size={15} className="animate-spin" /> Updating…</>
                : "Set password"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[420px] rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]">
              <AlertTriangle size={21} />
            </div>
            <div className="min-w-0">
              <h2 className="display-face text-[26px] leading-none">Delete this account?</h2>
              <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{deleteTarget?.full_name}</strong> loses
                access immediately and the account can&apos;t be restored. Suspending
                keeps the record and can be undone.
              </p>
            </div>
          </div>
          <div className="mt-7 flex justify-end gap-2">
            <button onClick={() => setDeleteTarget(null)} className={BTN_GHOST}>Keep account</button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="h-11 rounded-xl bg-[hsl(var(--destructive))] px-5 text-sm font-bold text-[hsl(var(--destructive-foreground))] disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
