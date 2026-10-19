import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import AttendanceTab from "@/components/AttendanceTab";
import { useAdminStore } from "@/store/adminStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { passwordProblem, PASSWORD_RULES } from "@/lib/passwordPolicy";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Check, Loader2, UserCog, ShieldCheck, ShieldOff,
  KeyRound, Trash2, AlertTriangle, Eye, EyeOff, Mail, ChevronDown, Search, Plus,
  MoreVertical,
  type LucideIcon,
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

  title: string | null;
  job_title: string | null;
 
  secondary_title: string | null;
  
  protected: boolean;
  // Edited by each person under Settings → Your account.
  avatar_url: string | null;
  phone: string | null;
}

const EMPTY_STAFF: StaffRow[] = [];
const fetchStaff = async (role: "admin" | "staff", userId: string | null): Promise<StaffRow[]> => {
  if (role === "staff" && !userId) throw new Error("Your staff profile is unavailable.");
  let query = (supabase as any)
    .from("staff")
    .select("id, user_id, full_name, email, role, status, created_at, title, job_title, secondary_title, protected, avatar_url, phone")
    .order("created_at", { ascending: false });
  if (role === "staff") query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

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

interface JobTitleOption { id: string; name: string; }

async function fetchJobTitleOptions(): Promise<JobTitleOption[]> {
  const { data, error } = await (supabase as any)
    .from("categories").select("id, name").eq("type", "job_title").order("sort_order").order("name");
  if (error) throw error;
  return data || [];
}

async function addJobTitleOption(name: string) {
  const { error } = await (supabase as any).from("categories").insert([{ name: name.trim(), type: "job_title" }]);
  if (error) throw error;
}

async function renameJobTitleOption(id: string, name: string) {
  const { error } = await (supabase as any).from("categories").update({ name: name.trim() }).eq("id", id);
  if (error) throw error;
}

async function deleteJobTitleOption(id: string) {
  const { error } = await (supabase as any).from("categories").delete().eq("id", id);
  if (error) throw error;
}

/* ── Same building blocks as the Billing and Appointments screens ────────
   Copied so this screen looks identical. If you would rather keep one copy,
   move these into one shared file and import them everywhere. */
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

/* Full-bleed layout: no side margins and no max width. Every panel is a flat,
   full-width band separated by 1px lines, like the Reports and Appointments
   screens. */
const PAGE_WRAP = "w-full";
/* The Attendance tab keeps the padded page it was built for. */
const ATTENDANCE_WRAP = "mx-auto w-full max-w-[1440px] space-y-4 px-5 pb-8 sm:px-8 lg:px-10";
const CARD =
  "rounded-xl border border-[hsl(var(--border))] bg-white shadow-[0_1px_2px_rgb(15_36_71/.04)]";
/* PANEL clips row content; CARD does not. */
const PANEL =
  "overflow-hidden border-b border-[hsl(var(--border))] bg-white";
/* The table switches from stacked cards to columns at 1024px (lg). */
const TABLE_HEAD =
  "hidden gap-4 border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--muted)/.5)] px-5 py-[11px] text-[12px] font-bold text-[hsl(var(--muted-foreground))] sm:px-6 lg:grid";
/* Segmented tabs: one soft track with a navy tab for the chosen view. */
const SEG_TRACK =
  "inline-flex h-10 max-w-full gap-0 overflow-x-auto rounded-xl bg-white p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const segTab = (active: boolean) =>
  `flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[14px] font-semibold transition ${FOCUS_RING} ${
    active
      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
  }`;
/* Toolbar and table-state buttons. */
const ADD_BTN =
  `inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 ${FOCUS_RING}`;
const OUTLINE_BTN =
  `inline-flex h-10 items-center justify-center rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`;

/* Compact search box with a magnifier, like the Appointments toolbar. */
function SearchField({
  label, value, onChange, className = "",
}: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={`flex h-11 items-center gap-2 rounded-xl border border-[hsl(var(--card-border))] bg-white px-3 focus-within:border-[hsl(var(--primary))] focus-within:ring-2 focus-within:ring-[hsl(var(--primary)/.15)] ${className}`}>
      <Search size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[14px] !outline-none !ring-0 !shadow-none placeholder:text-[hsl(var(--muted-foreground))]"
      />
    </label>
  );
}

/* Form fields: the label sits above a 48px box, the same in every dialog. */
const FLOAT_BOX =
  "w-full rounded-xl border border-[hsl(var(--input))] bg-white text-[15px] font-medium transition placeholder:font-normal placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/.15)]";
const FIELD_LABEL = "mb-1.5 block text-[13px] font-semibold";

