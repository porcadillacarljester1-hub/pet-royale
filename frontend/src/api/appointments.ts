import { supabase } from "@/integrations/supabase/client";

// Core data structure
export interface Appointment {
  id: string;
  client_id: string;
  client_name: string;
  pet_id: string;
  pet_name: string;
  pet_species: string;
  service: string;
  requested_date: string;
  scheduled_date?: string;
  scheduled_time?: string;
  status: 'incoming' | 'pending_client' | 'confirmed' | 'completed';
  created_at?: string;
  updated_at?: string;
}

/**
 * 1. FETCH ACTIVE APPOINTMENTS
 */
export const fetchAppointments = async (): Promise<Appointment[]> => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .neq('status', 'completed') // Don't show completed ones here
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as Appointment[];
  } catch (err) {
    console.error("Fetch Error:", err);
    return [];
  }
};

/**
 * 2. FETCH HISTORY (The function History.tsx was missing!)
 */
export const fetchHistory = async (): Promise<Appointment[]> => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('status', 'completed') // Only show completed records
      .order('updated_at', { ascending: false });

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
    .insert([appointment])
    .select()
    .single();
  if (error) throw error;
  return data;
};

/**
 * 4. SEND SCHEDULE TO CLIENT
 */
export const sendAppointmentSchedule = async (id: string, date: string, time: string) => {
  const { error } = await supabase
    .from('appointments')
    .update({ 
      scheduled_date: date,
      scheduled_time: time,
      status: 'pending_client' 
    })
    .eq('id', id);
  if (error) throw error;
  return true;
};

/**
 * 5. CONFIRM APPOINTMENT
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
 * 6. COMPLETE APPOINTMENT (Moves it to History)
 */
export const completeAppointment = async (id: string) => {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'completed' })
    .eq('id', id);
  if (error) throw error;
  return true;
};