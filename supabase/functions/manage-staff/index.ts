// supabase/functions/manage-staff/index.ts
//
// Single admin-only endpoint for every staff-account lifecycle action:
// create, reset password, suspend, reactivate, change role, delete.
// Runs with the service role key — never expose that key to the client.
// The caller's identity is verified from their JWT on every request; the
// client never gets to assert its own role, and every mutation to the
// staff table happens ONLY through this function (see
// 003_status_simplification.sql for why direct client updates are blocked).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action = "create" | "reset_password" | "suspend" | "reactivate" | "change_role" | "update_job_title" | "delete";

/* ── Who can do what ─────────────────────────────────────────────────
   Two tiers sit above a normal administrator. Both are read fresh from
   the database on every call — never from anything the client sends.

   - Super admin: an account marked `protected` (migration 038).
   - Clinic Owner: an account whose job title is "Clinic Owner". That's
     a job title, not a role — role stays admin | staff.

   Normal administrators: their role and job title are fixed. They can
   add staff accounts, but not administrators, and cannot suspend,
   restore or delete administrator accounts.

   Clinic Owner or super admin: can change the role and job title of
   accounts that aren't a Clinic Owner, and create administrator
   accounts.

   A Clinic Owner's own role and job title are FIXED — for everyone,
   including another owner and a super admin. Without that, one owner
   could strip another's title and then suspend or delete them, which
   is exactly what the rule below is meant to prevent. Because the role
   can't change afterward, the title can only be given to an
   administrator, and only by a super admin: it's permanent and it
   carries authority, so it's the one appointment that isn't left to
   the owners themselves.

   Suspending, restoring or deleting a Clinic Owner's account is for a
   super admin only — restoring is included because otherwise a
   suspension could be undone by anyone.

   Passwords are separate and simpler: everyone can reset their own,
   whatever their role or job title — after proving they know the
   current one — and only a super admin can reset anyone else's.
   Resetting someone's password lets you sign in as them, so it isn't
   left to peers or to a Clinic Owner. */

/* "Clinic Owner" is recognised by its letters alone: case, spaces,
   hyphens and other punctuation are ignored, so "Clinic  Owner",
   "ClinicOwner" and "Clinic-Owner." all count. Comparing the exact text
   would let a Clinic Owner give someone a title that reads as "Clinic
   Owner" on screen but isn't recognised as one — an owner recruiting an
   owner in everything but name. */
const isClinicOwnerTitle = (t?: string | null) =>
  (t ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "") === "clinicowner";

/* Job titles are plain printable ASCII, up to 60 characters. Anything
   else — zero-width spaces, Cyrillic letters that look like Latin ones —
   can be made to read as "Clinic Owner" without being spelled that way,
   and no title the clinic uses needs them. */
function jobTitleProblem(t?: string | null): string | null {
  const v = (t ?? "").trim();
  if (!v) return null;
  if (v.length > 60) return "Job title can be at most 60 characters";
  if (!/^[\x20-\x7E]+$/.test(v)) return "Job title can only use letters, numbers and standard punctuation";
  return null;
}

/* What gets stored: spaces tidied, and any spelling of the owner title
   saved in its one canonical form. Empty means none. */
function cleanJobTitle(t?: string | null): string | null {
  const v = (t ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  return isClinicOwnerTitle(v) ? "Clinic Owner" : v;
}

const isValidRole = (r: unknown): r is "admin" | "staff" => r === "admin" || r === "staff";

// The salutation before a name: the same four options as the Add Staff
// form and the self-service profile edit (update_my_staff_profile).
const SALUTATIONS = ["Dr.", "Mr.", "Ms.", "Mrs."];

/* Checks a password by actually signing in with it, on a throwaway
   client that keeps nothing. The session that opens is ended straight
   away — with scope "local", so only this one goes and the person's own
   real sessions are left alone (the default scope would sign them out
   everywhere). */
async function verifyPassword(email: string, password: string): Promise<boolean> {
  const probe = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await probe.auth.signOut({ scope: "local" });
  return true;
}

async function loadCaller(admin: SupabaseClient, callerId: string) {
  const { data } = await admin
    .from("staff")
    .select("protected, job_title")
    .eq("user_id", callerId)
    .maybeSingle();
  const isSuperAdmin = data?.protected === true;
  return { isSuperAdmin, canManageRoles: isSuperAdmin || isClinicOwnerTitle(data?.job_title) };
}

/* Same rule as src/lib/passwordPolicy.ts — change both together. This
   copy is the one that enforces it for accounts created or reset here:
   12 to 72 characters with an uppercase letter, a lowercase letter, a
   number and a symbol. Returns null when acceptable, otherwise what's
   missing. */
function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters";
  if (pw.length > 72) return "Password can't be longer than 72 characters";
  const missing: string[] = [];
  if (!/[A-Z]/.test(pw)) missing.push("an uppercase letter");
  if (!/[a-z]/.test(pw)) missing.push("a lowercase letter");
  if (!/[0-9]/.test(pw)) missing.push("a number");
  if (!/[^A-Za-z0-9\s]/.test(pw)) missing.push("a symbol (like ! or @)");
  if (!missing.length) return null;
  const last = missing.pop()!;
  return `Password needs ${missing.length ? missing.join(", ") + " and " : ""}${last}`;
}