function FloatInput({
  label, value, onChange, type = "text", className = "", trailing, hideLabel, ...rest
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; className?: string;
  /** A button or icon that sits inside the right edge of the field (for example the eye on a password). */
  trailing?: React.ReactNode;
  /** Keep the label for screen readers but don't show it (the field has a placeholder instead). */
  hideLabel?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : FIELD_LABEL}>{label}</label>
      <div className="relative">
        <input
          {...rest}
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-12 ${FLOAT_BOX} pl-3.5 ${trailing ? "pr-12" : "pr-3.5"}`}
        />
        {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
    </div>
  );
}

function FloatSelect({
  label, value, onChange, children, className = "", disabled, title,
}: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>;
  children: React.ReactNode; className?: string; disabled?: boolean; title?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={FIELD_LABEL}>{label}</label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          title={title}
          className={`h-12 appearance-none ${FLOAT_BOX} pl-3.5 pr-10 disabled:opacity-50`}
        >
          {children}
        </select>
        <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
      </div>
    </div>
  );
}

/* Show / hide toggle that sits inside a password field's right edge. */
function EyeToggle({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={shown ? "Hide password" : "Show password"}
      aria-pressed={shown}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
    >
      {shown ? <EyeOff size={20} /> : <Eye size={20} />}
    </button>
  );
}

/* Dialog buttons: one height and the same rounded shape as the Appointments
   toolbar buttons. */
const CTL_BASE =
  `flex h-12 items-center justify-center rounded-xl text-[15px] font-bold ${FOCUS_RING}`;
const CTL_FIELD = "border-[1.5px] border-[hsl(var(--primary))] bg-white text-[hsl(var(--primary))]";
const BTN_SOLID =
  "flex items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-[15px] font-bold text-[hsl(var(--primary-foreground))] disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))]";
/* The panel every dialog on this screen sits in. */
const DIALOG_PANEL =
  "rounded-[20px] border border-[hsl(var(--card-border))] bg-white [&>button]:hidden";

/* Placeholder colour for every skeleton on this screen. Stops pulsing for
   people who have reduced motion turned on. */
const SKELETON = "animate-pulse bg-[hsl(var(--muted))] motion-reduce:animate-none";

/* Profile photo (or initials) inside the 2px navy ring the Appointments table
   and Dashboard use. While the photo downloads, a skeleton fills the ring, and
   the photo fades in when it arrives. A new photo URL (someone changed theirs)
   starts loading again from the skeleton. If the photo can't be loaded, the
   initials show. */
function RingAvatar({ src, name, className = "h-10 w-10" }: { src?: string | null; name?: string | null; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">(src ? "loading" : "error");

  useEffect(() => {
    setState(src ? "loading" : "error");
  }, [src]);

  const showPhoto = !!src && state !== "error";

  return (
    <div className={`relative shrink-0 overflow-hidden rounded-full border-2 border-[hsl(var(--primary))] ${className}`}>
      {showPhoto ? (
        <>
          <img
            key={src}
            src={src as string}
            alt=""
            decoding="async"
            // A photo already in the browser's cache can be complete before React attaches onLoad.
            ref={(el) => {
              if (el && el.complete && state === "loading") setState(el.naturalWidth > 0 ? "ok" : "error");
            }}
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
            className={`h-full w-full object-cover transition-opacity duration-200 ${
              state === "ok" ? "opacity-100" : "opacity-0"
            }`}
          />
          {state === "loading" && (
            <div className={`absolute inset-0 ${SKELETON}`} aria-hidden="true" />
          )}
        </>
      ) : (
        <div
          className="flex h-full w-full items-center justify-center bg-[hsl(43_85%_93%)] text-[14px] font-extrabold text-[hsl(var(--primary))]"
          aria-hidden="true"
        >
          {initials(name)}
        </div>
      )}
    </div>
  );
}

function RolePill({ role, label }: { role: StaffRole; label?: string }) {
  return (
    <span
      className={`inline-flex h-7 items-center whitespace-nowrap rounded-full px-3 text-[13px] font-bold ${
        role === "admin"
          ? "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]"
          : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
      }`}
    >
      {label ?? (role === "admin" ? "Administrator" : "Staff")}
    </span>
  );
}

/* One three-dot button per row. Everything that can be done to an account is a
   labelled item in its menu. An item that isn't available stays visible and
   says why, so nobody wonders whether something is broken. The menu is
   positioned on screen (not inside the table) so the table's rounded edge
   can't clip it. */
interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  why?: string;
  danger?: boolean;
}

function ActionMenu({ items, name }: { items: MenuItem[]; name: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_W = 288;

  const toggle = () => {
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) {
        const menuH = items.length * 52 + 24;
        const openUp = window.innerHeight - rect.bottom < menuH && rect.top > menuH;
        setPos({
          top: openUp ? rect.top - menuH - 6 : rect.bottom + 6,
          left: Math.max(12, rect.right - MENU_W),
        });
      }
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const normal = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const row = (i: MenuItem) => (
    <button
      key={i.key}
      type="button"
      role="menuitem"
      disabled={i.disabled}
      onClick={() => { setOpen(false); i.onClick(); }}
      className={`flex min-h-[44px] w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        i.danger
          ? "text-[hsl(var(--destructive))] enabled:hover:bg-[hsl(var(--destructive)/.08)]"
          : "enabled:hover:bg-[hsl(var(--muted))]"
      }`}
    >
      <i.icon size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold leading-5">{i.label}</span>
        {i.disabled && i.why && (
          <span className="block text-[12.5px] font-normal leading-4 text-[hsl(var(--muted-foreground))]">{i.why}</span>
        )}
      </span>
    </button>
  );

  return (
    <div className="flex justify-end">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Manage ${name}`}
        className={`flex h-11 w-11 items-center justify-center rounded-full text-[hsl(var(--primary))] transition ${
          open ? "bg-[hsl(var(--muted))]" : "bg-transparent hover:bg-[hsl(var(--muted))]"
        } ${FOCUS_RING}`}
      >
        <MoreVertical size={20} aria-hidden="true" />
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
            className="z-50 rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-1.5 shadow-[0_18px_50px_-24px_rgb(5_31_66/.5)]"
          >
            {normal.map(row)}
            {danger.length > 0 && <div className="mx-2 my-1 h-px bg-[hsl(var(--border)/.8)]" />}
            {danger.map(row)}
          </div>
        </>
      )}
    </div>
  );
}

const GROUP_LABEL = "mb-3 mt-7 text-[12px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]";
/* Staff member · Role · Access · Added · Action. Status is not a column: an
   account is active unless the row says "Suspended". */
