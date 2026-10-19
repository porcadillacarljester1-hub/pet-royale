import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* How many completed visits nobody has charged yet, for the badge on the
   Billing link. Same rule as the "Not billed" card on the Billing screen,
   with the Service filter off and no period:
   - a completed visit with no invoice at all, plus
   - an invoice whose total is ₱0 (completed without an amount).
   Only ids and totals are fetched, a page at a time, so it stays light. It
   reloads by itself when visits or invoices change, and every 2 minutes. */

const PAGE = 1000;

async function fetchAllRows<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchNotBilledCount(): Promise<number> {
  const [visits, invoices] = await Promise.all([
    fetchAllRows<{ id: string }>((a, b) =>
      (supabase as any).from("appointments").select("id").eq("status", "completed").order("id").range(a, b),
    ),
    fetchAllRows<{ id: string; appointment_id: string | null; total_amount: number | null }>((a, b) =>
      (supabase as any).from("invoices").select("id, appointment_id, total_amount").order("id").range(a, b),
    ),
  ]);

  const invoiced = new Set<string>();
  const billed = new Set<string>();
  let zero = 0;
  for (const inv of invoices) {
    if (inv.appointment_id) invoiced.add(inv.appointment_id);
    const hasAmount = Math.round(Number(inv.total_amount || 0) * 100) > 0;
    if (hasAmount && inv.appointment_id) billed.add(inv.appointment_id);
  }
  for (const inv of invoices) {
    const hasAmount = Math.round(Number(inv.total_amount || 0) * 100) > 0;
    if (!hasAmount && !(inv.appointment_id && billed.has(inv.appointment_id))) zero += 1;
  }
  const noInvoice = visits.filter((v) => !invoiced.has(v.id)).length;
  return noInvoice + zero;
}

export const NOT_BILLED_COUNT_KEY = ["not-billed-count"];

export function useNotBilledCount(enabled = true): number {
  const queryClient = useQueryClient();

  const { data = 0 } = useQuery({
    queryKey: NOT_BILLED_COUNT_KEY,
    queryFn: fetchNotBilledCount,
    enabled,
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: NOT_BILLED_COUNT_KEY });
      }, 600);
    };
    // A unique name, since several screens can be mounted one after another.
    const channel = (supabase as any).channel(`not-billed-badge-${Math.random().toString(36).slice(2)}`);
    for (const table of ["invoices", "appointments"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      (supabase as any).removeChannel(channel);
    };
  }, [queryClient, enabled]);

  return data;
}