interface RequestBody {
  action: Action;
  email?: string;
  full_name?: string;
  password?: string;
  role?: "admin" | "staff";
  // Neither existed here before — the client (Staff Management) has
  // been sending them on "create" for a while, but this function
  // never declared or read them, so every account created since then
  // silently got no title or job_title stored, regardless of what was
  // typed in the form.
  title?: string | null;
  job_title?: string | null;
  staff_id?: string;
  new_role?: "admin" | "staff";
  new_password?: string;
  // Required when resetting your own password — see handleResetPassword.
  current_password?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("ANON_KEY")!;

    // Scoped to the caller's own JWT — used only to verify who they are.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return json({ error: "Invalid session" }, 401);
    }
    const callerId = callerData.user.id;

    // Bypasses RLS — used for every actual read/write below. Never handed
    // to the client, never returned in any response.
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Confirm the caller is an active admin. The client's own claims about
    // its role are never trusted for this check.
    const { data: callerStaff, error: callerStaffError } = await admin
      .from("staff")
      .select("role, status")
      .eq("user_id", callerId)
      .maybeSingle();

    if (callerStaffError || !callerStaff || callerStaff.role !== "admin" || callerStaff.status !== "active") {
      return json({ error: "Admin privileges required" }, 403);
    }

    const body: RequestBody = await req.json();

    switch (body.action) {
      case "create":
        return await handleCreate(admin, callerId, body);
      case "reset_password":
        return await handleResetPassword(admin, callerId, body);
      case "suspend":
        return await handleSuspend(admin, callerId, body);
      case "reactivate":
        return await handleReactivate(admin, callerId, body);
      case "change_role":
        return await handleChangeRole(admin, callerId, body);
      case "update_job_title":
        return await handleUpdateJobTitle(admin, callerId, body);
      case "delete":
        return await handleDelete(admin, callerId, body);
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected server error" }, 500);
  }
});

async function handleCreate(admin: SupabaseClient, callerId: string, body: RequestBody) {
  if (!body.email || !body.full_name || !body.role || !body.password) {
    return json({ error: "email, full_name, role, and password are required" }, 400);
  }

  const pwProblem = passwordProblem(body.password);
  if (pwProblem) {
    return json({ error: pwProblem }, 400);
  }

  if (!isValidRole(body.role)) {
    return json({ error: "Role must be admin or staff" }, 400);
  }

  // Free text here would let an account display as "Clinic Owner Jane
  // Cruz" in Staff Management and the top bar. Authority never came
  // from this field, but the display is what people trust.
  const title = (body.title ?? "").trim() || null;
  if (title && !SALUTATIONS.includes(title)) {
    return json({ error: "Title must be Dr., Mr., Ms. or Mrs." }, 400);
  }

  const jobTitleError = jobTitleProblem(body.job_title);
  if (jobTitleError) {
    return json({ error: jobTitleError }, 400);
  }

  // A normal administrator can add staff, but can't hand out an
  // administrator role. The Clinic Owner title is a super admin's alone
  // to give, and only to an administrator, since an owner's role can't
  // change afterward.
  const caller = await loadCaller(admin, callerId);
  if (!caller.canManageRoles && body.role === "admin") {
    return json({ error: "Only the Clinic Owner can create administrator accounts" }, 403);
  }
  if (isClinicOwnerTitle(body.job_title)) {
    if (!caller.isSuperAdmin) {
      return json({ error: "Only a super admin can assign the Clinic Owner job title" }, 403);
    }
    if (body.role !== "admin") {
      return json({ error: "A Clinic Owner must be an administrator" }, 400);
    }
  }

  // Prevent creating a duplicate account for an email that's already staff.
  const { data: existingStaff } = await admin
    .from("staff")
    .select("id")
    .eq("email", body.email)
    .maybeSingle();
  if (existingStaff) {
    return json({ error: "A staff record with this email already exists." }, 400);
  }

  // createUser with email_confirm: true creates a ready-to-use account
  // immediately — no confirmation email, no invite link, no token to
  // expire. The staff member signs in with the password the admin set
  // and can change it themselves later via the forgot-password flow.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    // Tags this as a staff account so the handle_new_user() trigger on
    // auth.users skips creating a public.clients row for it — without
    // this, every staff account also becomes a phantom "client".
    // See 005_fix_staff_client_trigger.sql.
    user_metadata: { account_type: "staff", full_name: body.full_name },
  });

  if (createError || !created.user) {
    return json({ error: createError?.message ?? "Failed to create account" }, 400);
  }

  const { data: staffRow, error: staffError } = await admin
    .from("staff")
    .insert({
      user_id: created.user.id,
      full_name: body.full_name,
      email: body.email,
      role: body.role,
      status: "active",
      invited_by: callerId,
      // Both genuinely new — accepted in the request body but never
      // actually written to the row until now, which is why every
      // account created since Staff Management started sending these
      // has shown "—" for job title regardless of what was selected.
      title,
      job_title: cleanJobTitle(body.job_title),
    })
    .select()
    .single();

  if (staffError) {
    // Roll back the auth account we just created — otherwise it's an
    // orphan that permanently blocks this email from being used again.
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: staffError.message }, 400);
  }

  await logAudit(admin, callerId, "staff_created", staffRow.id, "staff", { email: body.email, role: body.role });

  return json({ success: true, staff: staffRow });
}