const ROW_COLS = "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_140px_120px_100px]";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/* Same dialog as "Manage species" in Appointments, with job titles in it. */
function ManageJobTitlesDialog({
  open, onClose, staff, canUpdatePeople,
}: {
  open: boolean; onClose: () => void;
  /** Everyone on the team, so a renamed title can follow the people who have it. */
  staff: StaffRow[];
  /** Only the Clinic Owner (or the developer account) may change other people's titles. */
  canUpdatePeople: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: titles = [], isLoading } = useQuery({
    queryKey: ["job-title-options"],
    queryFn: fetchJobTitleOptions,
    enabled: open,
  });
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<JobTitleOption | null>(null);
  const [deleting, setDeleting] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["job-title-options"] });
  const close = () => {
    setNewName(""); setEditingId(null); setEditingName(""); setDeleteTarget(null);
    onClose();
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    if (titles.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" already exists.`);
      return;
    }
    setAdding(true);
    try {
      await addJobTitleOption(name);
      toast.success(`"${name}" added.`);
      setNewName("");
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't add that.");
    } finally { setAdding(false); }
  };

  const startEdit = (t: JobTitleOption) => { setEditingId(t.id); setEditingName(t.name); };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editingName.trim();
    if (!name) { toast.error("Name can't be empty."); return; }
    const current = titles.find((t) => t.id === editingId);
    if (!current) return;
    if (name === current.name) { setEditingId(null); return; }
    if (titles.some((t) => t.id !== editingId && t.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" already exists.`);
      return;
    }
    // The Clinic Owner title carries extra rights, so it can't be renamed, and no other title can take its name.
    if (isClinicOwner(current.name) || isClinicOwner(name)) {
      toast.error("The Clinic Owner title can't be renamed, and no other title can use that name.");
      return;
    }
    setSaving(true);
    try {
      await renameJobTitleOption(editingId, name);

      /* A person's job title is saved on their own row as plain text, so a
         renamed title has to be changed on each of them too, or they keep the
         old name. Done through the same server action the table dropdown uses. */
      const affected = staff.filter((s) => s.job_title === current.name || s.secondary_title === current.name);
      let updated = 0, failed = 0;
      if (canUpdatePeople) {
        for (const s of affected) {
          if (s.protected) continue;
          let ok = true;
          if (s.job_title === current.name) {
            ok = (await callManageStaff({ action: "update_job_title", staff_id: s.id, job_title: name })) && ok;
          }
          if (s.secondary_title === current.name) {
            ok = (await callManageStaff({ action: "update_secondary_title", staff_id: s.id, secondary_title: name })) && ok;
          }
          if (ok) updated++; else failed++;
        }
        queryClient.invalidateQueries({ queryKey: ["staff"] });
      }

      if (failed > 0) {
        toast.error(`Renamed, but ${failed} ${failed === 1 ? "person" : "people"} couldn't be updated and still ${failed === 1 ? "has" : "have"} the old name.`);
      } else if (affected.length === 0) {
        toast.success("Renamed.");
      } else if (canUpdatePeople) {
        toast.success(`Renamed. ${updated} ${updated === 1 ? "person was" : "people were"} updated too.`);
      } else {
        toast.success(`Renamed. ${affected.length} ${affected.length === 1 ? "person keeps" : "people keep"} the old name until the Clinic Owner updates them.`);
      }
      setEditingId(null);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't rename that.");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteJobTitleOption(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" removed.`);
      setDeleteTarget(null);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't delete that.");
    } finally { setDeleting(false); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className={`!flex max-h-[80vh] max-w-[520px] flex-col gap-0 overflow-hidden p-0 ${DIALOG_PANEL}`}>
          <div className="flex shrink-0 items-start justify-between gap-3 px-8 pb-0 pt-7">
            <div>
              <DialogTitle className="text-[26px] font-bold leading-tight tracking-[-.02em]">Manage job titles</DialogTitle>
              <p className="mt-2 text-[14px] text-[hsl(var(--muted-foreground))]">What each person actually does</p>
            </div>
            <button
              onClick={close}
              className={`rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-6">
            <div className="flex items-center gap-3">
              <FloatInput
                label="New job title"
                hideLabel
                placeholder="New job title"
                value={newName}
                onChange={setNewName}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                className="min-w-0 flex-1"
              />
              <button
                onClick={handleAdd}
                disabled={adding || !newName.trim()}
                className={`${BTN_SOLID} h-12 px-6`}
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </button>
            </div>
            <div className="mt-5 overflow-hidden rounded-[14px] border border-[hsl(var(--card-border))] bg-white px-4">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
                </div>
              ) : titles.length === 0 ? (
                <p className="py-8 text-center text-[15px] text-[hsl(var(--muted-foreground))]">
                  No job titles yet. Add the first one above.
                </p>
              ) : (
                titles.map((t, i) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-3 py-2.5 ${i < titles.length - 1 ? "border-b border-[hsl(var(--card-border))]" : ""}`}
                  >
                    {editingId === t.id ? (
                      <>
                        <FloatInput
                          label="Name"
                          hideLabel
                          placeholder="Name"
                          value={editingName}
                          onChange={setEditingName}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                          autoFocus
                          className="min-w-0 flex-1"
                        />
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--primary))] hover:underline"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--muted-foreground))] hover:underline"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{t.name}</span>
                        <button
                          onClick={() => startEdit(t)}
                          aria-label={`Rename ${t.name}`}
                          className="shrink-0 px-2 py-2 text-[14px] font-bold text-[hsl(var(--primary))] hover:underline"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => setDeleteTarget(t)}
                          aria-label={`Delete ${t.name}`}
                          className="shrink-0 px-2 py-2 text-[14px] font-bold text-[hsl(var(--destructive))] hover:underline"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-[hsl(var(--card-border))] px-8 py-4">
            <button onClick={close} className={`${BTN_SOLID} h-12 w-full`}>
              Done
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent className="rounded-[20px] border border-[hsl(var(--card-border))] bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-bold tracking-[-.02em] text-lg">Delete this job title?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTarget?.name}</span> won&apos;t
              be offered for new staff anymore. Anyone already using it keeps it — nothing existing changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12 rounded-xl border-[1.5px] border-[hsl(var(--primary))] px-6 text-[15px] font-bold text-[hsl(var(--primary))]">Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="h-12 rounded-xl bg-[hsl(var(--destructive))] px-6 text-[15px] font-bold text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const isClinicOwner = (t?: string | null) =>
  (t ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "") === "clinicowner";
const HIDDEN_STAFF_IDS = ["2bb0eed8-4c93-458e-8225-9b9881e028f6"];

type StaffTab = "all" | "active" | "suspended" | "admins";

