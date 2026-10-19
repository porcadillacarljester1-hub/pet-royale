import { useState, type InputHTMLAttributes } from "react";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import { PASSWORD_MAX, PASSWORD_RULES, passwordProblem } from "@/lib/passwordPolicy";

/* ══════════════════ Change password ══════════════════
   Opened from the profile menu in AdminLayout. Lives in its own file so
   AdminLayout stays about the page frame.

   One show/hide state drives all three fields (there's no real reason to
   reveal one and not the others), but every field carries its own eye so
   the control is always right where you're looking. */

/* Plain labelled field: label above, input below, eye on the right. */
function PasswordField({
  id, label, error, shown, onToggle, ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: boolean;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-semibold text-[hsl(var(--foreground))]">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? "text" : "password"}
          aria-invalid={error || undefined}
          {...input}
          className={
            "h-[46px] w-full rounded-[12px] border-[1.5px] bg-[hsl(var(--card))] pl-3.5 pr-12 text-[15px] font-medium " +
            "text-[hsl(var(--foreground))] outline-none transition placeholder:font-normal placeholder:text-[hsl(var(--muted-foreground))] " +
            "focus:border-[hsl(var(--primary))] focus:outline-none focus:!shadow-none disabled:opacity-50 " +
            (error ? "border-[hsl(var(--destructive))]" : "border-[hsl(var(--input))]")
          }
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={shown ? "Hide passwords" : "Show passwords"}
          aria-pressed={shown}
          className="absolute right-0.5 top-px flex h-11 w-11 items-center justify-center rounded-[10px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]"
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}

export default function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const email = useAdminStore((s) => s.email);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setShow(false); };
  const close = () => { reset(); onClose(); };

  const rulesOk = PASSWORD_RULES.every((r) => r.test(next));
  const mismatch = confirm.length > 0 && next !== confirm;
  const same = next.length > 0 && current.length > 0 && next === current;
  const ready = !!current && rulesOk && !!confirm && !mismatch && !same;
  const message = same
    ? "The new password can't be the same as the current one."
    : mismatch
      ? "Those passwords don't match."
      : null;

  const handleSave = async () => {
    if (!current || !next || !confirm) { toast.error("Fill in every field."); return; }
    if (next !== confirm) { toast.error("Those passwords don't match."); return; }
    const pwProblem = passwordProblem(next);
    if (pwProblem) { toast.error(pwProblem); return; }
    if (next === current) { toast.error("Choose a password different from your current one."); return; }

    setSaving(true);
    // Prove it's really you first. An unlocked screen is enough to open
    // this dialog, but not to know the password it's asking for.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: email ?? "",
      password: current,
    });
    if (verifyError) {
      setSaving(false);
      toast.error("Your current password is incorrect.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    setSaving(false);

    if (error) { toast.error(error.message); return; }
    toast.success("Password updated.");
    close();
  };

  const toggle = () => setShow((v) => !v);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) close(); }}>
      <DialogContent className="!flex max-h-[94vh] max-w-[480px] flex-col gap-0 overflow-hidden rounded-[20px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-0 [&>button]:hidden">
        <div className="flex shrink-0 items-start justify-between gap-3 px-7 pt-7">
          <div className="min-w-0">
            <DialogTitle className="text-[22px] font-bold leading-7 tracking-[-.01em] text-[hsl(var(--foreground))]">
              Change password
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[14px] leading-5 text-[hsl(var(--muted-foreground))]">
              Use a password you don&apos;t use anywhere else.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label="Close"
            className="-mr-2.5 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-1 pt-6">
          <div className="flex flex-col gap-4">
            <PasswordField
              id="cp-current"
              label="Current password"
              placeholder="Enter current password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              shown={show}
              onToggle={toggle}
            />

            <div className="flex flex-col gap-2">
              <PasswordField
                id="cp-new"
                label="New password"
                placeholder="Enter new password"
                autoComplete="new-password"
                maxLength={PASSWORD_MAX}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                shown={show}
                onToggle={toggle}
              />

              {/* The rules, ticking off as they're met */}
              <ul
                className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-[12px] bg-[hsl(var(--muted))] px-3.5 py-3"
                aria-label="Password requirements"
                aria-live="polite"
              >
                {PASSWORD_RULES.map((r) => {
                  const ok = r.test(next);
                  return (
                    <li
                      key={r.id}
                      className={`flex items-center gap-2 text-[13px] leading-[18px] transition-colors ${
                        ok ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      <span
                        className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition ${
                          ok
                            ? "border-[hsl(145_42%_33%)] bg-[hsl(145_42%_33%)] text-white"
                            : "border-[hsl(var(--muted-foreground))]"
                        }`}
                        aria-hidden="true"
                      >
                        {ok && <Check size={9} strokeWidth={4} />}
                      </span>
                      {r.label}
                    </li>
                  );
                })}
              </ul>
            </div>

            <PasswordField
              id="cp-confirm"
              label="Confirm new password"
              placeholder="Re-enter new password"
              autoComplete="new-password"
              maxLength={PASSWORD_MAX}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={mismatch}
              shown={show}
              onToggle={toggle}
            />
          </div>

          {/* Fixed-height slot, so a message appearing doesn't shift the
              buttons under a cursor already moving to them. */}
          <div className="min-h-[40px] pt-2.5">
            {message && (
              <p
                role="alert"
                className="rounded-xl bg-[hsl(var(--destructive)/.12)] px-3 py-2 text-[13px] font-medium leading-snug text-[hsl(var(--destructive))]"
              >
                {message}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-3 px-7 pb-7 pt-3">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="flex h-[46px] items-center justify-center rounded-[12px] border-[1.5px] border-[hsl(var(--input))] bg-[hsl(var(--card))] px-5 text-[15px] font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !ready}
            className="flex h-[46px] items-center justify-center gap-2 rounded-[12px] bg-[hsl(var(--primary))] px-5 text-[15px] font-semibold text-[hsl(var(--primary-foreground))] transition active:scale-[.98] disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))]"
          >
            {saving
              ? <><Loader2 size={16} className="animate-spin" /> Updating…</>
              : "Update password"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