async function handleResetPassword(admin: SupabaseClient, callerId: string, body: RequestBody) {
  if (!body.staff_id || !body.new_password) {
    return json({ error: "staff_id and new_password are required" }, 400);
  }

  const pwProblem = passwordProblem(body.new_password);
  if (pwProblem) {
    return json({ error: pwProblem }, 400);
  }

  const { data: target } = await admin.from("staff").select("*").eq("id", body.staff_id).single();
  if (!target) return json({ error: "Staff member not found" }, 404);
  if (!target.user_id) return json({ error: "This staff record has no linked account" }, 400);

  // One rule for every account: you can reset your own password,
  // whatever your role or job title, and only a super admin can reset
  // anyone else's. A reset is a full, silent takeover — whoever sets the
  // password can sign in as that person and act under their name — so
  // it isn't left to peers, or even to a Clinic Owner.
  const isSelf = target.user_id === callerId;
  if (!isSelf && !(await loadCaller(admin, callerId)).isSuperAdmin) {
    return json({ error: "You can only reset your own password. Only a super admin can reset someone else's" }, 403);
  }

  // A protected account's password is its own to change — a second
  // protected account included.
  if (target.protected && !isSelf) {
    return json({ error: "This account is protected and its password cannot be reset by another admin" }, 400);
  }

  // Changing your own password means proving you know the current one.
  // Without that, a signed-in screen left unlocked is enough to take the
  // account over. A super admin resetting someone else's doesn't need it
  // — they can't know it, and that's the point of the reset.
  if (isSelf) {
    if (!body.current_password) {
      return json({ error: "Enter your current password" }, 400);
    }
    if (body.current_password === body.new_password) {
      return json({ error: "Choose a password different from your current one" }, 400);
    }
    // The sign-in email, read from the auth system itself rather than
    // the staff row, so this checks the real credentials.
    const { data: authUser } = await admin.auth.admin.getUserById(target.user_id);
    const signInEmail = authUser?.user?.email;
    if (!signInEmail || !(await verifyPassword(signInEmail, body.current_password))) {
      return json({ error: "Your current password is incorrect" }, 400);
    }
  }

  // Sets the password directly, so it doesn't depend on email delivery
  // working.
  const { error } = await admin.auth.admin.updateUserById(target.user_id, {
    password: body.new_password,
  });
  if (error) return json({ error: error.message }, 400);

  await logAudit(admin, callerId, "staff_password_reset", body.staff_id, "staff", { email: target.email });

  return json({ success: true });
}

