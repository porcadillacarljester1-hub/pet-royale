import { supabase } from "@/integrations/supabase/client";
import type { InventoryItem, InventoryInsert, InventoryUpdate } from "@/types";

export async function fetchInventory(): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .order("name", { ascending: true }); // Ensure 'name' matches SQL
  if (error) throw error;
  return data || [];
}

export async function addInventoryItem(item: InventoryInsert): Promise<InventoryItem> {
  // We ensure the object matches the SQL columns: name, category, stock, image_key
  const { data, error } = await supabase
    .from("inventory")
    .insert([item]) 
    .select()
    .single();
  
  if (error) {
    console.error("Add Error:", error.message);
    throw error;
  }
  return data;
}

export async function updateInventoryItem(id: string, updates: InventoryUpdate): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from("inventory")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await supabase.from("inventory").delete().eq("id", id);
  if (error) throw error;
}

export async function updateStock(id: string, newStock: number): Promise<void> {
  console.log('🔄 Updating stock:', { id, newStock });

  const { data, error } = await supabase
    .from("inventory")
    .update({ stock: Math.max(0, newStock) })
    .eq("id", id)
    .select();

  if (error) {
    console.error('❌ Stock update error:', error);
    throw error;
  }

  console.log('✅ Stock updated successfully:', data);
}

export async function uploadProductImage(file: File): Promise<string> {
  const ext = file.name.split(".").pop();
  const path = `${Date.now()}.${ext}`;
  
  // Make sure you created a PUBLIC bucket named 'product-images' in Supabase Storage
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, file);
    
  if (error) throw error;
  
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}