export default function StaffManagement() {
  const queryClient = useQueryClient();
 
  const myUserId = useAdminStore((s) => s.id);
  const role = useAdminStore((s) => s.role);
  const isStaff = role === "staff";

  const { data: staff = EMPTY_STAFF, isLoading, isError, refetch } = useQuery({
    queryKey: ["staff", role, myUserId],
    queryFn: () => fetchStaff(role ?? "staff", myUserId),
    enabled: role === "admin" || role === "staff",
    refetchOnWindowFocus: true,
  });
  /* The route picks the screen: /staff is Staff Accounts and
     /staff/attendance is Attendance. A regular staff member only has
     Attendance. */
  const location = useLocation();
  const activeView = isStaff || location.pathname.endsWith("/attendance") ? "attendance" : "staff";

  /* Keeps photos (and everything else on a row) current. When someone changes
     their photo under Settings → Your account, their staff row changes; this
     refreshes the list as it happens instead of waiting for a reload. It needs
     Realtime switched on for the staff table (Supabase → Database →
     Replication). Without it nothing breaks: the list still refreshes when you
     come back to this tab. */
  useEffect(() => {
    const channel = supabase
      .channel("staff-management-staff")
      .on("postgres_changes", { event: "*", schema: "public", table: "staff" }, () => {
        queryClient.invalidateQueries({ queryKey: ["staff"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);
  const { data: jobTitles = [] } = useQuery({ queryKey: ["job-title-options"], queryFn: fetchJobTitleOptions });

  const [tab, setTab] = useState<StaffTab>("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("staff");
  const [newTitle, setNewTitle] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newSecondary, setNewSecondary] = useState("");
  const [showManageJobTitles, setShowManageJobTitles] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  const [resetTarget, setResetTarget] = useState<StaffRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetCurrent, setResetCurrent] = useState("");
  const [resetting, setResetting] = useState(false);
  const [showResetCurrent, setShowResetCurrent] = useState(false);
  const [showResetNew, setShowResetNew] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* Changing someone's access level takes effect at once and changes what they
     can do, so the choice is held here until it is confirmed. */
  const [roleChange, setRoleChange] = useState<{ staff: StaffRow; newRole: StaffRole } | null>(null);

  /* The "Edit role & access" dialog: job title, second role and access level
     are changed here instead of in dropdowns on every row. */
  const [editTarget, setEditTarget] = useState<StaffRow | null>(null);
  const [editJob, setEditJob] = useState("");
  const [editSecond, setEditSecond] = useState("");
  const [editRole, setEditRole] = useState<StaffRole>("staff");
  const [savingEdit, setSavingEdit] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["staff"] });
    // Settings shows counts from its own query, which would otherwise
    // go stale after adding or suspending someone.
    queryClient.invalidateQueries({ queryKey: ["staff-counts"] });
    // The "who handled this visit" lists on Appointments and Billing.
    queryClient.invalidateQueries({ queryKey: ["staff-options"] });
    queryClient.invalidateQueries({ queryKey: ["staff-directory"] });
  };

  const shown = useMemo(() => staff.filter((s) => !HIDDEN_STAFF_IDS.includes(s.id)), [staff]);

  const me = staff.find((s) => s.user_id === myUserId);
  const isSuperAdmin = !!me?.protected;
  const canManageRoles = isSuperAdmin || isClinicOwner(me?.job_title);

  /* `admins` is every administrator account (any status), so the
     Administrators tab's number always matches the rows it lists. */
  const counts = useMemo(() => ({
    total: shown.length,
    active: shown.filter((s) => s.status === "active").length,
    suspended: shown.filter((s) => s.status === "suspended").length,
    admins: shown.filter((s) => s.role === "admin").length,
  }), [shown]);
  /* Counted from the accounts the clinic can see. The hidden developer
     account doesn't count, so the clinic can never be left with no
     administrator of its own. */
  const allActiveAdmins = useMemo(
    () => shown.filter((s) => s.role === "admin" && s.status === "active").length,
    [shown]
  );

  const visible = shown
    .filter((s) => tab === "all" || (tab === "admins" ? s.role === "admin" : s.status === tab))
    .filter((s) => {
      const q = query.trim().toLowerCase();
      return !q ||
        s.full_name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.job_title ?? "").toLowerCase().includes(q);
    });

  const hasFilters = tab !== "all" || query.trim() !== "";
  const missing = [
    !newFirst.trim() && "first name",
    !newLast.trim() && "last name",
    !newJobTitle && "job title",
    !newEmail.trim() && "email",
    !newPassword && "password",
  ].filter(Boolean) as string[];
  const canSubmit = missing.length === 0;

  const isSelf = (s: StaffRow) => s.user_id === myUserId;
  const isLastAdmin = (s: StaffRow) =>
    s.role === "admin" && s.status === "active" && allActiveAdmins <= 1;

  /* What can be changed on an account, and why not when it can't. These are
     the same rules the row used to apply to its dropdowns, in one place. */
  const rulesFor = (s: StaffRow) => {
    const self = isSelf(s);
    const lastAdmin = isLastAdmin(s) && !isSuperAdmin; 
    const jobLocked = (s.protected && !self) || !canManageRoles || isClinicOwner(s.job_title);
    const secondEditable = !(s.protected && !self) && canManageRoles;
    const roleLocked = !canManageRoles || isClinicOwner(s.job_title);
    const roleEditable = !s.protected && !roleLocked && !self && !lastAdmin;
    const roleWhy = isClinicOwner(s.job_title) ? "The Clinic Owner is always an administrator"
      : !canManageRoles ? "Only the Clinic Owner can change access levels"
      : self ? "You can't change your own role"
      : lastAdmin ? "The last administrator can't be demoted"
      : "";
    return { self, lastAdmin, jobLocked, secondEditable, roleLocked, roleEditable, roleWhy };
  };
  const editRules = editTarget ? rulesFor(editTarget) : null;
  const editChanged = editTarget && editRules
    ? {
        job: !editRules.jobLocked && editJob !== (editTarget.job_title || ""),
        second: editRules.secondEditable && editSecond !== (editTarget.secondary_title || ""),
        role: editRules.roleEditable && editRole !== editTarget.role,
      }
    : null;
  const editDirty = !!editChanged && (editChanged.job || editChanged.second || editChanged.role);
  const secondSameAsJob = !!editSecond && editSecond === editJob;

  const openEdit = (s: StaffRow) => {
    setEditTarget(s);
    setEditJob(s.job_title || "");
    setEditSecond(s.secondary_title || "");
    setEditRole(s.role);
  };

  /* Reset password dialog: whose password it is, and when it can be saved. */
  const resetSelf = !!resetTarget && isSelf(resetTarget);
  const resetRulesOk = PASSWORD_RULES.every((r) => r.test(resetPassword));
  // Your own password: the new one has to differ from the current one.
  const resetSame = resetSelf && !!resetCurrent && resetCurrent === resetPassword;
  const resetReady = resetRulesOk && (!resetSelf || !!resetCurrent) && !resetSame;

  const run = async (id: string, fn: () => Promise<boolean>, message: string) => {
    setBusyId(id);
    let ok = false;
    try {
      ok = await fn();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
    }
    if (ok) { toast.success(message); refresh(); }
  };

  const confirmRoleChange = async () => {
    if (!roleChange) return;
    const { staff: target, newRole: role } = roleChange;
    setRoleChange(null);
    await run(
      target.id,
      () => callManageStaff({ action: "change_role", staff_id: target.id, new_role: role }),
      `${target.full_name} is now ${role === "admin" ? "an administrator" : "staff"}.`
    );
  };

  /* Saves the job title and second role with the same server actions the
     table dropdowns used. A change of access level isn't applied here: it goes
     to the same confirmation as before, because it changes what the person
     can do. */
  const saveEdit = async () => {
    if (!editTarget || !editChanged || !editDirty || secondSameAsJob) return;
    setSavingEdit(true);
    let ok = true;
    try {
      if (editChanged.job) {
        ok = await callManageStaff({
          action: "update_job_title", staff_id: editTarget.id, job_title: editJob || null,
        });
      }
      if (ok && editChanged.second) {
        ok = await callManageStaff({
          action: "update_secondary_title", staff_id: editTarget.id, secondary_title: editSecond || null,
        });
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
      ok = false;
    } finally {
      setSavingEdit(false);
    }
    refresh();
    if (!ok) return;
    const target = editTarget;
    const wantsRole = editChanged.role;
    const newRoleValue = editRole;
    if (editChanged.job || editChanged.second) {
      toast.success(editChanged.job && editChanged.second ? "Roles updated." : editChanged.job ? "Job title updated." : "Second job title updated.");
    }
    setEditTarget(null);
    if (wantsRole) setRoleChange({ staff: target, newRole: newRoleValue });
  };

  const handleCreate = async () => {
    const first = newFirst.trim().replace(/\s+/g, " ");
    const last = newLast.trim().replace(/\s+/g, " ");
    if (!first || !last) { toast.error("Enter a first and a last name."); return; }
    if (!newJobTitle) { toast.error("Pick a job title, so the team can tell who does what."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (!newPassword) { toast.error("Set a temporary password."); return; }
    if (newTitle === "Dr." && !/vet|doctor|surgeon|owner/i.test(newJobTitle)) {
      toast.error("\u201CDr.\u201D is for veterinarians. Pick a different title or job title.");
      return;
    }
    if (newSecondary && newSecondary === newJobTitle) {
      toast.error("The second job title can't be the same as the first.");
      return;
    }
    const fullName = `${first} ${last}`;
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) {
      toast.error(pwProblem);
      return;
    }
    
    if (isClinicOwner(newJobTitle) && newRole !== "admin") {
      toast.error("A Clinic Owner must be an administrator.");
      return;
    }

    setCreating(true);
    let ok = false;
    try {
      ok = await callManageStaff({
        action: "create",
        full_name: fullName,
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
        title: newTitle || null,
        job_title: newJobTitle || null,
        secondary_title: newSecondary || null,
      });
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }

    if (ok) {
      toast.success(`Account created for ${newTitle ? newTitle + " " : ""}${fullName}.`);
      setShowCreate(false);
      setNewFirst(""); setNewLast(""); setNewEmail(""); setNewPassword(""); setNewRole("staff");
      setNewTitle(""); setNewJobTitle(""); setNewSecondary("");
      refresh();
    }
  };

  const handleReset = async () => {
    if (!resetTarget || !resetPassword) return;
    // Your own password: you have to know the current one. Someone
    // else's (only a super admin gets here) can't ask for it.
    const self = isSelf(resetTarget);
    if (self && !resetCurrent) {
      toast.error("Enter your current password.");
      return;
    }
    const pwProblem = passwordProblem(resetPassword);
    if (pwProblem) {
      toast.error(pwProblem);
      return;
    }
    if (self && resetCurrent === resetPassword) {
      toast.error("Choose a password different from your current one.");
      return;
    }

    setResetting(true);
    let ok = false;
    try {
      ok = await callManageStaff({
        action: "reset_password",
        staff_id: resetTarget.id,
        new_password: resetPassword,
        ...(self ? { current_password: resetCurrent } : {}),
      });
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setResetting(false);
    }

    if (ok) {
      toast.success(`Password updated for ${resetTarget.full_name}.`);
      setResetTarget(null);
      setResetPassword("");
      setResetCurrent("");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    let ok = false;
    try {
      ok = await callManageStaff({ action: "delete", staff_id: deleteTarget.id });
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
    if (ok) {
      toast.success("Staff account deleted.");
      setDeleteTarget(null);
      refresh();
    }
  };

  /* Active is not a tab: it would repeat All almost always. Suspended appears
     only when someone is suspended (or while it is the chosen view). */
  const TABS: { key: StaffTab; label: string; n: number }[] = [
    { key: "all", label: "All", n: counts.total },
    { key: "admins", label: "Administrators", n: counts.admins },
    ...(counts.suspended > 0 || tab === "suspended"
      ? [{ key: "suspended" as StaffTab, label: "Suspended", n: counts.suspended }]
      : []),
  ];

  return (
    <AdminLayout
      title={activeView === "attendance" ? "Attendance" : "Staff Accounts"}
      subtitle={activeView === "staff" ? "Who can sign in, and what they can do" : isStaff ? "Your attendance record" : "Daily attendance for your staff"}
    >
      <div className={PAGE_WRAP}>

        {activeView === "staff" ? (
          <>
        {/* ── Toolbar: tabs, search and Add staff ── */}
        <div className={`${PANEL} flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6`}>
          <div role="group" aria-label="Show accounts" className={SEG_TRACK}>
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-pressed={active}
                  className={segTab(active)}
                >
                  {t.label}
                  <span
                    className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-bold tabular-nums ${
                      active
                        ? "bg-white/20"
                        : "bg-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    {isError ? "–" : t.n}
                  </span>
                </button>
              );
            })}
          </div>

          <SearchField
            label="Search by name, email or job title"
            value={query}
            onChange={setQuery}
            className="min-w-[200px] max-w-[460px] flex-1 basis-[280px]"
          />

          <button onClick={() => setShowCreate(true)} className={`${ADD_BTN} ml-auto`}>
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
            Add staff
          </button>
        </div>

        {/* ── Table ── */}
        <div className={PANEL}>
          <div className={`${TABLE_HEAD} ${ROW_COLS}`}>
            <span>Staff member</span>
            <span>Role</span>
            <span>Access</span>
            <span>Added</span>
            <span className="text-right">Action</span>
          </div>

          {isLoading ? (
            /* Skeleton rows, laid out like the real ones. */
            <div role="status" aria-live="polite" aria-busy="true">
              <span className="sr-only">Loading staff accounts</span>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`grid grid-cols-2 gap-3 border-b border-[hsl(var(--border)/.55)] px-5 py-4 last:border-0 sm:px-6 lg:items-center lg:gap-4 ${ROW_COLS}`}
                  aria-hidden="true"
                >
                  <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                    <div className={`h-10 w-10 shrink-0 rounded-full ${SKELETON}`} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className={`h-4 w-3/5 rounded-full ${SKELETON}`} />
                      <div className={`h-3.5 w-4/5 rounded-full ${SKELETON}`} />
                    </div>
                  </div>
                  <div className={`h-4 w-3/5 rounded-full ${SKELETON}`} />
                  <div className={`h-7 w-24 rounded-full ${SKELETON}`} />
                  <div className={`h-4 w-20 rounded-full ${SKELETON}`} />
                  <div className="col-span-2 flex items-center justify-end lg:col-span-1">
                    <div className={`h-9 w-9 rounded-full ${SKELETON}`} />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-14 text-center" role="alert">
              <AlertTriangle className="mx-auto text-[hsl(var(--destructive))]" aria-hidden="true" />
              <p className="mt-3 text-[14px] font-bold">Couldn&apos;t load staff accounts</p>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[hsl(var(--muted-foreground))]">
                Check your connection and try again. Nothing has been changed.
              </p>
              <button onClick={() => void refetch()} className={`${OUTLINE_BTN} mx-auto mt-4`}>
                Try again
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="p-14 text-center">
              <UserCog className="mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <p className="mt-3 text-[14px] font-bold">
                {shown.length === 0 ? "No staff accounts yet" : "Nobody matches that"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[hsl(var(--muted-foreground))]">
                {shown.length === 0
                  ? "Add an account for each person who needs to sign in."
                  : "Try a different name, email, or job title."}
              </p>
              {shown.length === 0 && (
                <button onClick={() => setShowCreate(true)} className={`${ADD_BTN} mx-auto mt-4`}>
                  Add the first account
                </button>
              )}
            </div>
          ) : (
            visible.map((s) => {
              const busy = busyId === s.id;
              const rules = rulesFor(s);
              const { self, lastAdmin } = rules;
              const suspended = s.status === "suspended";
              const canEditAnything = !rules.jobLocked || rules.secondEditable || rules.roleEditable;
              const ownerAccountLocked = isClinicOwner(s.job_title) && !isSuperAdmin;
              const protectedAccountLocked = s.protected && !self && !isSuperAdmin;
              const adminAccountLocked = s.role === "admin" && !canManageRoles;
              const accountActionsLocked = ownerAccountLocked || protectedAccountLocked || adminAccountLocked;
              const accountActionsWhy = ownerAccountLocked
                ? "Only a system administrator can manage the Clinic Owner account"
                : protectedAccountLocked
                  ? "This account is protected"
                  : adminAccountLocked
                    ? "Only the Clinic Owner can manage administrator accounts"
                    : "";

              /* Every action, labelled. One that can't be used says why. */
              const menuItems: MenuItem[] = [
                {
                  key: "edit",
                  label: "Edit role & access",
                  icon: UserCog,
                  onClick: () => openEdit(s),
                  disabled: !canEditAnything,
                  why: canManageRoles ? "Nothing on this account can be changed" : "Only the Clinic Owner can change roles",
                },
                ...((self || isSuperAdmin)
                  ? [{
                      key: "reset",
                      label: "Reset password",
                      icon: KeyRound,
                      onClick: () => {
                        setResetTarget(s);
                        setResetPassword("");
                        setResetCurrent("");
                        setShowResetCurrent(false);
                        // Resetting someone else's password: show it, so you can
                        // read it out to them. Your own: hidden until you press the eye.
                        setShowResetNew(!isSelf(s));
                      },
                    }]
                  : []),
                suspended
                  ? {
                      key: "restore",
                      label: "Restore access",
                      icon: ShieldCheck,
                      onClick: () => run(s.id, () => callManageStaff({ action: "reactivate", staff_id: s.id }), "Account restored."),
                      disabled: accountActionsLocked,
                      why: accountActionsWhy,
                    }
                  : {
                      key: "suspend",
                      label: "Suspend account",
                      icon: ShieldOff,
                      onClick: () => run(s.id, () => callManageStaff({ action: "suspend", staff_id: s.id }), "Account suspended."),
                      disabled: self || lastAdmin || accountActionsLocked,
                      why: self ? "You can't suspend yourself" : lastAdmin ? "The last administrator can't be suspended" : accountActionsWhy,
                    },
                {
                  key: "delete",
                  label: "Delete account",
                  icon: Trash2,
                  danger: true,
                  onClick: () => setDeleteTarget(s),
                  disabled: self || lastAdmin || accountActionsLocked,
                  why: self ? "You can't delete your own account" : lastAdmin ? "The last administrator can't be deleted" : accountActionsWhy,
                },
              ];

              return (
                <div
                  key={s.id}
                  className={`grid grid-cols-2 gap-x-4 gap-y-3 border-b border-[hsl(var(--border)/.7)] px-5 py-4 transition last:border-0 sm:px-6 lg:items-center ${ROW_COLS} ${
                    suspended ? "bg-[hsl(var(--muted)/.4)]" : "hover:bg-[hsl(var(--muted)/.45)]"
                  }`}
                >
                  {/* Staff member: photo (or initials) in the navy ring */}
                  <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                    <RingAvatar src={s.avatar_url} name={s.full_name} className={`h-11 w-11 ${suspended ? "grayscale" : ""}`} />
                    <div className="min-w-0">
                      <p className={`flex min-w-0 flex-wrap items-center gap-1.5 break-words text-[14px] font-bold ${suspended ? "text-[hsl(var(--muted-foreground))]" : ""}`}>
                        <span className="min-w-0 break-words">{s.title ? `${s.title} ${s.full_name}` : s.full_name}</span>
                        {self && (
                          <span className="shrink-0 text-[12px] font-semibold text-[hsl(var(--muted-foreground))]">you</span>
                        )}
                        {suspended && (
                          <span className="shrink-0 rounded-md bg-[hsl(12_70%_93%)] px-1.5 py-px text-[11px] font-bold text-[hsl(12_58%_36%)]">
                            Suspended
                          </span>
                        )}
                      </p>
                      <p className="break-all text-[12.5px] text-[hsl(var(--muted-foreground))]" title={s.email}>{s.email}</p>
                      {s.phone && (
                        <p className="truncate text-[12.5px] text-[hsl(var(--muted-foreground))]">{s.phone}</p>
                      )}
                    </div>
                  </div>

                  {/* Role: the job title, and the second role under it */}
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold leading-snug" title={s.job_title || undefined}>
                      {s.job_title || <span className="font-normal text-[hsl(var(--muted-foreground))]">No job title</span>}
                    </p>
                    {s.secondary_title && (
                      <p className="text-[12.5px] leading-snug text-[hsl(var(--muted-foreground))]">
                        also {s.secondary_title}
                      </p>
                    )}
                  </div>

                  {/* Access: shown as a label. It is changed in the edit dialog. */}
                  <div className="min-w-0">
                    {s.protected ? <RolePill role="staff" label="Developer" /> : <RolePill role={s.role} />}
                  </div>

                  <p className="text-[14px]">{fmtDate(s.created_at)}</p>

                  {/* Action: one three-dot menu */}
                  <div className="col-span-2 flex items-center justify-end lg:col-span-1">
                    {busy ? (
                      <Loader2 size={20} className="animate-spin text-[hsl(var(--primary))]" aria-label="Working" />
                    ) : s.protected ? (
                      <p className="text-[13px] font-semibold text-[hsl(var(--muted-foreground))]">Protected</p>
                    ) : isClinicOwner(s.job_title) && !isSuperAdmin && !self ? (
                      <p className="text-[13px] font-semibold text-[hsl(var(--muted-foreground))]">Clinic Owner</p>
                    ) : (
                      <ActionMenu items={menuItems} name={s.full_name} />
                    )}
                  </div>
                </div>
              );
            })
          )}

          {visible.length > 0 && (
            <div className="border-t border-[hsl(var(--border)/.7)] px-5 py-3.5 sm:px-6">
              <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                Showing <strong className="text-[hsl(var(--foreground))]">{visible.length}</strong> of{" "}
                {shown.length} accounts{hasFilters ? " (filtered)" : ""}
              </p>
            </div>
          )}
        </div>
          </>
        ) : (
          <div className={ATTENDANCE_WRAP}>
            <AttendanceTab
              members={shown}
              membersLoading={isLoading}
              membersError={isError}
              onRetryMembers={() => void refetch()}
              canManageSchedule={isSuperAdmin || isClinicOwner(me?.job_title)}
            />
          </div>
        )}
      </div>

      {/* ── Edit role & access ── */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o && !savingEdit) setEditTarget(null); }}>
        <DialogContent className={`!flex max-h-[94vh] max-w-[560px] flex-col gap-0 overflow-hidden p-0 ${DIALOG_PANEL}`}>
          <div className="flex shrink-0 items-start justify-between gap-3 px-8 pb-0 pt-7">
            <div className="min-w-0">
              <p className="mb-1.5 text-[12px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
                Staff account
              </p>
              <DialogTitle className="text-[26px] font-bold leading-tight tracking-[-.02em]">Edit role &amp; access</DialogTitle>
            </div>
            <button
              onClick={() => setEditTarget(null)}
              disabled={savingEdit}
              className={`rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
            <div className="mb-6 mt-5 flex items-center gap-3 rounded-[14px] border border-[hsl(var(--card-border))] bg-white px-4 py-3.5">
              <RingAvatar src={editTarget?.avatar_url} name={editTarget?.full_name} className="h-12 w-12" />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-bold">
                  {editTarget?.title ? `${editTarget.title} ${editTarget.full_name}` : editTarget?.full_name}
                </p>
                <p className="flex items-center gap-1.5 text-[14px] text-[hsl(var(--muted-foreground))]">
                  <Mail size={15} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{editTarget?.email}</span>
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <FloatSelect
                label="Job title"
                value={editJob}
                disabled={!editRules || editRules.jobLocked}
                title={editRules?.jobLocked ? "This job title can't be changed here" : undefined}
                onChange={(e) => setEditJob(e.target.value)}
              >
                <option value="">—</option>
                {jobTitles
                  .filter((t) => isSuperAdmin || !isClinicOwner(t.name))
                  .map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                {editTarget?.job_title && !jobTitles.some((t) => t.name === editTarget.job_title) && (
                  <option value={editTarget.job_title}>{editTarget.job_title}</option>
                )}
              </FloatSelect>

              <div>
                <FloatSelect
                  label="Second role (optional)"
                  value={editSecond}
                  disabled={!editRules || !editRules.secondEditable}
                  onChange={(e) => setEditSecond(e.target.value)}
                >
                  <option value="">None</option>
                  {jobTitles
                    .filter((t) => !isClinicOwner(t.name) && t.name !== editJob)
                    .map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                  {editTarget?.secondary_title && !jobTitles.some((t) => t.name === editTarget.secondary_title) && (
                    <option value={editTarget.secondary_title}>{editTarget.secondary_title}</option>
                  )}
                </FloatSelect>
                <p className="mt-2 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">
                  For someone who covers two jobs. It shows under their job title.
                </p>
                {secondSameAsJob && (
                  <p role="alert" className="mt-2 rounded-xl bg-[hsl(var(--destructive)/.12)] px-3 py-2 text-[13px] font-medium leading-snug text-[hsl(var(--destructive))]">
                    The second job title can&apos;t be the same as the first.
                  </p>
                )}
              </div>
            </div>

            <p className={GROUP_LABEL} id="edit-access-label">Access level</p>
            <div role="radiogroup" aria-labelledby="edit-access-label" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                ["staff", "Staff", "Day-to-day work in the system"],
                ["admin", "Administrator", "Full access, manages staff accounts"],
              ] as const).map(([value, label, sub]) => {
                const on = editRole === value;
                const locked = !editRules || !editRules.roleEditable;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={locked}
                    onClick={() => setEditRole(value)}
                    className={`flex items-start gap-3 rounded-[14px] border-2 px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING} ${
                      on
                        ? "border-[hsl(var(--primary))] bg-[#F5F3EE]"
                        : "border-[hsl(var(--card-border))] bg-white enabled:hover:bg-[hsl(var(--muted))]"
                    }`}
                  >
                    <span
                      className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        on ? "border-[hsl(var(--primary))]" : "border-[#C9C5B4]"
                      }`}
                    >
                      {on && <span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--primary))]" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold">{label}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">{sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {editRules && !editRules.roleEditable && editRules.roleWhy && (
              <p className="mt-2 px-1 text-[13px] text-[hsl(var(--muted-foreground))]">{editRules.roleWhy}.</p>
            )}
            {editChanged?.role && (
              <p className="mt-2 rounded-xl bg-[hsl(40_80%_90%)] px-3 py-2 text-[13px] font-medium leading-snug text-[hsl(40_70%_26%)]">
                You&apos;ll be asked to confirm the access change next, because it takes effect immediately.
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-[hsl(var(--card-border))] px-8 py-4">
            <button
              onClick={() => setEditTarget(null)}
              disabled={savingEdit}
              className={`${CTL_BASE} ${CTL_FIELD} px-6 transition hover:bg-[hsl(var(--muted))]`}
            >
              Cancel
            </button>
            <button
              onClick={() => void saveEdit()}
              disabled={savingEdit || !editDirty || secondSameAsJob}
              className={`${BTN_SOLID} h-12 gap-2 px-6 ${FOCUS_RING}`}
            >
              {savingEdit
                ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                : editChanged?.role && !editChanged.job && !editChanged.second ? "Continue" : "Save changes"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add staff member ── */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!o) setShowCreate(false); }}>
        <DialogContent className={`!flex max-h-[96vh] max-w-[640px] flex-col gap-0 overflow-hidden p-0 ${DIALOG_PANEL}`}>
          {/* Header (pinned) */}
          <div className="flex shrink-0 items-start justify-between gap-3 px-8 pb-0 pt-7">
            <div>
              <DialogTitle className="text-[26px] font-bold leading-tight tracking-[-.02em]">Add staff member</DialogTitle>
              <DialogDescription className="mt-2 text-[14px] text-[hsl(var(--muted-foreground))]">
                They&apos;ll use the email and password below to sign in.
              </DialogDescription>
            </div>
            <button
              onClick={() => setShowCreate(false)}
              className={`rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              Close
            </button>
          </div>

          {/* Body (scrolls if the screen is short) */}
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
            <p className={`${GROUP_LABEL} !mt-5`}>Who they are</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[130px_minmax(0,1fr)_minmax(0,1fr)]">
              <FloatSelect label="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}>
                <option value="">None</option>
                <option value="Dr.">Dr.</option>
                <option value="Mr.">Mr.</option>
                <option value="Ms.">Ms.</option>
                <option value="Mrs.">Mrs.</option>
              </FloatSelect>
              <FloatInput label="First name" value={newFirst} onChange={setNewFirst} autoComplete="off" />
              <FloatInput label="Last name" value={newLast} onChange={setNewLast} autoComplete="off" />
            </div>

            <div className="flex items-end justify-between gap-3">
              <p className={GROUP_LABEL}>Their role</p>
              <button
                type="button"
                onClick={() => setShowManageJobTitles(true)}
                className={`mb-3 rounded-full px-1 py-0.5 text-[14px] font-bold text-[hsl(var(--primary))] hover:underline ${FOCUS_RING}`}
              >
                Manage job titles
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FloatSelect label="Job title" value={newJobTitle} onChange={(e) => setNewJobTitle(e.target.value)}>
                <option value="">Select a job title</option>
                {jobTitles
                  .filter((t) => isSuperAdmin || !isClinicOwner(t.name))
                  .map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </FloatSelect>
              <FloatSelect label="Second role (optional)" value={newSecondary} onChange={(e) => setNewSecondary(e.target.value)}>
                <option value="">None</option>
                {jobTitles
                  .filter((t) => !isClinicOwner(t.name) && t.name !== newJobTitle)
                  .map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </FloatSelect>
            </div>

            <p className={GROUP_LABEL}>Sign-in details</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FloatInput label="Email" type="email" value={newEmail} onChange={setNewEmail} autoComplete="off" />
              <FloatInput
                label="Temporary password"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                maxLength={72}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                }
              />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {PASSWORD_RULES.map((r) => [r.label, r.test(newPassword)] as const).map(([label, ok]) => (
                <span
                  key={label}
                  className={`flex items-center gap-2 text-[13px] ${
                    ok ? "font-semibold text-[hsl(145_42%_27%)]" : "text-[hsl(var(--muted-foreground))]"
                  }`}
                >
                  {ok
                    ? <Check size={15} strokeWidth={2.4} aria-hidden="true" />
                    : <span className="h-[15px] w-[15px] rounded-full border-[1.5px] border-[#B9B7AA]" aria-hidden="true" />}
                  {label}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">
              Share it with them directly. They can change it after signing in.
            </p>

            <p className={GROUP_LABEL} id="staff-access-label">Access level</p>
            <div role="radiogroup" aria-labelledby="staff-access-label" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                ["staff", "Staff", "Day-to-day work in the system"],
                ["admin", "Administrator", "Full access, manages staff"],
              ] as const).map(([value, label, sub]) => {
                const on = newRole === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setNewRole(value)}
                    disabled={value === "admin" && !canManageRoles}
                    className={`flex items-start gap-3 rounded-[14px] border-2 px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING} ${
                      on
                        ? "border-[hsl(var(--primary))] bg-[#F5F3EE]"
                        : "border-[hsl(var(--card-border))] bg-white hover:bg-[hsl(var(--muted))]"
                    }`}
                  >
                    <span
                      className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        on ? "border-[hsl(var(--primary))]" : "border-[#C9C5B4]"
                      }`}
                    >
                      {on && <span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--primary))]" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold">{label}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">{sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {!canManageRoles && (
              <p className="mt-2 text-[13px] text-[hsl(var(--muted-foreground))]">
                Only the Clinic Owner can create administrator accounts.
              </p>
            )}
          </div>

          {/* Footer (pinned) */}
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[hsl(var(--card-border))] px-8 py-4">
            {missing.length > 0 && (
              <p
                className="mr-auto hidden min-w-0 flex-1 truncate text-[14px] text-[hsl(var(--muted-foreground))] sm:block"
                title={`Still needed: ${missing.join(", ")}`}
                aria-live="polite"
              >
                {missing.length > 2 ? `${missing.length} fields still needed` : `Still needed: ${missing.join(", ")}`}
              </p>
            )}
            <button
              onClick={() => setShowCreate(false)}
              className={`${CTL_BASE} ${CTL_FIELD} shrink-0 whitespace-nowrap px-6 transition hover:bg-[hsl(var(--muted))]`}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !canSubmit}
              className={`${BTN_SOLID} h-12 shrink-0 gap-2 whitespace-nowrap px-6 ${FOCUS_RING}`}
            >
              {creating
                ? <><Loader2 size={16} className="animate-spin" /> Creating…</>
                : "Create account"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reset password ── */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className={`!flex max-h-[94vh] max-w-[520px] flex-col gap-0 overflow-hidden p-0 ${DIALOG_PANEL}`}>
          <div className="flex shrink-0 items-start justify-between gap-3 px-8 pb-0 pt-7">
            <div className="min-w-0">
              <p className="mb-1.5 text-[12px] font-bold uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">
                Staff account
              </p>
              <DialogTitle className="text-[26px] font-bold leading-tight tracking-[-.02em]">Reset password</DialogTitle>
            </div>
            <button
              onClick={() => setResetTarget(null)}
              className={`rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
            {/* Whose password this is */}
            <div className="mb-6 mt-5 flex items-center gap-3 rounded-[14px] border border-[hsl(var(--card-border))] bg-white px-4 py-3.5">
              <RingAvatar src={resetTarget?.avatar_url} name={resetTarget?.full_name} className="h-12 w-12" />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-bold">
                  {resetTarget?.title ? `${resetTarget.title} ${resetTarget.full_name}` : resetTarget?.full_name}
                </p>
                <p className="flex items-center gap-1.5 text-[14px] text-[hsl(var(--muted-foreground))]">
                  <Mail size={15} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{resetTarget?.email}</span>
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {resetSelf && (
                <FloatInput
                  label="Current password"
                  type={showResetCurrent ? "text" : "password"}
                  value={resetCurrent}
                  onChange={setResetCurrent}
                  autoComplete="current-password"
                  trailing={<EyeToggle shown={showResetCurrent} onClick={() => setShowResetCurrent((v) => !v)} />}
                />
              )}
              <FloatInput
                label="New password"
                type={showResetNew ? "text" : "password"}
                value={resetPassword}
                onChange={setResetPassword}
                autoComplete={resetSelf ? "new-password" : "off"}
                maxLength={72}
                trailing={<EyeToggle shown={showResetNew} onClick={() => setShowResetNew((v) => !v)} />}
              />
            </div>

            {/* The rules, ticking off as they're met */}
            <ul className="mb-1 mt-4 px-1" aria-label="Password requirements" aria-live="polite">
              {PASSWORD_RULES.map((r) => {
                const ok = r.test(resetPassword);
                return (
                  <li
                    key={r.id}
                    className={`flex items-center gap-2.5 py-[3px] text-[14px] leading-5 transition-colors ${
                      ok ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"
                    }`}
                  >
                    <span
                      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition ${
                        ok
                          ? "border-[hsl(145_42%_33%)] bg-[hsl(145_42%_33%)] text-white"
                          : "border-[hsl(var(--muted-foreground))]"
                      }`}
                      aria-hidden="true"
                    >
                      {ok && <Check size={11} strokeWidth={3.6} />}
                    </span>
                    {r.label}
                  </li>
                );
              })}
            </ul>

            <p className="mt-3 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">
              {resetSelf
                ? "Your old password stops working, and you'll use this one the next time you sign in."
                : "Their old password stops working immediately. Give them this one directly."}
            </p>

            {resetSame && (
              <p role="alert" className="mt-3 rounded-xl bg-[hsl(var(--destructive)/.12)] px-3 py-2 text-[13px] font-medium leading-snug text-[hsl(var(--destructive))]">
                The new password can&apos;t be the same as the current one.
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-[hsl(var(--card-border))] px-8 py-4">
            <button
              onClick={() => setResetTarget(null)}
              className={`${CTL_BASE} ${CTL_FIELD} px-6 transition hover:bg-[hsl(var(--muted))]`}
            >
              Cancel
            </button>
            <button
              onClick={handleReset}
              disabled={resetting || !resetReady}
              className={`${BTN_SOLID} h-12 gap-2 px-6 ${FOCUS_RING}`}
            >
              {resetting
                ? <><Loader2 size={16} className="animate-spin" /> Updating…</>
                : "Set password"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Change access level ── */}
      <Dialog open={!!roleChange} onOpenChange={(o) => { if (!o) setRoleChange(null); }}>
        <DialogContent className={`max-w-[480px] p-8 ${DIALOG_PANEL}`}>
          <DialogTitle className="text-[26px] font-bold leading-tight tracking-[-.02em]">
            Change access for {roleChange?.staff.full_name}?
          </DialogTitle>
          <p className="mt-3 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            {roleChange?.newRole === "admin"
              ? "They'll become an administrator with full access, including managing staff accounts. This takes effect immediately."
              : "They'll lose administrator access and can no longer manage staff accounts. This takes effect immediately."}
          </p>
          <div className="mt-7 flex justify-end gap-3">
            <button
              onClick={() => setRoleChange(null)}
              className={`${CTL_BASE} ${CTL_FIELD} px-6 transition hover:bg-[hsl(var(--muted))]`}
            >
              Cancel
            </button>
            <button
              onClick={() => void confirmRoleChange()}
              className={`${BTN_SOLID} h-12 px-6 ${FOCUS_RING}`}
            >
              {roleChange?.newRole === "admin" ? "Make administrator" : "Make staff"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className={`max-w-[480px] p-8 ${DIALOG_PANEL}`}>
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--destructive))] text-[hsl(var(--destructive))]">
              <AlertTriangle size={22} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[26px] font-bold leading-tight tracking-[-.02em]">Delete this account?</DialogTitle>
              <p className="mt-3 text-[15px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                <strong className="text-[hsl(var(--foreground))]">{deleteTarget?.full_name}</strong> loses
                access immediately and the account can&apos;t be restored. Suspending
                keeps the record and can be undone.
              </p>
            </div>
          </div>
          <div className="mt-7 flex justify-end gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              className={`${CTL_BASE} ${CTL_FIELD} px-6 transition hover:bg-[hsl(var(--muted))]`}
            >
              Keep account
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`flex h-12 items-center justify-center rounded-xl bg-[hsl(var(--destructive))] px-6 text-[15px] font-bold text-[hsl(var(--destructive-foreground))] disabled:opacity-60 ${FOCUS_RING}`}
            >
              {deleting ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ManageJobTitlesDialog
        open={showManageJobTitles}
        onClose={() => setShowManageJobTitles(false)}
        staff={staff}
        canUpdatePeople={canManageRoles}
      />
    </AdminLayout>
  );
}