async function handleSuspend(admin: SupabaseClient, callerId: string, body: RequestBody) {
  if (!body.staff_id) return json({ error: "staff_id is required" }, 400);

  const { data: target } = await admin.from("staff").select("*").eq("id", body.staff_id).single();
  if (!target) return json({ error: "Staff member not found" }, 404);

  if (target.user_id === callerId) {
    return json({ error: "You cannot suspend your own account" }, 400);
  }

  // A protected account is fully visible like any other — this only
  // blocks other admins from acting on it, not the account itself.
  // The check above already covers "acting on itself"; this covers
  // everyone else.
  if (target.protected) {
    return json({ error: "This account is protected and cannot be suspended by another admin" }, 400);
  }

  const caller = await loadCaller(admin, callerId);
  if (target.role === "admin" && !caller.canManageRoles) {
    return json({ error: "Only the Clinic Owner can manage administrator accounts" }, 403);
  }

  if (isClinicOwnerTitle(target.job_title) && !caller.isSuperAdmin) {
    return json({ error: "Only a super admin can suspend a Clinic Owner account" }, 403);
  }

  if (target.role === "admin") {
    const { count } = await admin
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("status", "active");
    if ((count ?? 0) <= 1) {
      return json({ error: "Cannot suspend the last active admin" }, 400);
    }
  }

  const { error } = await admin.from("staff").update({ status: "suspended" }).eq("id", body.staff_id);
  if (error) return json({ error: error.message }, 400);

  // Kill any session they already have open, not just block future logins.
  if (target.user_id) {
    await admin.auth.admin.signOut(target.user_id, "global");
  }

  await logAudit(admin, callerId, "staff_suspended", body.staff_id, "staff", { email: target.email });

  return json({ success: true });
}

async function handleReactivate(admin: SupabaseClient, callerId: string, body: RequestBody) {
  if (!body.staff_id) return json({ error: "staff_id is required" }, 400);

  const { data: target } = await admin.from("staff").select("*").eq("id", body.staff_id).single();
  if (!target) return json({ error: "Staff member not found" }, 404);

  const caller = await loadCaller(admin, callerId);
  if (target.protected && target.user_id !== callerId && !caller.isSuperAdmin) {
    return json({ error: "This account is protected and cannot be restored by another admin" }, 403);
  }

  if (target.role === "admin" && !caller.canManageRoles) {
    return json({ error: "Only the Clinic Owner can manage administrator accounts" }, 403);
  }

  // Otherwise a super admin's suspension of a Clinic Owner could be
  // undone by any administrator.
  if (isClinicOwnerTitle(target.job_title) && !caller.isSuperAdmin) {
    return json({ error: "Only a super admin can restore a Clinic Owner account" }, 403);
  }

  const { error } = await admin.from("staff").update({ status: "active" }).eq("id", body.staff_id);
  if (error) return json({ error: error.message }, 400);

  await logAudit(admin, callerId, "staff_reactivated", body.staff_id, "staff", {});

  return json({ success: true });
}

async function handleChangeRole(admin: SupabaseClient, callerId: string, body: RequestBody) {
  if (!body.staff_id || !body.new_role) {
    return json({ error: "staff_id and new_role are required" }, 400);
  }

  if (!isValidRole(body.new_role)) {
    return json({ error: "Role must be admin or staff" }, 400);
  }

  // A normal administrator's role, and everyone else's, is fixed.
  if (!(await loadCaller(admin, callerId)).canManageRoles) {
    return json({ error: "Only the Clinic Owner can change roles" }, 403);
  }

  const { data: target } = await admin.from("staff").select("*").eq("id", body.staff_id).single();
  if (!target) return json({ error: "Staff member not found" }, 404);

  // Same protection as handleSuspend and handleDelete — a protected
  // account can't be demoted (or promoted) by anyone but itself.
  if (target.protected && target.user_id !== callerId) {
    return json({ error: "This account is protected and its role cannot be changed by another admin" }, 400);
  }

  // A Clinic Owner's role is fixed — for everyone, another owner and a
  // super admin included. To remove an owner from the clinic, a super
  // admin suspends or deletes the account.
  if (isClinicOwnerTitle(target.job_title)) {
    return json({ error: "A Clinic Owner's role is fixed and can't be changed" }, 403);
  }

  if (target.role === "admin" && body.new_role === "staff") {
    const { count } = await admin
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("status", "active");
    if ((count ?? 0) <= 1) {
      return json({ error: "Cannot demote the last active admin" }, 400);
    }
  }

  const { error } = await admin.from("staff").update({ role: body.new_role }).eq("id", body.staff_id);
  if (error) return json({ error: error.message }, 400);

  await logAudit(admin, callerId, "staff_role_changed", body.staff_id, "staff", { new_role: body.new_role });

  return json({ success: true });
}

