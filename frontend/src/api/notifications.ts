import { supabase } from "@/integrations/supabase/client";

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  // Was already being written on every client-facing notification
  // (confirmAppointment sets it to the client's own id) but was
  // never declared here — meaning the admin Notifications screen had
  // no way to know this field existed at all, let alone filter on it.
  // Present and set: this notification is addressed to that one
  // client. Absent or null: it's a staff-facing alert, not tied to
  // any specific client.
  client_user_id?: string | null;
}

/* The one definition of "an appointment alert staff still need to act
   on" — used by the bell's count AND meant for the Notifications page
   list, so the badge and the page can never disagree.

   Two rules:
   1. Staff-facing only. Anything with a client_user_id is addressed to
      a client ("your appointment is confirmed / completed") and shares
      this table with staff alerts; it isn't something staff have to
      handle, so it never counts.
   2. Not a finished appointment. The row carries no status column, so
      this falls back to the wording: anything whose title or message
      says completed or cancelled is skipped. That's a stopgap — the
      exact fix is to filter on the appointment's own status, which
      needs the notification to store an appointment_id. */
export function isAwaitingAppointmentAlert(
  n: Pick<Notification, "type" | "title" | "message" | "client_user_id">
): boolean {
  if (n.type !== "appointment") return false;
  if (n.client_user_id) return false;
  const text = `${n.title ?? ""} ${n.message ?? ""}`.toLowerCase();
  return !/(complet|cancel)/.test(text);
}

// Ensures created_at is parsed as UTC even if the DB column lacks timezone info.
function normalizeTimestamp(n: Notification): Notification {
  return {
    ...n,
    created_at: n.created_at.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(n.created_at)
      ? n.created_at
      : n.created_at + 'Z',
  };
}

export const fetchNotifications = async (): Promise<Notification[]> => {
  const { data, error } = await (supabase as any)
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeTimestamp);
};

export const markAsRead = async (id: string) => {
  const { error } = await (supabase as any)
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id);
  if (error) throw error;
};

export const markAllAsRead = async () => {
  const { error } = await (supabase as any)
    .from('notifications')
    .update({ is_read: true })
    .eq('is_read', false);
  if (error) throw error;
};

export const deleteNotification = async (id: string) => {
  const { error } = await (supabase as any)
    .from('notifications')
    .delete()
    .eq('id', id);
  if (error) throw error;
};

export const deleteAllNotifications = async () => {
  const { error } = await (supabase as any)
    .from('notifications')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
};