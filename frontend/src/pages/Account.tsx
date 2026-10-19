import { useEffect, useId, useRef, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import PhotoCropper from "@/components/PhotoCropper";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import { toast } from "sonner";
import { Loader2, Check, ChevronDown, Camera } from "lucide-react";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

const PAGE_WRAP = "mx-auto w-full max-w-[720px] space-y-5 px-5 pb-8 sm:px-8";
const CARD =
  "rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[0_1px_2px_rgb(15_36_71/.05),0_4px_16px_rgb(15_36_71/.05)]";
const BTN_OUTLINE =
  `inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:hover:bg-[hsl(var(--card))] ${FOCUS_RING}`;
const BTN_SOLID =
  `inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:hover:opacity-100 ${FOCUS_RING}`;
const HELP = "mt-1.5 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]";

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

function PickField({
  id, label, value, onChange, children,
}: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel id={id} label={label} />
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT} appearance-none pr-9 ${inputBorder()}`}
        >
          {children}
        </select>
        <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
      </div>
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

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-[14px] text-[hsl(var(--muted-foreground))]">{label}</dt>
      <dd className="break-words text-[14px] font-semibold sm:text-right">{value}</dd>
    </div>
  );
}

function SaveBar({
  isDirty, saving, canSave, onDiscard, onSave,
}: { isDirty: boolean; saving: boolean; canSave: boolean; onDiscard: () => void; onSave: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/.7)] px-6 py-3.5">
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

const BUCKET = "staff-avatars";
const TITLES = ["Dr.", "Mr.", "Ms.", "Mrs."];
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function profileError(e: any, fallback: string) {
  const msg: string = e?.message || "";
  if (e?.code === "PGRST202" || /bucket not found/i.test(msg)) {
    return "Profile updates aren't set up in the database yet. Run migration 040 first.";
  }
  return msg || fallback;
}

const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ");
const joinName = (first: string, last: string) => normalizeName(`${first} ${last}`);
function splitName(full: string) {
  const t = normalizeName(full);
  const i = t.lastIndexOf(" ");
  return i === -1 ? { first: t, last: "" } : { first: t.slice(0, i), last: t.slice(i + 1) };
}

export default function Account() {
  const queryClient = useQueryClient();
  const userId = useAdminStore((s) => s.id);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-staff-profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("staff")
        .select("full_name, email, role, title, job_title, secondary_title, protected, phone, avatar_url")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const savedTitle: string = profile?.title || "";
  const savedName: string = profile?.full_name || "";
  // Not editable on this page any more, but still sent to the RPC unchanged
  // so saving here never clears a phone number that is already stored.
  const savedPhone: string = profile?.phone || "";
  const avatarUrl: string | null = profile?.avatar_url || null;

  const [title, setTitle] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  useEffect(() => {
    const n = splitName(savedName);
    setTitle(savedTitle);
    setFirstName(n.first);
    setLastName(n.last);
  }, [savedTitle, savedName]);

  const nextFullName = joinName(firstName, lastName);
  const isDirty =
    !!profile &&
    (title !== savedTitle || nextFullName !== normalizeName(savedName));

  const discard = () => {
    const n = splitName(savedName);
    setTitle(savedTitle);
    setFirstName(n.first);
    setLastName(n.last);
  };

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["my-staff-profile", userId] }),
      queryClient.invalidateQueries({ queryKey: ["staff"] }),
    ]);
  };

  const callUpdate = (values: { name: string; title: string; phone: string; avatar: string | null }) =>
    (supabase as any).rpc("update_my_staff_profile", {
      p_full_name: values.name,
      p_title: values.title || null,
      p_phone: values.phone || null,
      p_avatar_url: values.avatar,
    });

  const handleSave = async () => {
    if (!firstName.trim()) { toast.error("Enter your first name."); return; }
    if (title === "Dr." && !/vet|doctor|surgeon|owner/i.test(profile.job_title || "")) {
      toast.error("\u201CDr.\u201D is for veterinarians. Pick a different title.");
      return;
    }
    const name = nextFullName;
    setSaving(true);
    const { error } = await callUpdate({ name, title, phone: savedPhone, avatar: avatarUrl });
    setSaving(false);
    if (error) { toast.error(profileError(error, "Couldn't save your details.")); return; }
    useAdminStore.setState({ fullName: name, title: title || null });
    toast.success("Your details were updated.");
    await refresh();
  };

  const removeStoredPhoto = (url: string | null) => {
    if (!url) return;
    const marker = `/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
    void supabase.storage.from(BUCKET).remove([path]);
  };

  const handlePhotoChosen = (file?: File) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file || !userId || !profile) return;
    if (!PHOTO_TYPES.includes(file.type)) { toast.error("Use a JPG, PNG or WebP image."); return; }
    if (file.size > PHOTO_MAX_BYTES) { toast.error("That photo is over 2 MB. Choose a smaller one."); return; }
    setCropFile(file);
  };

  const uploadPhoto = async (blob: Blob) => {
    if (!userId || !profile) return;
    setPhotoBusy(true);
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/${Date.now()}.${ext}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: blob.type, upsert: false });
      if (uploadError) throw uploadError;

      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await callUpdate({ name: savedName, title: savedTitle, phone: savedPhone, avatar: url });
      if (error) {
        void supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }

      removeStoredPhoto(avatarUrl);
      useAdminStore.getState().setAvatarUrl(url);
      toast.success("Photo updated.");
      await refresh();
    } catch (e: any) {
      toast.error(profileError(e, "Couldn't upload that photo."));
    } finally {
      setPhotoBusy(false);
      setCropFile(null);
    }
  };

  const handleRemovePhoto = async () => {
    if (!avatarUrl) return;
    setPhotoBusy(true);
    const { error } = await callUpdate({ name: savedName, title: savedTitle, phone: savedPhone, avatar: null });
    if (error) {
      setPhotoBusy(false);
      toast.error(profileError(error, "Couldn't remove your photo."));
      return;
    }
    removeStoredPhoto(avatarUrl);
    useAdminStore.setState({ avatarUrl: null });
    toast.success("Photo removed.");
    await refresh();
    setPhotoBusy(false);
  };

  if (isLoading || !userId) {
    return (
      <AdminLayout title="Manage account">
        <div className={`${CARD} flex justify-center py-16`}>
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        </div>
      </AdminLayout>
    );
  }

  if (!profile) {
    return (
      <AdminLayout title="Manage account">
        <div className={`${CARD} p-6`}>
          <p className="text-[14px] font-bold">No staff record found for this account.</p>
          <p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">
            Ask an administrator to check your account in Staff Management.
          </p>
        </div>
      </AdminLayout>
    );
  }

  const accessLabel = profile.protected
    ? "Developer"
    : profile.role === "admin"
      ? "Administrator"
      : "Staff";
  const displayName = [title, nextFullName].filter(Boolean).join(" ");

  return (
    <AdminLayout title="Manage account">
      <div className={PAGE_WRAP}>
        {/* ── Photo and identity ── */}
        <div className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[hsl(var(--primary))] bg-[hsl(43_85%_93%)]">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Your profile photo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[26px] font-extrabold text-[hsl(var(--primary))]">{initialsOf(savedName)}</span>
              )}
              {photoBusy && (
                <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--background)/.7)]">
                  <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 basis-40">
              <p className="break-words text-[18px] font-extrabold leading-6 tracking-[-.01em]">{displayName || "Your name"}</p>
              <p className="mt-0.5 text-[14px] text-[hsl(var(--muted-foreground))]">{profile.job_title || accessLabel}</p>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept={PHOTO_TYPES.join(",")}
              className="hidden"
              onChange={(e) => void handlePhotoChosen(e.target.files?.[0])}
            />
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={photoBusy}
                className={BTN_OUTLINE}
              >
                <Camera size={16} aria-hidden="true" /> {avatarUrl ? "Change photo" : "Upload photo"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  disabled={photoBusy}
                  className={`h-10 rounded-[10px] px-2 text-[14px] font-bold text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] disabled:opacity-40 ${FOCUS_RING}`}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">
            JPG, PNG or WebP, up to 2 MB. You can frame it before it saves.
          </p>
        </div>

        {/* ── Form ── */}
        <section className={CARD} aria-label="Your account">
          <div className="space-y-7 px-6 pb-6 pt-5">
            <div>
              <SectionHead>Name</SectionHead>
              <div className="grid gap-4 sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)]">
                <PickField id="account-title" label="Title" value={title} onChange={setTitle}>
                  <option value="">None</option>
                  {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
                </PickField>
                <TextField
                  label="First name"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={setFirstName}
                />
                <TextField
                  label="Last name · optional"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={setLastName}
                  aria-describedby="account-name-hint"
                />
              </div>
              <p id="account-name-hint" className={HELP}>
                Shown in Staff Management as <strong className="font-bold">{displayName || "your name"}</strong>.
              </p>
            </div>

            <div>
              <SectionHead>Sign-in and role</SectionHead>
              <dl className="divide-y divide-[hsl(var(--card-border))]">
                <ReadRow label="Email (sign-in)" value={profile.email || "—"} />
                <ReadRow label="Job title" value={profile.job_title || "Not set"} />
                <ReadRow label="Also works as" value={profile.secondary_title || "None"} />
                <ReadRow label="Access level" value={accessLabel} />
              </dl>
              <p className={HELP}>These can't be edited here. The Clinic Owner sets them in Staff Management.</p>
            </div>
          </div>

          <SaveBar isDirty={isDirty} saving={saving} canSave={isDirty && !saving} onDiscard={discard} onSave={handleSave} />
        </section>
      </div>

      <PhotoCropper
        file={cropFile}
        title="Adjust your photo"
        busy={photoBusy}
        onCancel={() => setCropFile(null)}
        onDone={uploadPhoto}
      />
    </AdminLayout>
  );
}