// A job title is descriptive, with one exception: "Clinic Owner" decides
// who may change roles and job titles and whose account only a super
// admin may suspend or delete (see isClinicOwnerTitle above). That's why
// other titles can only be changed by a Clinic Owner or super admin, why
// the Clinic Owner title itself is fixed once given, and why only a super
// admin can give it. There's no admin-count check here, since a title
// never changes anyone's role.
async function handleUpdateJobTitle(admin: SupabaseClient, callerId: string, body: RequestBody) {
  if (!body.staff_id) {
    return json({ error: "staff_id is required" }, 400);
  }

  // A normal administrator's job title, and everyone else's, is fixed.
  const caller = await loadCaller(admin, callerId);
  if (!caller.canManageRoles) {
    return json({ error: "Only the Clinic Owner can change job titles" }, 403);
  }

  const jobTitleError = jobTitleProblem(body.job_title);
  if (jobTitleError) {
    return json({ error: jobTitleError }, 400);
  }

  const { data: target } = await admin.from("staff").select("*").eq("id", body.staff_id).single();
  if (!target) return json({ error: "Staff member not found" }, 404);

  // Missed when this action was first added — job title carries no
  // permission, but a protected account's row shows a fixed "Developer"
  // label specifically because job title isn't meant to describe it at
  // all. Letting another admin still set one anyway defeats that,
  // even without touching role or status. Same shape as the other
  // three checks: blocked for everyone but the account itself.
  if (target.protected && target.user_id !== callerId) {
    return json({ error: "This account is protected and its job title cannot be changed by another admin" }, 400);
  }

  // A Clinic Owner's job title is fixed — for everyone, another owner
  // and a super admin included. Otherwise one owner could strip
  // another's title and then suspend or delete them.
  if (isClinicOwnerTitle(target.job_title)) {
    return json({ error: "A Clinic Owner's job title is fixed and can't be changed" }, 403);
  }

  // Giving someone the title is a super admin's decision, and only for
  // an administrator: their role can't change once they're an owner, so
  // a staff account made an owner would be stuck as one.
  if (isClinicOwnerTitle(body.job_title)) {
    if (!caller.isSuperAdmin) {
      return json({ error: "Only a super admin can assign the Clinic Owner job title" }, 403);
    }
    if (target.role !== "admin") {
      return json({ error: "A Clinic Owner must be an administrator — make them one first" }, 400);
    }
  }

  const { error } = await admin
    .from("staff")
    .update({ job_title: cleanJobTitle(body.job_title) })
    .eq("id", body.staff_id);
  if (error) return json({ error: error.message }, 400);

  await logAudit(admin, callerId, "staff_job_title_updated", body.staff_id, "staff", { job_title: cleanJobTitle(body.job_title) });

  return json({ success: true });
}

async function logAudit(
  admin: SupabaseClient,
  actorId: string,
  action: string,
  targetId: string,
  targetType: string,
  metadata: Record<string, unknown>,
) {
  await admin.from("audit_log").insert({ actor_id: actorId, action, target_id: targetId, target_type: targetType, metadata });
}

async function handleDelete(admin: SupabaseClient, callerId: string, body: RequestBody) {
  if (!body.staff_id) return json({ error: "staff_id is required" }, 400);

  const { data: target } = await admin.from("staff").select("*").eq("id", body.staff_id).single();
  if (!target) return json({ error: "Staff member not found" }, 404);

  if (target.user_id === callerId) {
    return json({ error: "You cannot delete your own account" }, 400);
  }

  if (target.protected) {
    return json({ error: "This account is protected and cannot be deleted by another admin" }, 400);
  }

  const caller = await loadCaller(admin, callerId);
  if (target.role === "admin" && !caller.canManageRoles) {
    return json({ error: "Only the Clinic Owner can manage administrator accounts" }, 403);
  }

  if (isClinicOwnerTitle(target.job_title) && !caller.isSuperAdmin) {
    return json({ error: "Only a super admin can delete a Clinic Owner account" }, 403);
  }

  if (target.role === "admin") {
    const { count } = await admin
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("status", "active");
    if ((count ?? 0) <= 1) {
      return json({ error: "Cannot delete the last active admin" }, 400);
    }
  }

  // Log before removing — the target row won't exist to reference afterward.
  await logAudit(admin, callerId, "staff_deleted", body.staff_id, "staff", {
    email: target.email,
    full_name: target.full_name,
  });

  if (target.user_id) {
    // Deleting the auth user cascades to the staff row automatically —
    // staff.user_id references auth.users(id) on delete cascade.
    const { error } = await admin.auth.admin.deleteUser(target.user_id);
    if (error) return json({ error: error.message }, 400);
  } else {
    // No linked auth account (shouldn't normally happen post-invite) —
    // remove the staff row directly.
    const { error } = await admin.from("staff").delete().eq("id", body.staff_id);
    if (error) return json({ error: error.message }, 400);
  }

  return json({ success: true });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}