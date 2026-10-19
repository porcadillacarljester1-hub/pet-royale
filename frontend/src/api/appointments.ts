import { supabase } from "@/integrations/supabase/client";

export interface Appointment {
  id: string;
  client_id?: string;
  client_name: string;
  pet_id?: string;
  pet_name: string;
  pet_species: string;
  // Optional, walk-in-only context — same shape as pet_name/pet_species
  // above: plain informational fields for a genuinely new pet with no
  // real pets row, not something collected for an existing, searched
  // pet (their real record already holds whatever's actually known).
  pet_age?: number | null;
  pet_gender?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  service: string;
  requested_date: string;
  scheduled_date?: string;
  scheduled_time?: string;
  status: 'incoming' | 'confirmed' | 'completed' | 'cancelled';
  assigned_staff_id?: string | null;
  // Fallback for whoever handled a visit but has no staff account —
  // a temp groomer, a new hire not yet added to Staff Management.
  // Used only when assigned_staff_id is null; the two are mutually
  // exclusive, same as client_id/client_name for a walk-in with no
  // registered account.
  assigned_staff_name?: string | null;
  assigned_staff_role?: string | null;
  created_at?: string;
  // Who at the clinic added a walk-in / accepted a request. Null for
  // anything done before these columns existed, or booked by a client
  // and not yet confirmed.
  created_by_staff_id?: string | null;
  confirmed_by_staff_id?: string | null;
  // When the visit was actually finished — set once, by
  // completeAppointment, and never touched again. Doesn't overwrite
  // scheduled_time, which stays the client's real originally booked
  // time for the life of the appointment.
  completed_at?: string;
}

export interface StaffOption {
  id: string;
  full_name: string;
  role: string;
  // "Dr." / "Mr." ... and what the person does ("Veterinarian").
  // role stays the access level (admin / staff).
  title?: string | null;
  job_title?: string | null;
  // Second job, e.g. a Clinic Owner who is also the Head Surgeon.
  secondary_title?: string | null;
  status?: string;
}

/** "Dr. Maria Santos" — how a person is named everywhere on screen. */
export const staffDisplayName = (s: { title?: string | null; full_name: string }) =>
  s.title ? `${s.title} ${s.full_name}` : s.full_name;

/* ── Client notifications ────────────────────────────────────────────
   One place that writes the notification row the mobile app shows.
   Best effort: a failure here is logged and never undoes the change
   that was just made. Walk-ins have no client account, so there is
   nobody to tell. */
const fmtNoticeDate = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

async function notifyClient(
  appt: { id: string; client_id?: string | null },
  n: { title: string; message: string; category: string }
) {
  if (!appt.client_id) return;
  try {
    const { error } = await (supabase as any).from('notifications').insert([{
      title: n.title,
      message: n.message,
      type: 'appointment',
      category: n.category,
      related_type: 'appointment',
      related_id: appt.id,
      client_user_id: appt.client_id,
      is_read: false,
    }]);
    if (error) console.error(`Failed to create ${n.category} notification:`, error);
  } catch (err) {
    console.error(`Failed to create ${n.category} notification:`, err);
  }
}

const ACTIVE = ['incoming', 'confirmed'];

/**
 * 1. FETCH ACTIVE APPOINTMENTS (list-page use)
 */
export const fetchAppointments = async (): Promise<Appointment[]> => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .neq('status', 'completed')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as Appointment[];
  } catch (err) {
    console.error("Fetch Error:", err);
    return [];
  }
};

/**
 * 1b. FETCH APPOINTMENTS IN A DATE RANGE (calendar view use)
 *
 * One request returns at most 1000 rows and says nothing when it cuts the
 * list off, so a long custom range (a year, say) would silently lose
 * appointments. The rows are read a page at a time until they are all here.
 * The order ends on id so no row is skipped or repeated between pages.
 */
export const fetchAppointmentsInRange = async (startDate: string, endDate: string): Promise<Appointment[]> => {
  const PAGE = 1000;
  const all: Appointment[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .gte('requested_date', startDate)
      .lte('requested_date', endDate)
      .order('requested_date', { ascending: true })
      .order('scheduled_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data || []) as Appointment[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
};

/**
 * 2. FETCH HISTORY
 */
export const fetchHistory = async (): Promise<Appointment[]> => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as Appointment[];
  } catch (err) {
    console.error("History Fetch Error:", err);
    return [];
  }
};

