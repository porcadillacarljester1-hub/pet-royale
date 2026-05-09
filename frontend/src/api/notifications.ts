import { supabase } from "@/integrations/supabase/client";

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export const fetchNotifications = async (): Promise<Notification[]> => {
  const { data, error } = await (supabase as any)
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
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