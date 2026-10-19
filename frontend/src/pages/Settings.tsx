import { useEffect, useId, useRef, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import HoursSection from "@/components/settings/HoursSection";
import PhotoCropper from "@/components/PhotoCropper";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Loader2, Check, ChevronDown, Smartphone, MapPin,
  Phone, Mail, Clock, AlertTriangle, Camera, Lock,
  Globe, ExternalLink, ChevronLeft, Stethoscope, Scissors,
} from "lucide-react";

type SectionKey = "general" | "hours" | "species";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "general", label: "Clinic details" },
  { key: "hours", label: "Operating hours" },
  { key: "species", label: "Species & breeds" },
];

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

const PAGE_WRAP = "mx-auto w-full max-w-[1440px] space-y-4 px-5 pb-8 sm:px-8 lg:px-10";
const CARD =
  "rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[0_1px_2px_rgb(15_36_71/.05),0_4px_16px_rgb(15_36_71/.05)]";
const APP_CARD = "rounded-[24px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))]";
const SEG_TRACK =
  "inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--muted)/.5)] p-1";
const segTab = (active: boolean) =>
  `flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[14px] font-semibold transition ${FOCUS_RING} ${
    active
      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
  }`;
const BTN_OUTLINE =
  `inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:hover:bg-[hsl(var(--card))] ${FOCUS_RING}`;
const BTN_SOLID =
  `inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:hover:opacity-100 ${FOCUS_RING}`;
const HELP = "mt-1.5 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]";
const ERR = "mt-1.5 text-[13px] font-medium leading-snug text-[hsl(var(--destructive))]";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

function closingTime(lastSlot?: string | null) {
  if (!lastSlot) return "";
  const [h, m] = lastSlot.split(":").map(Number);
  const end = h * 60 + m + 30;
  return fmtTime(`${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`);
}

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

const INPUT =
  "block h-11 w-full rounded-[10px] border bg-[hsl(var(--card))] px-3 text-[14px] font-medium transition placeholder:font-normal placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]";
const inputBorder = (error?: boolean) =>
  error ? "border-[hsl(var(--destructive))]" : "border-[hsl(var(--input))] focus:border-[hsl(var(--primary))]";

function FieldLabel({ id, label }: { id: string; label: string }) {
  const [main, ...rest] = label.split(" · ");
  return (
    <label htmlFor={id} className="mb-1.5 block text-[13px] font-bold">
      {main}
      {rest.length > 0 && (
        <span className="ml-1 font-medium text-[hsl(var(--muted-foreground))]">· {rest.join(" · ")}</span>
      )}
    </label>
  );
}

