import { supabase } from "@/integrations/supabase/client";

export async function uploadStaffAvatar(file: File): Promise<string> {
  const ext = file.name.split(".").pop();
  const path = `${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("staff-avatars").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("staff-avatars").getPublicUrl(path);
  return data.publicUrl;
}

export async function updateStaffAvatar(userId: string, avatarUrl: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("staff")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId);
  if (error) throw error;
}