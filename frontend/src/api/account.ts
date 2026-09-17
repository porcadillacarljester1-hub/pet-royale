import { supabase } from "@/integrations/supabase/client";

export async function changePassword(
  role: "admin" | "staff",
  userId: string,
  newPassword: string
): Promise<void> {
  if (role === "admin") {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  } else {
    // Staff accounts aren't on Supabase Auth — password lives directly on the staff row.
    const { error } = await (supabase as any)
      .from("staff")
      .update({ password: newPassword })
      .eq("id", userId);
    if (error) throw error;
  }
}