function TextField({
  label, value, onChange, type = "text", className = "", error, bare, ...rest
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; className?: string; error?: boolean;
  bare?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const id = useId();
  return (
    <div className={className}>
      {!bare && <FieldLabel id={id} label={label} />}
      <input
        {...rest}
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={bare ? label : rest.placeholder}
        aria-label={bare ? label : undefined}
        aria-invalid={error || undefined}
        className={`${INPUT} ${inputBorder(error)}`}
      />
    </div>
  );
}

function TextArea({
  label, value, onChange, maxLength, rows = 3, className = "", describedBy,
}: {
  label: string; value: string; onChange: (v: string) => void; maxLength?: number; rows?: number;
  className?: string; describedBy?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <FieldLabel id={id} label={label} />
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        aria-describedby={describedBy}
        className={`${INPUT} h-auto resize-y py-2.5 leading-5 ${inputBorder()}`}
      />
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3.5 flex items-center gap-3 text-[16px] font-extrabold leading-6 tracking-[-.01em]">
      {children}
      <span className="h-px flex-1 bg-[hsl(var(--card-border))]" aria-hidden="true" />
    </h3>
  );
}

function SaveBar({
  isDirty, saving, canSave, onDiscard, onSave,
}: { isDirty: boolean; saving: boolean; canSave: boolean; onDiscard: () => void; onSave: () => void }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-[hsl(var(--border)/.7)] bg-[hsl(var(--card))] px-6 py-3.5">
      <p
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 text-[14px] ${
          isDirty ? "font-bold text-[hsl(var(--foreground))]" : "font-semibold text-[hsl(145_42%_27%)]"
        }`}
      >
        {!isDirty && <Check size={16} strokeWidth={2.6} aria-hidden="true" />}
        {isDirty ? "Unsaved changes" : "All changes saved"}
      </p>
      <div className="flex gap-2.5">
        <button type="button" onClick={onDiscard} disabled={!isDirty || saving} className={BTN_OUTLINE}>
          Discard
        </button>
        <button type="button" onClick={onSave} disabled={!canSave} className={BTN_SOLID}>
          {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : "Save changes"}
        </button>
      </div>
    </div>
  );
}

const fetchSpecies = async () => {
  const { data, error } = await (supabase as any)
    .from("categories").select("id, name").eq("type", "species")
    .order("sort_order").order("name");
  if (error) throw error;
  return data || [];
};

export default function Settings() {
  const [section, setSection] = useState<SectionKey>("general");

  const { data: species = [] } = useQuery<NamedRow[]>({ queryKey: ["settings-species"], queryFn: fetchSpecies });
  const { data: services = [] } = useQuery({
    queryKey: ["settings-stat-services", section],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("booking_categories").select("opening_time, last_slot, is_active");
      return data || [];
    },
  });
  const openServices = services.filter((c: any) => c.is_active);

  const badge: Partial<Record<SectionKey, string>> = {
    hours: services.length ? `${openServices.length}/${services.length}` : "",
    species: String(species.length),
  };

  return (
    <AdminLayout title="Settings">
      <div className={PAGE_WRAP}>
        <div className={`${CARD} p-3`}>
          <div role="group" aria-label="Settings sections" className={SEG_TRACK}>
            {SECTIONS.map(({ key, label }) => {
              const active = section === key;
              const n = badge[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSection(key)}
                  aria-current={active ? "page" : undefined}
                  className={segTab(active)}
                >
                  {label}
                  {n ? (
                    <span
                      className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-bold tabular-nums ${
                        active ? "bg-white/20" : "bg-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      {n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {section === "general" && <ClinicSection />}
        {section === "hours" && <HoursSection />}
        {section === "species" && <SpeciesSection />}
      </div>
    </AdminLayout>
  );
}

/* ══════════════════ Clinic details ══════════════════ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function phoneIssue(v: string) {
  const t = v.trim();
  if (!t) return "";
  const digits = t.replace(/\D/g, "");
  if (!/^[0-9+\-()\s]+$/.test(t) || digits.length < 7 || digits.length > 13) {
    return "Enter a number owners can call, like 0917 123 4567.";
  }
  return "";
}

const ABOUT_FALLBACK =
  "Pet Royale Clinic and Veterinary Services provides excellent healthcare of all companion animals.";

const LOGO_BUCKET = "clinic-assets";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const MAPS_RE = /^https?:\/\/((www\.|maps\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;
const FB_RE = /^(https?:\/\/)?([a-z0-9-+\u002e]+\.)?(facebook\.com|fb\.com|fb\.me)\/\S+/i;

function AppRow({
  Icon, label, value, empty, tone, first,
}: { Icon: any; label: string; value: string; empty: string; tone?: "danger"; first?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 ${first ? "" : "border-t border-[hsl(var(--border))]"}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone === "danger" ? "bg-[#F3E1DB]" : "bg-[hsl(var(--muted))]"}`}>
        <Icon size={18} strokeWidth={1.9} aria-hidden="true" className={value ? (tone === "danger" ? "text-[#9A3B2B]" : "text-[hsl(var(--primary))]") : "text-[hsl(var(--muted-foreground))]"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[hsl(var(--muted-foreground))]">{label}</p>
        <p className={`break-all text-[16px] ${value ? "font-medium" : "break-words text-[14px] italic text-[hsl(var(--muted-foreground))]"}`}>
          {value || empty}
        </p>
      </div>
      {value && <ExternalLink size={14} aria-hidden="true" className="shrink-0 text-[hsl(var(--muted-foreground))]" />}
    </div>
  );
}