/**
 * 3. CREATE NEW APPOINTMENT
 */
export const createAppointment = async (appointment: Omit<Appointment, 'id' | 'created_at'>) => {
  const { data, error } = await supabase
    .from('appointments')
    .insert([{
      ...appointment,
      // Was '' when omitted, not null — a genuine bug, not a walk-in-
      // specific one. client_id and pet_id are UUID columns; an empty
      // string is invalid input for that type, while null correctly
      // represents "no linked record yet" for a column that allows it.
      // Every caller before the walk-in feature always had a real ID
      // to pass, so this never actually ran until now.
      client_id: appointment.client_id ?? null,
      pet_id: appointment.pet_id ?? null,
    }])
    .select()
    .single();
  if (error) {
    // The who-added columns aren't there yet (SQL not run): save the
    // walk-in anyway, without them, rather than failing.
    if ((error as any).code === '42703' || /created_by_staff_id|confirmed_by_staff_id/.test(error.message || '')) {
      const { created_by_staff_id: _a, confirmed_by_staff_id: _b, ...rest } = appointment as any;
      const retry = await supabase
        .from('appointments')
        .insert([{ ...rest, client_id: appointment.client_id ?? null, pet_id: appointment.pet_id ?? null }])
        .select()
        .single();
      if (retry.error) throw retry.error;
      return retry.data;
    }
    throw error;
  }
  return data;
};

/**
 * 4. CONFIRM APPOINTMENT — only a request that is still waiting.
 * Throws if someone else already handled it, so two staff can't both
 * act on the same request. Records who confirmed it.
 */
export const confirmAppointment = async (id: string, staffId?: string | null) => {
  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr) throw fetchErr;

  const run = (patch: Record<string, unknown>) =>
    supabase.from('appointments').update(patch as any).eq('id', id).eq('status', 'incoming').select('id');

  let res = await run({ status: 'confirmed', ...(staffId ? { confirmed_by_staff_id: staffId } : {}) });
  if (res.error && staffId &&
      ((res.error as any).code === '42703' || /confirmed_by_staff_id/.test(res.error.message || ''))) {
    res = await run({ status: 'confirmed' });
  }
  if (res.error) throw res.error;
  if (!res.data || res.data.length === 0) {
    throw new Error('This request was already handled by someone else.');
  }

  void notifyClient(appt, {
    title: 'Appointment Confirmed',
    message: `${appt.client_name}, your ${appt.service} appointment for ${appt.pet_name} on ${fmtNoticeDate(appt.requested_date)}${appt.scheduled_time ? ` at ${appt.scheduled_time}` : ''} has been confirmed.`,
    category: 'appointment_confirmed',
  });

  return true;
};

/**
 * 5. COMPLETE APPOINTMENT (Moves it to History)
 *
 * Safe to call twice. Only a visit that is still active is changed; one that
 * is already completed is left exactly as it is, so its finish time
 * (completed_at) is set once and never overwritten, and billing a visit that
 * was completed earlier can't move that time to "now". A visit that was
 * cancelled in the meantime (another staff member, or the client) can't be
 * completed, and this says so instead of quietly reviving it.
 */
