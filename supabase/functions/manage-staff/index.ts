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

type Action = "create" | "reset_password" | "suspend" | "reactivate" | "change_role" | "delete";

interface RequestBody {
  action: Action;
  email?: string;
  full_name?: string;
  password?: string;
  role?: "admin" | "staff";
  staff_id?: string;
  new_role?: "admin" | "staff";
  new_password?: string;
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

  if (body.password.length < 12) {
    return json({ error: "Password must be at least 12 characters" }, 400);
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

  if (body.new_password.length < 12) {
    return json({ error: "Password must be at least 12 characters" }, 400);
  }

  const { data: target } = await admin.from("staff").select("*").eq("id", body.staff_id).single();
  if (!target) return json({ error: "Staff member not found" }, 404);
  if (!target.user_id) return json({ error: "This staff record has no linked account" }, 400);

  // Lets an admin set a new password for a staff member who's locked out,
  // without depending on email delivery working.
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

  const { error } = await admin.from("staff").update({ status: "active" }).eq("id", body.staff_id);
  if (error) return json({ error: error.message }, 400);

  await logAudit(admin, callerId, "staff_reactivated", body.staff_id, "staff", {});

  return json({ success: true });
}

async function handleChangeRole(admin: SupabaseClient, callerId: string, body: RequestBody) {
  if (!body.staff_id || !body.new_role) {
    return json({ error: "staff_id and new_role are required" }, 400);
  }

  const { data: target } = await admin.from("staff").select("*").eq("id", body.staff_id).single();
  if (!target) return json({ error: "Staff member not found" }, 404);

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