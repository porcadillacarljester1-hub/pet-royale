import { supabase } from "@/integrations/supabase/client";
import type { InventoryItem, InventoryInsert, InventoryUpdate } from "@/types";

export async function fetchInventory(): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []) as InventoryItem[];
}

export async function addInventoryItem(item: InventoryInsert): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from("inventory")
    .insert([item])
    .select()
    .single();

  if (error) {
    console.error("Add Error:", error.message);
    throw error;
  }
  return data as InventoryItem;
}

async function logInventoryChange(entry: {
  source_id: string;
  source_table: "inventory" | "products";
  change_amount: number;
  reason: string;
  changed_by: string | null;
}) {
  const { error } = await (supabase as any).from("inventory_logs").insert(entry);
  if (error) console.warn("Inventory log skipped:", error.message);
}

export async function updateInventoryItem(id: string, updates: InventoryUpdate, changedBy: string | null = null): Promise<InventoryItem> {
  const { data: current, error: fetchErr } = await supabase
    .from("inventory")
    .select("stock")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;

  const { data, error } = await supabase
    .from("inventory")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  if (updates.stock !== undefined) {
    const delta = updates.stock - (current?.stock ?? 0);
    if (delta !== 0) {
      await logInventoryChange({
        source_id: id,
        source_table: "inventory",
        change_amount: delta,
        reason: "adjustment",
        changed_by: changedBy,
      });
    }
  }

  return data as InventoryItem;
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await supabase.from("inventory").delete().eq("id", id);
  if (error) throw error;
}

export async function updateStock(id: string, newStock: number, changedBy: string | null = null): Promise<void> {
  const { data: current, error: fetchErr } = await supabase
    .from("inventory")
    .select("stock")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;

  const clampedNew = Math.max(0, newStock);
  const delta = clampedNew - (current?.stock ?? 0);

  const { error } = await supabase
    .from("inventory")
    .update({ stock: clampedNew })
    .eq("id", id);

  if (error) {
    console.error("❌ Stock update error:", error);
    throw error;
  }

  if (delta !== 0) {
    await logInventoryChange({
      source_id: id,
      source_table: "inventory",
      change_amount: delta,
      reason: "stepper",
      changed_by: changedBy,
    });
  }
}

export async function uploadProductImage(file: File): Promise<string> {
  const ext = file.name.split(".").pop();
  const path = `${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, file);

  if (error) throw error;

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}