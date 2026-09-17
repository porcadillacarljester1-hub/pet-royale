import { supabase } from "@/integrations/supabase/client";

export type PricingType = "flat" | "variable" | "weight_tiered";

export interface ServiceTier {
  id: string;
  service_id: string;
  min_weight: number;
  max_weight: number;
  price: number;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  pricing_type: PricingType;
  price: number | null;
  notes: string | null;
  created_at: string;
  tiers: ServiceTier[];
}

export const CATEGORY_ORDER = [
  "Consultation",
  "Parenteral Administration",
  "Oral Medications",
  "Topical Medicines",
  "Laboratory Tests",
  "Confinement",
  "Grooming",
  "Dematting",
  "Other Services",
];

export async function fetchServices(): Promise<Service[]> {
  const { data: services, error: sErr } = await (supabase as any)
    .from("services")
    .select("*")
    .order("name");
  if (sErr) throw sErr;

  const { data: tiers, error: tErr } = await (supabase as any)
    .from("service_price_tiers")
    .select("*")
    .order("min_weight");
  if (tErr) throw tErr;

  return (services || []).map((s: any) => ({
    ...s,
    tiers: (tiers || []).filter((t: any) => t.service_id === s.id),
  }));
}

export interface ServiceInput {
  name: string;
  category: string;
  pricing_type: PricingType;
  price?: number | null;
  notes?: string | null;
  tiers?: { min_weight: number; max_weight: number; price: number }[];
}

export async function addService(input: ServiceInput): Promise<void> {
  const { data, error } = await (supabase as any)
    .from("services")
    .insert([
      {
        name: input.name,
        category: input.category,
        pricing_type: input.pricing_type,
        price: input.pricing_type === "flat" ? input.price : null,
        notes: input.notes || null,
      },
    ])
    .select()
    .single();
  if (error) throw error;

  if (input.pricing_type === "weight_tiered" && input.tiers?.length) {
    const rows = input.tiers.map((t) => ({
      service_id: data.id,
      min_weight: t.min_weight,
      max_weight: t.max_weight,
      price: t.price,
    }));
    const { error: tErr } = await (supabase as any).from("service_price_tiers").insert(rows);
    if (tErr) throw tErr;
  }
}

export async function updateService(id: string, input: ServiceInput): Promise<void> {
  const { error } = await (supabase as any)
    .from("services")
    .update({
      name: input.name,
      category: input.category,
      pricing_type: input.pricing_type,
      price: input.pricing_type === "flat" ? input.price : null,
      notes: input.notes || null,
    })
    .eq("id", id);
  if (error) throw error;

  // Replace tiers entirely on edit — simplest way to keep them in sync
  const { error: delErr } = await (supabase as any)
    .from("service_price_tiers")
    .delete()
    .eq("service_id", id);
  if (delErr) throw delErr;

  if (input.pricing_type === "weight_tiered" && input.tiers?.length) {
    const rows = input.tiers.map((t) => ({
      service_id: id,
      min_weight: t.min_weight,
      max_weight: t.max_weight,
      price: t.price,
    }));
    const { error: tErr } = await (supabase as any).from("service_price_tiers").insert(rows);
    if (tErr) throw tErr;
  }
}

export async function deleteService(id: string): Promise<void> {
  // service_price_tiers has ON DELETE CASCADE, so tiers clean up automatically
  const { error } = await (supabase as any).from("services").delete().eq("id", id);
  if (error) throw error;
}