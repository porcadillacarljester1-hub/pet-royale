import { supabase } from "@/integrations/supabase/client";

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  service_id: string | null;
  service_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface Invoice {
  id: string;
  appointment_id: string;
  status: "Awaiting Payment" | "Partially Paid" | "Fully Paid";
  total_amount: number;
  payment_reference: string | null;
  checkout_url: string | null;
  created_at: string;
  paid_at: string | null;
  items: InvoiceItem[];
}

export async function fetchInvoiceForAppointment(appointmentId: string): Promise<Invoice | null> {
  const { data: invoice, error } = await (supabase as any)
    .from("invoices")
    .select("*")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) return null;

  const { data: items, error: itemsErr } = await (supabase as any)
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoice.id);
  if (itemsErr) throw itemsErr;

  return { ...invoice, items: items || [] };
}

export async function createDraftInvoice(appointmentId: string): Promise<Invoice> {
  const { data, error } = await (supabase as any)
    .from("invoices")
    .insert([{ appointment_id: appointmentId, status: "Awaiting Payment", total_amount: 0 }])
    .select()
    .single();
  if (error) throw error;
  return { ...data, items: [] };
}

export async function addInvoiceItem(
  invoiceId: string,
  item: { service_id: string | null; service_name: string; quantity: number; unit_price: number }
): Promise<void> {
  const subtotal = item.quantity * item.unit_price;
  const { error } = await (supabase as any).from("invoice_items").insert([
    { invoice_id: invoiceId, ...item, subtotal },
  ]);
  if (error) throw error;
  await recalcInvoiceTotal(invoiceId);
}

export async function removeInvoiceItem(invoiceId: string, itemId: string): Promise<void> {
  const { error } = await (supabase as any).from("invoice_items").delete().eq("id", itemId);
  if (error) throw error;
  await recalcInvoiceTotal(invoiceId);
}

async function recalcInvoiceTotal(invoiceId: string): Promise<void> {
  const { data: items, error } = await (supabase as any)
    .from("invoice_items")
    .select("subtotal")
    .eq("invoice_id", invoiceId);
  if (error) throw error;

  const total = (items || []).reduce((sum: number, i: any) => sum + Number(i.subtotal), 0);

  const { error: updErr } = await (supabase as any)
    .from("invoices")
    .update({ total_amount: total })
    .eq("id", invoiceId);
  if (updErr) throw updErr;
}

export async function finalizeInvoice(invoiceId: string, description: string): Promise<{ checkoutUrl: string }> {
  const { data, error } = await supabase.functions.invoke("create-payment-link", {
    body: { invoiceId, description },
  });

  if (error) {
    let message = error.message || "Failed to create payment link.";
    // Supabase's client hides the actual error body inside error.context —
    // unpack it so the real reason shows up instead of a generic message.
    if (error && "context" in error && error.context && typeof error.context.json === "function") {
      try {
        const body = await error.context.json();
        if (body?.error) message = body.error;
      } catch {
        // context wasn't valid JSON, fall back to the generic message
      }
    }
    throw new Error(message);
  }

  if (!data?.checkoutUrl) {
    throw new Error("Failed to create payment link.");
  }

  return { checkoutUrl: data.checkoutUrl };
}