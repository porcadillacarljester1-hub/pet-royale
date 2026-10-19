import { supabase } from "@/integrations/supabase/client";

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  cost_price: number;
  stock: number;
  /* Safety stock level: at or below this the product counts as running low. */
  safety_stock: number;
  description: string | null;
  image_url: string | null;
  is_available: boolean;
  created_at: string;
}

export const PRODUCT_CATEGORIES = [
  "Pet Food",
  "Vitamins & Supplements",
  "Grooming & Hygiene",
  "Flea, Tick & Deworming",
  "Dental Care",
  "Treats & Enrichment",
  "Accessories & Essentials",
];

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await (supabase as any)
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addProduct(input: {
  name: string;
  category: string;
  price: number;
  cost_price?: number;
  stock?: number;
  safety_stock?: number;
  description: string | null;
  image_url: string | null;
}) {
  const { error } = await (supabase as any).from("products").insert([{ ...input, is_available: true }]);
  if (error) throw error;
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

export async function updateProduct(id: string, input: {
  name: string;
  category: string;
  price: number;
  cost_price?: number;
  stock?: number;
  safety_stock?: number;
  description: string | null;
  image_url: string | null;
}, changedBy: string | null = null) {
  const { data: current, error: fetchErr } = await (supabase as any)
    .from("products")
    .select("stock")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;

  const { error } = await (supabase as any).from("products").update(input).eq("id", id);
  if (error) throw error;

  if (input.stock !== undefined) {
    const delta = input.stock - (current?.stock ?? 0);
    if (delta !== 0) {
      await logInventoryChange({
        source_id: id,
        source_table: "products",
        change_amount: delta,
        reason: "adjustment",
        changed_by: changedBy,
      });
    }
  }
}

export async function toggleProductAvailability(id: string, isAvailable: boolean) {
  const { error } = await (supabase as any).from("products").update({ is_available: isAvailable }).eq("id", id);
  if (error) throw error;
}

export async function deleteProduct(id: string) {
  const { error } = await (supabase as any).from("products").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadProductPhoto(file: File): Promise<string> {
  const fileExt = file.name.split(".").pop();
  const fileName = `${crypto.randomUUID()}.${fileExt}`;
  const { error } = await supabase.storage.from("product-photos").upload(fileName, file);
  if (error) throw error;
  const { data } = supabase.storage.from("product-photos").getPublicUrl(fileName);
  return data.publicUrl;
}

export interface ProductSale {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  sold_at: string;
  sold_by_staff_id: string | null;
}

export async function recordProductSale(productId: string, quantity: number, staffId: string | null): Promise<string> {
  const { data, error } = await (supabase as any).rpc("record_product_sale", {
    p_product_id: productId,
    p_quantity: quantity,
    p_staff_id: staffId,
  });
  if (error) throw error;
  return data;
}

export async function updateProductStock(id: string, stock: number) {
  const { error } = await (supabase as any).from("products").update({ stock }).eq("id", id);
  if (error) throw error;
}