export const completeAppointment = async (id: string) => {
  // scheduled_date and scheduled_time used to be overwritten with
  // "right now" every time a visit was completed — silently
  // destroying the client's actual booked time and replacing it with
  // whatever moment staff happened to click complete. Every receipt
  // and report reading those fields was showing the wrong time.
  // completed_at is a real, separate column for when the visit
  // actually finished (migration 027) — it doesn't touch the
  // original booking data at all.
  const { data, error } = await supabase
    .from('appointments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ACTIVE)
    .select('id');
  if (error) throw error;
  if (data && data.length > 0) return true;

  // Nothing changed: find out why.
  const { data: current, error: readErr } = await supabase
    .from('appointments')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (current?.status === 'completed') return true;
  throw new Error("This appointment was cancelled, so it can't be completed.");
};

/**
 * 6. CANCEL APPOINTMENT (admin-side) — soft delete, keeps real history.
 * Only touches a booking that is still active. Returns false when it
 * had already been completed or cancelled by someone else.
 */
export const cancelAppointmentAdmin = async (id: string) => {
  const { data: appt } = await supabase.from('appointments').select('*').eq('id', id).maybeSingle();
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .in('status', ACTIVE)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) return false;

  if (appt) {
    void notifyClient(appt, {
      title: 'Appointment Cancelled',
      message: `${appt.client_name}, your ${appt.service} appointment for ${appt.pet_name} on ${fmtNoticeDate(appt.requested_date)}${appt.scheduled_time ? ` at ${appt.scheduled_time}` : ''} was cancelled by the clinic. Please book a new time or contact us.`,
      category: 'appointment_cancelled',
    });
  }
  return true;
};

/**
 * 6b. DECLINE A REQUEST — turns away a booking that is still pending.
 * Returns false if it was already handled.
 */
export const declineAppointment = async (id: string) => {
  const { data: appt } = await supabase.from('appointments').select('*').eq('id', id).maybeSingle();
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'incoming')
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) return false;

  if (appt) {
    void notifyClient(appt, {
      title: 'Appointment Request Declined',
      message: `${appt.client_name}, we couldn't accept your ${appt.service} request for ${appt.pet_name} on ${fmtNoticeDate(appt.requested_date)}${appt.scheduled_time ? ` at ${appt.scheduled_time}` : ''}. Please choose another time.`,
      category: 'appointment_declined',
    });
  }
  return true;
};

/**
 * 7. RESCHEDULE APPOINTMENT (admin-side) — direct update, status unchanged
 * (Admin is coordinating with the client directly, so this doesn't reset to "incoming"
 * the way the client-initiated mobile reschedule does.)
 */
export const rescheduleAppointmentAdmin = async (id: string, newDate: string, newTime: string) => {
  const { data: appt } = await supabase.from('appointments').select('*').eq('id', id).maybeSingle();
  const { data, error } = await supabase
    .from('appointments')
    .update({ requested_date: newDate, scheduled_time: newTime })
    .eq('id', id)
    .in('status', ACTIVE)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('That appointment was already completed or cancelled, so it can\'t be moved.');
  }

  if (appt) {
    void notifyClient(appt, {
      title: 'Appointment Rescheduled',
      message: `${appt.client_name}, your ${appt.service} appointment for ${appt.pet_name} has been moved to ${fmtNoticeDate(newDate)} at ${newTime}.`,
      category: 'appointment_rescheduled',
    });
  }
  return true;
};

/**
 * 8. ASSIGN STAFF TO APPOINTMENT
 * Either a real staffId (from the dropdown, a real account), or a
 * plain name/role for someone without one — never both. Passing one
 * clears the other explicitly, so switching from a manual entry to a
 * real account (or back) doesn't leave stale data behind from
 * whichever way it was set before.
 */
export const assignStaffToAppointment = async (
  id: string,
  assignment: { staffId?: string | null; staffName?: string | null; staffRole?: string | null }
) => {
  const { error } = await supabase
    .from('appointments')
    .update({
      assigned_staff_id: assignment.staffId ?? null,
      assigned_staff_name: assignment.staffName ?? null,
      assigned_staff_role: assignment.staffRole ?? null,
    })
    .eq('id', id);
  if (error) throw error;
  return true;
};

/**
 * 9. FETCH STAFF LIST (for the assignment dropdown) — active accounts only
 */
export const fetchStaffOptions = async (): Promise<StaffOption[]> => {
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, role, title, job_title, secondary_title, status')
    .eq('status', 'active');
  if (error) throw error;
  return (data || []) as StaffOption[];
};

/**
 * 9b. EVERY staff account, any status — for NAMING people already on an
 * appointment. A suspended person who handled a visit last week must
 * still show their name there, not "Unknown staff".
 */
export const fetchStaffDirectory = async (): Promise<StaffOption[]> => {
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, role, title, job_title, secondary_title, status');
  if (error) throw error;
  return (data || []) as StaffOption[];
};