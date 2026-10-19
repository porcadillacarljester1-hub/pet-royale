import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStore } from "@/store/adminStore";
import { ThemeStyles } from "@/components/AdminLayout";
import { PASSWORD_MAX, PASSWORD_RULES, passwordMeetsRules, passwordProblem } from "@/lib/passwordPolicy";
import { Check, Eye, EyeOff, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

/* Shown instead of the app while a new account is still on the
   temporary password the clinic gave it. The rules come from
   lib/passwordPolicy, the same list the rest of the app uses, so the
   checklist here and the message on a failed save can't disagree. */

/* Floating-label field, same as FloatInput on the Appointments screen:
   the label sits inside the field and moves up once it has focus or a
   value. Pure CSS — `placeholder=" "` lets `placeholder-shown` tell an
   empty field from a filled one, so there is no state to keep in sync.
   `right` holds a small control such as the show-password eye. */
function FloatField({
  id, label, error, right, ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: boolean;
  right?: ReactNode;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        placeholder=" "
        aria-invalid={error || undefined}
        {...input}
        className={
          "peer h-[52px] w-full rounded-[16px] border-[1.5px] bg-[hsl(var(--card))] pb-0 pl-4 pt-[18px] text-[16px] font-medium " +
          "text-[hsl(var(--foreground))] outline-none transition focus:outline-none focus:!shadow-none " +
          "focus:border-[hsl(var(--primary))] disabled:opacity-50 " +
          (right ? "pr-12 " : "pr-4 ") +
          (error ? "border-[hsl(var(--destructive))]" : "border-[hsl(var(--input))]")
        }
      />
      <label
        htmlFor={id}
        className={
          "pointer-events-none absolute left-4 top-1.5 text-[12px] font-medium leading-4 text-[hsl(var(--muted-foreground))] transition-all " +
          "peer-placeholder-shown:top-[14px] peer-placeholder-shown:text-[16px] peer-placeholder-shown:font-normal peer-placeholder-shown:leading-6 " +
          "peer-focus:top-1.5 peer-focus:text-[12px] peer-focus:font-medium peer-focus:leading-4"
        }
      >
        {label}
      </label>
      {right}
    </div>
  );
}

function EyeButton({ shown, onClick, disabled }: { shown: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={shown ? "Hide password" : "Show password"}
      aria-pressed={shown}
      className="absolute right-1.5 top-1.5 flex h-10 w-10 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40"
    >
      {shown ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
}

export default function ForcePasswordChange() {
  const fullName = useAdminStore((s) => s.fullName);
  const logout = useAdminStore((s) => s.logout);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the password itself is saved, a retry only has to clear the
  // flag. Saving the same password again would be refused.
  const [passwordSaved, setPasswordSaved] = useState(false);

  const rulesOk = passwordMeetsRules(password);
  const mismatch = !passwordSaved && confirm.length > 0 && password !== confirm;
  const shownError = error ?? (mismatch ? "Those passwords don't match." : null);

  const finish = async () => {
    const { error: flagError } = await (supabase as any).rpc("complete_password_change");
    if (flagError) {
      setError("Your password was changed, but we couldn't finish setup. Please try again.");
      return;
    }
    useAdminStore.setState({ mustChangePassword: false });
    toast.success("Password set. Welcome!");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!passwordSaved) {
      const problem = passwordProblem(password);
      if (!rulesOk || problem) { setError(problem || "That password doesn't meet all the requirements."); return; }
      if (password !== confirm) { setError("Those passwords don't match."); return; }
    }

    setSaving(true);
    try {
      if (!passwordSaved) {
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) { setError(updateError.message); return; }
        setPasswordSaved(true);
      }
      await finish();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-[hsl(var(--background))] px-5 py-8">
      <ThemeStyles />
      <div className="w-full max-w-[440px] rounded-[28px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-6 shadow-[0_24px_60px_-30px_rgb(5_31_66/.35)]">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
            <KeyRound size={20} className="text-[hsl(var(--primary))]" />
          </span>
          <h1 className="min-w-0 text-[24px] font-bold leading-[30px] tracking-[-.02em]">
            Set your own password
          </h1>
        </div>
        <p className="mb-5 mt-3 text-[15px] leading-[22px] text-[hsl(var(--muted-foreground))]">
          {fullName ? <>Welcome, <span className="font-medium text-[hsl(var(--foreground))]">{fullName}</span>. </> : "Welcome. "}
          The password you were given is temporary. Choose one only you know before you continue.
        </p>

        <form onSubmit={handleSubmit}>
          <FloatField
            id="fp-new"
            label="New password"
            type={showNew ? "text" : "password"}
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={password}
            disabled={passwordSaved}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            autoFocus
            right={<EyeButton shown={showNew} onClick={() => setShowNew((v) => !v)} disabled={passwordSaved} />}
          />

          <ul className="mb-3 mt-2 px-2" aria-label="Password requirements" aria-live="polite">
            {PASSWORD_RULES.map((r) => {
              const ok = r.test(password);
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

          <FloatField
            id="fp-confirm"
            label="Confirm password"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={confirm}
            disabled={passwordSaved}
            onChange={(e) => { setConfirm(e.target.value); setError(null); }}
            error={mismatch}
            right={<EyeButton shown={showConfirm} onClick={() => setShowConfirm((v) => !v)} disabled={passwordSaved} />}
          />

          {/* Fixed height, so a message appearing doesn't move the button. */}
          <div className="min-h-[44px] pt-2.5">
            {shownError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl bg-[hsl(var(--destructive)/.12)] px-3 py-2"
              >
                <TriangleAlert size={15} className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]" />
                <p className="text-[13px] font-medium leading-snug text-[hsl(var(--destructive))]">{shownError}</p>
              </div>
            )}
          </div>

          {/* One footer row, like the other dialogs: the way out on the
              left, the main action on the right. */}
          <div className="mt-1 flex items-center justify-between gap-3">
            {/* Outline button in the destructive colour, like Delete. */}
            <button
              type="button"
              onClick={() => void logout()}
              className="h-12 rounded-full border-[1.5px] border-[hsl(var(--destructive))] px-6 text-[16px] font-bold text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.06)]"
            >
              Sign out
            </button>
            <button
              type="submit"
              disabled={saving || (!passwordSaved && (!rulesOk || !confirm || mismatch))}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)] transition active:scale-[.98] disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none"
            >
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                : passwordSaved ? "Finish setup" : "Save and continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
