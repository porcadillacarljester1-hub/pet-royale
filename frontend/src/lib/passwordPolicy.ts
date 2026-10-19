/* One password rule for every place staff set a password, so the
   screens can't drift apart. Put this at src/lib/passwordPolicy.ts.

   The rule:
   - 12 to 72 characters. 72 is the most the auth system actually uses;
     anything past it is silently ignored, so a longer one would look
     stronger than it is.
   - at least one uppercase letter, one lowercase letter, one number and
     one symbol. A symbol is an ASCII punctuation character
     (! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ ` { | } ~).
     Accented letters such as é and ñ, and spaces, are NOT symbols. The
     old test (anything that isn't a letter, a number or a space) let
     "Pañuelo1234" through with no real symbol, and Supabase Auth's own
     "symbols" requirement would then reject it with a confusing message.

   The edge function manage-staff carries its own copy of this check
   (Deno can't import from src), so change SYMBOL_RE there too. It is the
   copy that actually enforces the rule for accounts an administrator
   creates or resets; this one gives the person a clear message before
   the request is sent.

   Checking in the browser alone stops nobody who calls the API
   directly. For passwords people set themselves, the enforcement that
   covers every path is Supabase Auth's own setting: Authentication →
   Sign In / Providers → Password requirements (minimum length 12, and
   require lowercase, uppercase, digits and symbols). */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72;

export const PASSWORD_HINT =
  "At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.";

export const SYMBOL_RE = /[!-\/:-@\[-`{-~]/;

/* The checklist. The same list drives the live ticks beside the field and
   the sentence passwordProblem() returns, so they can't disagree. */
export const PASSWORD_RULES: { id: string; label: string; test: (pw: string) => boolean }[] = [
  { id: "length", label: "At least 12 characters", test: (pw) => pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX },
  { id: "upper", label: "One uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { id: "lower", label: "One lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { id: "number", label: "One number", test: (pw) => /[0-9]/.test(pw) },
  { id: "symbol", label: "One symbol, like ! or @", test: (pw) => SYMBOL_RE.test(pw) },
];

export const passwordMeetsRules = (pw: string) => PASSWORD_RULES.every((r) => r.test(pw));

const list = (items: string[]) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/* null means the password is acceptable; otherwise a sentence that says
   what's missing. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Password can't be longer than ${PASSWORD_MAX} characters.`;

  const missing: string[] = [];
  if (!/[A-Z]/.test(pw)) missing.push("an uppercase letter");
  if (!/[a-z]/.test(pw)) missing.push("a lowercase letter");
  if (!/[0-9]/.test(pw)) missing.push("a number");
  if (!SYMBOL_RE.test(pw)) missing.push("a symbol (like ! or @)");

  return missing.length ? `Password needs ${list(missing)}.` : null;
}