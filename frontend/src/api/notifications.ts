import { supabase } from "@/integrations/supabase/client";

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
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