function ClinicSection() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["clinic-settings"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clinic_settings").select("*").limit(1).maybeSingle();
      return data;
    },
  });

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

  const extras = !!settings && "logo_url" in settings;

  const [clinicName, setClinicName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [emergency, setEmergency] = useState("");
  const [mapLink, setMapLink] = useState("");
  const [facebook, setFacebook] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const logoUrl: string | null = settings?.logo_url || null;

  const loadFromSaved = () => {
    if (!settings) return;
    setClinicName(settings.clinic_name || "");
    setPhoneNumber(settings.phone_number || "");
    setEmail(settings.email || "");
    setAddress(settings.address || "");
    setDescription(settings.description || "");
    setEmergency(settings.emergency_phone || "");
    setMapLink(settings.map_link || "");
    setFacebook(settings.facebook_url || "");
  };

  const savedKey = JSON.stringify([
    settings?.clinic_name, settings?.phone_number, settings?.email, settings?.address,
    settings?.description, settings?.emergency_phone, settings?.map_link, settings?.facebook_url,
  ]);
  useEffect(() => {
    loadFromSaved();
  }, [savedKey]);

  const isDirty = !!settings && (
    clinicName !== (settings.clinic_name || "") ||
    phoneNumber !== (settings.phone_number || "") ||
    email !== (settings.email || "") ||
    address !== (settings.address || "") ||
    (extras && (
      description !== (settings.description || "") ||
      emergency !== (settings.emergency_phone || "") ||
      mapLink !== (settings.map_link || "") ||
      facebook !== (settings.facebook_url || "")
    ))
  );

  const nameMissing = !clinicName.trim();
  const phoneProblem = phoneIssue(phoneNumber);
  const emailProblem = email.trim() && !EMAIL_RE.test(email.trim()) ? "Enter a valid email address." : "";
  const emergencyProblem = extras ? phoneIssue(emergency) : "";
  const mapProblem = extras && mapLink.trim() && !MAPS_RE.test(mapLink.trim()) ? "Paste a Google Maps link." : "";
  const facebookProblem = extras && facebook.trim() && !FB_RE.test(facebook.trim()) ? "Paste your Facebook page link." : "";
  const canSave = isDirty && !saving && !nameMissing && !phoneProblem && !emailProblem
    && !emergencyProblem && !mapProblem && !facebookProblem;

  const handleSave = async () => {
    if (nameMissing) { toast.error("Clinic name is required."); return; }
    if (phoneProblem) { toast.error(phoneProblem); return; }
    if (emailProblem) { toast.error(emailProblem); return; }
    if (emergencyProblem) { toast.error(emergencyProblem); return; }
    if (mapProblem) { toast.error(mapProblem); return; }
    if (facebookProblem) { toast.error(facebookProblem); return; }

    const payload: Record<string, unknown> = {
      clinic_name: clinicName.trim(),
      phone_number: phoneNumber.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
    };
    if (extras) {
      payload.description = description.trim() || null;
      payload.emergency_phone = emergency.trim() || null;
      payload.map_link = mapLink.trim() || null;
      payload.facebook_url = facebook.trim() || null;
    }

    setSaving(true);
    const { error } = await (supabase as any)
      .from("clinic_settings")
      .update(payload)
      .eq("id", settings.id);
    setSaving(false);

    if (error) { toast.error("Couldn't save those details."); return; }
    toast.success("Clinic details updated.");
    queryClient.invalidateQueries({ queryKey: ["clinic-settings"] });
  };

  const removeStoredLogo = (url: string | null) => {
    if (!url) return;
    const marker = `/${LOGO_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
    void supabase.storage.from(LOGO_BUCKET).remove([path]);
  };

  const handleLogoChosen = (file?: File) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file || !settings) return;
    if (!PHOTO_TYPES.includes(file.type)) { toast.error("Use a JPG, PNG or WebP image."); return; }
    if (file.size > PHOTO_MAX_BYTES) { toast.error("That logo is over 2 MB. Choose a smaller one."); return; }
    setCropFile(file);
  };

  const uploadLogo = async (blob: Blob) => {
    if (!settings) return;
    setLogoBusy(true);
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const path = `logo/${Date.now()}.${ext}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, blob, { contentType: blob.type, upsert: false });
      if (uploadError) throw uploadError;

      const url = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await (supabase as any)
        .from("clinic_settings").update({ logo_url: url }).eq("id", settings.id);
      if (error) {
        void supabase.storage.from(LOGO_BUCKET).remove([path]);
        throw error;
      }
      removeStoredLogo(logoUrl);
      toast.success("Logo updated.");
      await queryClient.invalidateQueries({ queryKey: ["clinic-settings"] });
    } catch (e: any) {
      toast.error(e?.message || "Couldn't upload that logo.");
    } finally {
      setLogoBusy(false);
      setCropFile(null);
    }
  };

  const handleRemoveLogo = async () => {
    if (!logoUrl || !settings) return;
    setLogoBusy(true);
    const { error } = await (supabase as any)
      .from("clinic_settings").update({ logo_url: null }).eq("id", settings.id);
    if (error) {
      setLogoBusy(false);
      toast.error("Couldn't remove the logo.");
      return;
    }
    removeStoredLogo(logoUrl);
    toast.success("Logo removed.");
    await queryClient.invalidateQueries({ queryKey: ["clinic-settings"] });
    setLogoBusy(false);
  };

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

  const looksLikePlaceholder = /^example\b/i.test(address.trim());

  if (isLoading) {
    return (
      <div className={`${CARD} flex justify-center py-16`}>
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  const mapOk = !!mapLink.trim() && !mapProblem;
  const hasDirections = !!(address.trim() || mapOk);
  const shownName = clinicName.trim() || "Pet Royale";
  const fbShown = facebook.trim().replace(/^https?:\/\/(www\.)?/i, "");

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)] lg:items-start">
      <section className={CARD} aria-label="Clinic details">
        <p className="px-6 pt-5 text-[14px] leading-5 text-[hsl(var(--muted-foreground))]">
          Owners see these on the app&apos;s About screen. The preview updates as you type.
        </p>

        {!extras && (
          <p
            role="status"
            className="mx-6 mt-4 flex items-start gap-2.5 rounded-[14px] bg-[hsl(40_70%_90%)] px-3.5 py-2.5 text-[14px] font-medium leading-5 text-[hsl(40_55%_26%)]"
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            Logo, description, emergency number, map link and Facebook page aren&apos;t set up in the database yet. Run migration 042 to turn them on.
          </p>
        )}

        <div className="space-y-6 px-6 pb-6 pt-5">
          <div>
            <SectionHead>The clinic</SectionHead>
            <div className={`grid gap-5 ${extras ? "sm:grid-cols-[auto_minmax(0,1fr)]" : ""}`}>
              {extras && (
                <div className="flex flex-col items-start gap-2">
                  <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[24px] bg-[hsl(var(--primary))]">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Clinic logo" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[32px] font-bold italic text-[#F5C518]">{initialsOf(shownName)}</span>
                    )}
                    {logoBusy && (
                      <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--background)/.7)]">
                        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={PHOTO_TYPES.join(",")}
                    className="hidden"
                    onChange={(e) => void handleLogoChosen(e.target.files?.[0])}
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={logoBusy}
                      className={BTN_OUTLINE}
                    >
                      {logoUrl ? "Change logo" : "Upload logo"}
                    </button>
                    {logoUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        disabled={logoBusy}
                        className={`h-10 rounded-[10px] px-2 text-[14px] font-bold text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] disabled:opacity-40 ${FOCUS_RING}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">JPG, PNG or WebP, up to 2 MB.</p>
                </div>
              )}

              <div className="min-w-0 space-y-4">
                <div>
                  <TextField
                    label="Clinic name"
                    value={clinicName}
                    onChange={setClinicName}
                    autoComplete="off"
                    error={nameMissing && isDirty}
                  />
                  {nameMissing && isDirty && <p className={ERR} role="alert">Enter the clinic name.</p>}
                </div>

                {extras && (
                  <div>
                    <TextArea
                      label="Short description · Optional"
                      value={description}
                      onChange={setDescription}
                      maxLength={120}
                      describedBy="clinic-desc-hint"
                    />
                    <p id="clinic-desc-hint" className={`${HELP} flex justify-between gap-3`}>
                      <span>Shown under the name in the app.</span>
                      <span className="tabular-nums">{description.length}/120</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <SectionHead>How to reach you</SectionHead>
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <div>
                <TextField
                  label="Phone number"
                  type="tel"
                  inputMode="tel"
                  value={phoneNumber}
                  onChange={setPhoneNumber}
                  autoComplete="off"
                  aria-describedby="clinic-phone-hint"
                  error={!!phoneProblem}
                />
                <p id="clinic-phone-hint" className={phoneProblem ? ERR : HELP} role={phoneProblem ? "alert" : undefined}>
                  {phoneProblem || "Owners tap this to call you."}
                </p>
              </div>

              {extras && (
                <div>
                  <TextField
                    label="After-hours number · Optional"
                    type="tel"
                    inputMode="tel"
                    value={emergency}
                    onChange={setEmergency}
                    autoComplete="off"
                    placeholder="e.g. 0917 123 4567"
                    aria-describedby="clinic-emergency-hint"
                    error={!!emergencyProblem}
                  />
                  <p id="clinic-emergency-hint" className={emergencyProblem ? ERR : HELP} role={emergencyProblem ? "alert" : undefined}>
                    {emergencyProblem || "For emergencies when you're closed."}
                  </p>
                </div>
              )}

              <div>
                <TextField
                  label="Email address"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  autoComplete="off"
                  aria-describedby="clinic-email-hint"
                  error={!!emailProblem}
                />
                <p id="clinic-email-hint" className={emailProblem ? ERR : HELP} role={emailProblem ? "alert" : undefined}>
                  {emailProblem || "Shown to owners in the app."}
                </p>
              </div>

              {extras && (
                <div>
                  <TextField
                    label="Facebook page · Optional"
                    type="url"
                    value={facebook}
                    onChange={setFacebook}
                    autoComplete="off"
                    placeholder="https://facebook.com/…"
                    aria-describedby="clinic-fb-hint"
                    error={!!facebookProblem}
                  />
                  <p id="clinic-fb-hint" className={facebookProblem ? ERR : HELP} role={facebookProblem ? "alert" : undefined}>
                    {facebookProblem || "Copy the link from your page."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div>
            <SectionHead>Where you are</SectionHead>
            <TextArea
              label="Address"
              rows={2}
              value={address}
              onChange={(v) => setAddress(v.replace(/\s*\n\s*/g, " "))}
              describedBy="clinic-address-hint"
            />
            <p id="clinic-address-hint" className={HELP}>
              Tapping this in the app opens directions, so write it the way you&apos;d search for it on a map.
            </p>
            {looksLikePlaceholder && (
              <p
                role="status"
                className="mt-3 flex items-start gap-2.5 rounded-[14px] bg-[hsl(40_70%_90%)] px-3.5 py-2.5 text-[14px] font-medium leading-5 text-[hsl(40_55%_26%)]"
              >
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                This still looks like a placeholder. Owners get directions to whatever is saved here.
              </p>
            )}

            {extras && (
              <div className="mt-4">
                <div className="flex flex-wrap items-end gap-3">
                  <TextField
                    label="Map link · Optional"
                    type="url"
                    value={mapLink}
                    onChange={setMapLink}
                    autoComplete="off"
                    placeholder="https://maps.app.goo.gl/…"
                    aria-describedby="clinic-map-hint"
                    error={!!mapProblem}
                    className="min-w-[240px] flex-1"
                  />
                  <a
                    href={mapOk ? mapLink.trim() : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!mapOk}
                    className={`${BTN_OUTLINE} h-11 ${mapOk ? "" : "pointer-events-none opacity-40"}`}
                  >
                    Test link
                  </a>
                </div>
                <p id="clinic-map-hint" className={mapProblem ? ERR : HELP} role={mapProblem ? "alert" : undefined}>
                  {mapProblem || "In Google Maps: Share, then Copy link. Leave it empty and the app uses the address."}
                </p>
              </div>
            )}
          </div>
        </div>

        <SaveBar isDirty={isDirty} saving={saving} canSave={canSave} onDiscard={loadFromSaved} onSave={handleSave} />
      </section>

      <aside aria-labelledby="clinic-preview" className="lg:sticky lg:top-4">
        <div className="mb-2.5 flex items-center gap-2 px-1">
          <Smartphone size={16} className="text-[hsl(var(--primary))]" aria-hidden="true" />
          <h3 id="clinic-preview" className="text-[14px] font-bold">
            Preview in the app
            <span className="ml-1.5 font-medium text-[hsl(var(--muted-foreground))]">· updates live</span>
          </h3>
        </div>

        <div className="mx-auto w-[372px] max-w-full rounded-[48px] bg-[#0C1626] p-2.5 shadow-[0_24px_48px_-24px_rgb(5_31_66/.55)]">
          <div className="overflow-hidden rounded-[38px] bg-[hsl(var(--background))] px-4 pb-3 pt-3.5">
            <div className="flex h-12 items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--card-border))] bg-[hsl(var(--card))]">
                <ChevronLeft size={18} aria-hidden="true" />
              </span>
              <span className="text-[18px] font-bold">About Pet Royale</span>
            </div>

            <div className="px-2 pb-1 pt-3.5 text-center">
              <div className="mx-auto flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-[24px] bg-[hsl(var(--primary))]">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[30px] font-bold italic text-[#F5C518]">{initialsOf(shownName)}</span>
                )}
              </div>
              <p className="mt-3.5 break-words text-[24px] font-bold leading-[30px] tracking-[-.02em]">{shownName}</p>
              <p className="mt-0.5 text-[15px] text-[hsl(var(--muted-foreground))]">Clinic and Veterinary Services</p>
              <p className="mt-2.5 break-words text-[15px] leading-[22px]">
                {(extras && description.trim()) || ABOUT_FALLBACK}
              </p>
            </div>

            {(phoneNumber.trim() || hasDirections) && (
              <div className="mb-3.5 mt-4 flex gap-2.5">
                {phoneNumber.trim() && (
                  <div className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)]">
                    <Phone size={17} aria-hidden="true" /> Call
                  </div>
                )}
                {hasDirections && (
                  <div className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] text-[16px] font-bold text-[hsl(var(--primary))]">
                    <MapPin size={17} aria-hidden="true" /> Directions
                  </div>
                )}
              </div>
            )}

            <div className={`overflow-hidden ${APP_CARD} ${phoneNumber.trim() || hasDirections ? "" : "mt-4"}`}>
              <AppRow first Icon={MapPin} label="Address" value={address.trim()} empty="No address yet. Owners won't see this row." />
              <AppRow Icon={Phone} label="Phone" value={phoneNumber.trim()} empty="No phone yet. Owners won't see this row." />
              {extras && (
                <AppRow Icon={AlertTriangle} tone="danger" label="After hours or emergency" value={emergency.trim()} empty="No emergency number yet. Owners won't see this row." />
              )}
              <AppRow Icon={Mail} label="Email" value={email.trim()} empty="No email yet. Owners won't see this row." />
              {extras && (
                <AppRow Icon={Globe} label="Facebook" value={fbShown} empty="No Facebook page yet. Owners won't see this row." />
              )}
            </div>

            <div className={`mt-3.5 overflow-hidden ${APP_CARD}`}>
              <div className="flex items-center gap-2 px-4 pb-1.5 pt-3.5 text-[16px] font-bold">
                <Clock size={17} className="text-[hsl(var(--primary))]" aria-hidden="true" /> Opening hours
              </div>
              {schedules.length === 0 ? (
                <p className="border-t border-[hsl(var(--border))] px-4 py-3 text-[14px] italic text-[hsl(var(--muted-foreground))]">Not set yet</p>
              ) : (
                schedules.map((s: any) => (
                  <div key={s.key} className="flex items-center gap-3 border-t border-[hsl(var(--border))] px-3.5 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                      {s.label === "Grooming"
                        ? <Scissors size={18} strokeWidth={1.9} className="text-[hsl(var(--primary))]" aria-hidden="true" />
                        : <Stethoscope size={18} strokeWidth={1.9} className="text-[hsl(var(--primary))]" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] text-[hsl(var(--muted-foreground))]">{s.label}</p>
                      <p className="text-[16px] font-medium">{s.days}: {s.from} – {s.to}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="mt-2.5 px-1 text-[13px] leading-[18px] text-[hsl(var(--muted-foreground))]">
              These are the hours you can book. For an emergency outside them, call the clinic.
            </p>

            <div className="mx-auto mb-0.5 mt-4 h-[5px] w-[120px] rounded-full bg-[hsl(var(--foreground))] opacity-85" />
          </div>
        </div>
      </aside>

      <PhotoCropper
        file={cropFile}
        title="Adjust your logo"
        busy={logoBusy}
        onCancel={() => setCropFile(null)}
        onDone={uploadLogo}
      />
    </div>
  );
}

/* ══════════════════ Species & breeds ══════════════════ */
interface NamedRow { id: string; name: string }
interface BreedRow extends NamedRow { species_id: string }

const breedCount = (n: number) => (n === 0 ? "No breeds" : `${n} ${n === 1 ? "breed" : "breeds"}`);

const LINK_BTN = `shrink-0 rounded-md px-2 py-2 text-[14px] font-bold transition hover:underline disabled:opacity-40 ${FOCUS_RING}`;
const CHIP =
  "inline-flex h-7 shrink-0 items-center rounded-full bg-[hsl(var(--muted))] px-3 text-[13px] font-bold";

function ManagedList({
  title, subtitle, headerNote, items, loading, selectedId, onSelect, counts, columns,
  placeholder, emptyText, onAdd, onRename, onDelete,
}: {
  title: string;
  subtitle?: string;
  headerNote?: string;
  items: NamedRow[];
  loading: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  counts?: Record<string, number>;
  columns?: boolean;
  placeholder: string;
  emptyText: string;
  onAdd: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (item: NamedRow) => void;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);

  const submitAdd = async () => {
    if (!newName.trim() || adding) return;
    setAdding(true);
    const ok = await onAdd(newName);
    setAdding(false);
    if (ok) setNewName("");
  };

  const submitRename = async () => {
    if (!editingId || saving) return;
    if (!editingName.trim()) { toast.error("Name can't be empty."); return; }
    setSaving(true);
    const ok = await onRename(editingId, editingName);
    setSaving(false);
    if (ok) setEditingId(null);
  };

  const rows = Math.max(1, Math.ceil(items.length / 2));

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[17px] font-extrabold leading-6">{title}</h3>
          {subtitle && (
            <p className="text-[13px] text-[hsl(var(--muted-foreground))]">{subtitle}</p>
          )}
        </div>
        {headerNote && <span className={CHIP}>{headerNote}</span>}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <TextField
          bare
          label={placeholder}
          value={newName}
          onChange={setNewName}
          onKeyDown={(e) => { if (e.key === "Enter") void submitAdd(); }}
          autoComplete="off"
          className="min-w-0 flex-1"
        />
        <button
          onClick={() => void submitAdd()}
          disabled={adding || !newName.trim()}
          className={`${BTN_SOLID} h-11`}
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
        </button>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-[hsl(var(--muted-foreground))]">{emptyText}</p>
        ) : (
          <div
            className={`overflow-hidden rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4 ${
              columns ? "grid lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-[repeat(var(--rows),auto)] lg:gap-x-8" : ""
            }`}
            style={columns ? ({ "--rows": rows } as React.CSSProperties) : undefined}
          >
            {items.map((item, i) => {
              const isSelected = !!onSelect && item.id === selectedId;
              const line =
                i === items.length - 1
                  ? ""
                  : columns && i === rows - 1
                    ? "border-b border-[hsl(var(--card-border))] lg:border-b-0"
                    : "border-b border-[hsl(var(--card-border))]";
              return (
                <div
                  key={item.id}
                  className={`flex min-h-[52px] items-center gap-1 ${line} ${
                    isSelected ? "-mx-4 bg-[#E6E3D6] px-4" : "hover:bg-[hsl(var(--muted)/.35)]"
                  }`}
                >
                  {editingId === item.id ? (
                    <>
                      <TextField
                        bare
                        label="Name"
                        value={editingName}
                        onChange={setEditingName}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void submitRename();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        autoComplete="off"
                        className="my-1.5 min-w-0 flex-1"
                      />
                      <button
                        onClick={() => void submitRename()}
                        disabled={saving}
                        className={`${LINK_BTN} text-[hsl(var(--primary))]`}
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className={`${LINK_BTN} text-[hsl(var(--muted-foreground))]`}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {onSelect ? (
                        <button
                          onClick={() => onSelect(item.id)}
                          aria-current={isSelected ? "true" : undefined}
                          className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg py-3 text-left ${FOCUS_RING}`}
                        >
                          <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{item.name}</span>
                          {counts && (
                            <span className="shrink-0 text-[13px] text-[hsl(var(--muted-foreground))]">
                              {breedCount(counts[item.id] ?? 0)}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate py-3 text-[14px] font-bold">{item.name}</span>
                      )}
                      <button
                        onClick={() => { setEditingId(item.id); setEditingName(item.name); }}
                        aria-label={`Rename ${item.name}`}
                        className={`${LINK_BTN} text-[hsl(var(--primary))]`}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => onDelete(item)}
                        aria-label={`Delete ${item.name}`}
                        className={`${LINK_BTN} text-[hsl(var(--destructive))]`}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SpeciesSection() {
  const queryClient = useQueryClient();

  const { data: species = [], isLoading: speciesLoading } = useQuery<NamedRow[]>({
    queryKey: ["settings-species"],
    queryFn: fetchSpecies,
  });

  const { data: breedRows = [], isLoading: breedsLoading } = useQuery<BreedRow[]>({
    queryKey: ["settings-breeds"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("breeds").select("id, name, species_id")
        .order("sort_order").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<{ kind: "species" | "breed"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selected = species.find((s) => s.id === selectedId) ?? species[0] ?? null;
  const breeds = selected ? breedRows.filter((b) => b.species_id === selected.id) : [];
  const counts: Record<string, number> = {};
  breedRows.forEach((b) => { counts[b.species_id] = (counts[b.species_id] || 0) + 1; });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["settings-species"] });
    queryClient.invalidateQueries({ queryKey: ["settings-breeds"] });
  };

  const taken = (list: NamedRow[], name: string, exceptId?: string) =>
    list.some((x) => x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase());

  const addSpecies = async (raw: string) => {
    const name = raw.trim();
    if (!name) return false;
    if (taken(species, name)) { toast.error(`"${name}" already exists.`); return false; }
    const { error } = await (supabase as any).from("categories").insert([{ name, type: "species" }]);
    if (error) {
      toast.error(error.code === "23505" ? `"${name}" already exists.` : "Couldn't add that species.");
      return false;
    }
    toast.success(`"${name}" added.`);
    invalidate();
    return true;
  };

  const renameSpecies = async (id: string, raw: string) => {
    const name = raw.trim();
    if (taken(species, name, id)) { toast.error(`"${name}" already exists.`); return false; }
    const { error } = await (supabase as any).from("categories").update({ name }).eq("id", id);
    if (error) {
      toast.error(error.code === "23505" ? `"${name}" already exists.` : "Couldn't rename that species.");
      return false;
    }
    toast.success("Species renamed.");
    invalidate();
    return true;
  };

  const addBreed = async (raw: string) => {
    const name = raw.trim();
    if (!name || !selected) return false;
    if (taken(breeds, name)) { toast.error(`"${name}" already exists for ${selected.name}.`); return false; }
    const { error } = await (supabase as any).from("breeds").insert([{ name, species_id: selected.id }]);
    if (error) {
      toast.error(error.code === "23505" ? `"${name}" already exists for ${selected.name}.` : "Couldn't add that breed.");
      return false;
    }
    toast.success(`"${name}" added.`);
    invalidate();
    return true;
  };

  const renameBreed = async (id: string, raw: string) => {
    const name = raw.trim();
    if (taken(breeds, name, id)) { toast.error(`"${name}" already exists.`); return false; }
    const { error } = await (supabase as any).from("breeds").update({ name }).eq("id", id);
    if (error) {
      toast.error(error.code === "23505" ? `"${name}" already exists.` : "Couldn't rename that breed.");
      return false;
    }
    toast.success("Breed renamed.");
    invalidate();
    return true;
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const table = pendingDelete.kind === "species" ? "categories" : "breeds";
    const { error } = await (supabase as any).from(table).delete().eq("id", pendingDelete.id);
    setDeleting(false);
    if (error) {
      toast.error(`Couldn't delete ${pendingDelete.kind === "species" ? "that species" : "that breed"}.`);
      return;
    }
    toast.success(`"${pendingDelete.name}" removed.`);
    setPendingDelete(null);
    invalidate();
  };

  const deleteBreedCount = pendingDelete?.kind === "species" ? (counts[pendingDelete.id] ?? 0) : 0;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(340px,5fr)_minmax(0,7fr)] lg:items-start">
        <ManagedList
          title="Species"
          subtitle="Offered when a pet is registered."
          headerNote={`${species.length} species`}
          items={species}
          loading={speciesLoading}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          counts={counts}
          placeholder="New species"
          emptyText="No species yet. Add the first one above."
          onAdd={addSpecies}
          onRename={renameSpecies}
          onDelete={(item) => setPendingDelete({ kind: "species", id: item.id, name: item.name })}
        />

        {selected ? (
          <ManagedList
            key={selected.id}
            title={`${selected.name} breeds`}
            headerNote={breedCount(breeds.length)}
            columns
            subtitle={`Offered after ${selected.name} is chosen. Breed is optional for owners.`}
            items={breeds}
            loading={breedsLoading}
            placeholder={`New ${selected.name.toLowerCase()} breed`}
            emptyText={`No breeds for ${selected.name} yet. Add the first one above.`}
            onAdd={addBreed}
            onRename={renameBreed}
            onDelete={(item) => setPendingDelete({ kind: "breed", id: item.id, name: item.name })}
          />
        ) : (
          <div className={`${CARD} p-5`}>
            <p className="py-8 text-center text-[14px] text-[hsl(var(--muted-foreground))]">
              Add a species first, then its breeds appear here.
            </p>
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sidebar text-lg font-bold">
              Delete this {pendingDelete?.kind}?
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              <span className="font-semibold text-[hsl(var(--foreground))]">{pendingDelete?.name}</span> won&apos;t
              be offered when registering a pet anymore
              {deleteBreedCount > 0
                ? `, and its ${deleteBreedCount} breed${deleteBreedCount === 1 ? "" : "s"} ${deleteBreedCount === 1 ? "goes" : "go"} with it`
                : ""}
              . Pets already registered keep their species and breed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary))]">Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
              disabled={deleting}
              className="h-12 rounded-full bg-[hsl(var(--destructive))] px-6 text-[16px] font-bold text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}