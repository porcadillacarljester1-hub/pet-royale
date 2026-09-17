import { supabase } from "@/integrations/supabase/client";

export interface Appointment {
  id: string;
  client_id?: string;
  client_name: string;
  pet_id?: string;
  pet_name: string;
  pet_species: string;
  service: string;
  requested_date: string;
  scheduled_date?: string;
  scheduled_time?: string;
  status: 'incoming' | 'confirmed' | 'completed' | 'cancelled';
  assigned_staff_id?: string | null;
  created_at?: string;
}

export interface StaffOption {
  id: string;
  full_name: string;
  role: string;
}

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
 */
export const fetchAppointmentsInRange = async (startDate: string, endDate: string): Promise<Appointment[]> => {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .gte('requested_date', startDate)
    .lte('requested_date', endDate)
    .order('requested_date', { ascending: true })
    .order('scheduled_time', { ascending: true });
  if (error) throw error;
  return (data || []) as Appointment[];
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
      client_id: appointment.client_id ?? '',
      pet_id: appointment.pet_id ?? '',
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

/**
 * 4. CONFIRM APPOINTMENT
 */
export const confirmAppointment = async (id: string) => {
  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr) throw fetchErr;

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'confirmed' })
    .eq('id', id);
  if (error) throw error;

  try {
    const { error: notifErr } = await (supabase as any)
      .from('notifications')
      .insert([{
        title: 'Appointment Confirmed',
        message: `${appt.client_name}, your ${appt.service} appointment for ${appt.pet_name} has been confirmed.`,
        type: 'appointment',
        category: 'appointment_confirmed',
        related_type: 'appointment',
        related_id: id,
        client_user_id: appt.client_id,
        is_read: false,
      }]);
    if (notifErr) console.error('Failed to create confirmation notification:', notifErr);
  } catch (notifErr) {
    console.error('Failed to create confirmation notification:', notifErr);
  }

  return true;
};

/**
 * 5. COMPLETE APPOINTMENT (Moves it to History)
 */
export const completeAppointment = async (id: string) => {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'completed',
      scheduled_date: date,
      scheduled_time: time,
    })
    .eq('id', id);
  if (error) throw error;
  return true;
};

/**
 * 6. CANCEL APPOINTMENT (admin-side) — soft delete, keeps real history
 */
export const cancelAppointmentAdmin = async (id: string) => {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;
  return true;
};

/**
 * 7. RESCHEDULE APPOINTMENT (admin-side) — direct update, status unchanged
 * (Admin is coordinating with the client directly, so this doesn't reset to "incoming"
 * the way the client-initiated mobile reschedule does.)
 */
export const rescheduleAppointmentAdmin = async (id: string, newDate: string, newTime: string) => {
  const { error } = await supabase
    .from('appointments')
    .update({ requested_date: newDate, scheduled_time: newTime })
    .eq('id', id);
  if (error) throw error;
  return true;
};

/**
 * 8. ASSIGN STAFF TO APPOINTMENT
 */
export const assignStaffToAppointment = async (id: string, staffId: string | null) => {
  const { error } = await supabase
    .from('appointments')
    .update({ assigned_staff_id: staffId })
    .eq('id', id);
  if (error) throw error;
  return true;
};

/**
 * 9. FETCH STAFF LIST (for assignment dropdown/filter)
 */
export const fetchStaffOptions = async (): Promise<StaffOption[]> => {
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, role')
    .eq('status', 'active');
  if (error) throw error;
  return (data || []) as StaffOption[];
};