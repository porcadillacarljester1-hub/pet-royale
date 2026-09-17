import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, paymongo-signature",
};

async function verifySignature(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const signature = parts["li"] || parts["te"];
  if (!timestamp || !signature) return false;

  const payload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const computedSig = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedSig === signature;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("paymongo-signature") || "";
    const webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET");

    if (!webhookSecret) {
      console.error("PAYMONGO_WEBHOOK_SECRET not set");
      return new Response("Server not configured", { status: 500, headers: corsHeaders });
    }

    const isValid = await verifySignature(rawBody, signatureHeader, webhookSecret);
    if (!isValid) {
      console.error("Invalid webhook signature");
      return new Response("Invalid signature", { status: 401, headers: corsHeaders });
    }

    const event = JSON.parse(rawBody);
    const eventType = event?.data?.attributes?.type;

    if (eventType === "link.payment.paid") {
      const referenceNumber = event.data.attributes.data.attributes.reference_number;

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Mark the invoice as paid, and get its appointment_id back in one step
      const { data: updatedInvoice, error: invoiceErr } = await supabase
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("payment_reference", referenceNumber)
        .select("id, appointment_id")
        .single();

      if (invoiceErr) {
        console.error("Failed to mark invoice as paid:", invoiceErr);
        return new Response("Database update failed", { status: 500, headers: corsHeaders });
      }

      // Automatically mark the linked appointment as completed
      if (updatedInvoice?.appointment_id) {
        const { error: apptErr } = await supabase
          .from("appointments")
          .update({ status: "completed" })
          .eq("id", updatedInvoice.appointment_id);

        if (apptErr) {
          console.error("Failed to mark appointment as completed:", apptErr);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("Webhook processing failed", { status: 500, headers: corsHeaders });
  }
});