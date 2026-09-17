import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { invoiceId, description } = await req.json();

    if (!invoiceId) {
      return new Response(
        JSON.stringify({ error: "invoiceId is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!secretKey) {
      return new Response(
        JSON.stringify({ error: "Payment provider not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Recompute the total server-side from the actual invoice_items —
    // never trust an amount sent from the client.
    const { data: items, error: itemsErr } = await supabase
      .from("invoice_items")
      .select("subtotal")
      .eq("invoice_id", invoiceId);

    if (itemsErr) {
      console.error("Failed to fetch invoice items:", itemsErr);
      return new Response(
        JSON.stringify({ error: "Could not read invoice items." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalAmount = (items || []).reduce((sum, i) => sum + Number(i.subtotal), 0);

    if (totalAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Invoice has no billable amount." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const amountInCentavos = Math.round(totalAmount * 100);

    const pmResponse = await fetch("https://api.paymongo.com/v1/links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(secretKey + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: amountInCentavos,
            description: description || "Pet Royale Clinic Payment",
            payment_method_types: ["gcash", "paymaya"],
          },
        },
      }),
    });

    const result = await pmResponse.json();

    if (!pmResponse.ok) {
      console.error("PayMongo error:", result);
      return new Response(
        JSON.stringify({ error: result?.errors?.[0]?.detail || "Failed to create payment link." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const linkData = result.data;
    const referenceNumber = linkData.attributes.reference_number;

    const { error: updateError } = await supabase
      .from("invoices")
      .update({
        status: "pending_payment",
        total_amount: totalAmount,
        payment_reference: referenceNumber,
        checkout_url: linkData.attributes.checkout_url,
      })
      .eq("id", invoiceId);

    if (updateError) {
      console.error("Failed to update invoice:", updateError);
    }

    return new Response(
      JSON.stringify({
        checkoutUrl: linkData.attributes.checkout_url,
        referenceNumber,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-payment-link error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong creating the payment link." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});