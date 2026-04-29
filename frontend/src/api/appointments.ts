import { supabase } from "@/integrations/supabase/client";

// Core data structure
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
  status: 'incoming' | 'confirmed' | 'completed';
  created_at?: string;
}

/**
 * 1. FETCH ACTIVE APPOINTMENTS
 */
export const fetchAppointments = async (): Promise<Appointment[]> => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .neq('status', 'completed')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as Appointment[];
  } catch (err) {
    console.error("Fetch Error:", err);
    return [];
  }
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
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'confirmed' })
    .eq('id', id);
  if (error) throw error;
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