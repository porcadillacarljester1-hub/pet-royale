import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchServices, addService, updateService, deleteService,
  CATEGORY_ORDER, type Service, type ServiceTier,
} from "@/api/services";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Pencil, Trash2, X, Loader2, Stethoscope, Scale } from "lucide-react";
import { toast } from "sonner";

/* ── Shared button/field classes, built on the same hsl(var(--…)) tokens
   as Appointments and Billing, not a separate palette — so this screen
   actually belongs to the app instead of looking bolted on. ── */
const BTN_PRIMARY = "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[hsl(var(--primary))] px-4 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:opacity-40";
const BTN_GHOST = "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]";
const BTN_QUIET = "inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-bold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]";
const FIELD = "rounded-xl border-[hsl(var(--input))] focus-visible:ring-[hsl(var(--primary)/.2)] focus-visible:border-[hsl(var(--primary))]";

/* Sentence case, not tracked-out caps — matches how every other dialog's
   field labels are actually styled (see the reschedule dialog in
   Appointments, or the payment form in Billing): "mb-2 block text-[13px]
   font-bold", full-contrast text, no uppercase treatment. Table and
   column headers keep the small tracked-caps convention below, since
   that's genuinely how this app's tables are headed elsewhere too —
   the two conventions serve different jobs. */
const FORM_LABEL = "mb-2 block text-[13px] font-bold";
const TABLE_LABEL = "text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]";

const PRICING_LABEL: Record<string, string> = {
  flat: "Fixed price",
  weight_tiered: "By pet weight",
  variable: "Varies",
};

/* Same hue families already used for appointment/payment status pills
   elsewhere in the app, reused here rather than invented fresh — so a
   pricing type reads with the same visual language as everything else. */
const PRICING_PILL: Record<string, string> = {
  flat: "bg-[hsl(174_35%_88%)] text-[hsl(174_43%_28%)]",
  weight_tiered: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]",
  variable: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
};

export default function Services() {
  const queryClient = useQueryClient();
  const { data: services = [], isLoading } = useQuery({ queryKey: ["services"], queryFn: fetchServices });

  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<Service | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(CATEGORY_ORDER[0]);
  const [pricingType, setPricingType] = useState<"flat" | "weight_tiered" | "variable">("flat");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [tiers, setTiers] = useState<Omit<ServiceTier, "id" | "service_id">[]>([
    { min_weight: 0, max_weight: 5, price: 0 },
  ]);

  const filtered = services.filter((s) => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
  });

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: filtered.filter((s) => s.category === cat),
  })).filter((g) => g.items.length > 0);

  const resetForm = () => {
    setName(""); setCategory(CATEGORY_ORDER[0]); setPricingType("flat");
    setPrice(""); setNotes(""); setTiers([{ min_weight: 0, max_weight: 5, price: 0 }]);
  };

  const openAdd = () => { resetForm(); setEditTarget(null); setShowDialog(true); };

  const openEdit = (s: Service) => {
    setEditTarget(s);
    setName(s.name);
    setCategory(s.category);
    setPricingType(s.pricing_type);
    setPrice(s.price != null ? String(s.price) : "");
    setNotes(s.notes || "");
    setTiers(
      s.tiers.length > 0
        ? s.tiers.map((t) => ({ min_weight: t.min_weight, max_weight: t.max_weight, price: t.price }))
        : [{ min_weight: 0, max_weight: 5, price: 0 }]
    );
    setShowDialog(true);
  };

  const closeDialog = () => { setShowDialog(false); setEditTarget(null); resetForm(); };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Service name is required."); return; }
    if (pricingType === "flat" && !price) { toast.error("Please set a price for this service."); return; }
    if (pricingType === "weight_tiered" && tiers.some((t) => !t.price)) {
      toast.error("Every weight tier needs a price.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        pricing_type: pricingType,
        price: pricingType === "flat" ? parseFloat(price) : null,
        notes: notes.trim() || null,
        tiers: pricingType === "weight_tiered" ? tiers : [],
      };
      if (editTarget) {
        await updateService(editTarget.id, payload);
        toast.success("Service updated.");
      } else {
        await addService(payload);
        toast.success("Service added.");
      }
      queryClient.invalidateQueries({ queryKey: ["services"] });
      closeDialog();
    } catch { toast.error("Failed to save service."); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteService(deleteTarget.id);
      toast.success("Service deleted.");
      queryClient.invalidateQueries({ queryKey: ["services"] });
      setDeleteTarget(null);
    } catch { toast.error("Failed to delete service."); } finally { setDeleting(false); }
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    setTiers([...tiers, { min_weight: last?.max_weight ?? 0, max_weight: (last?.max_weight ?? 0) + 5, price: 0 }]);
  };
  const updateTier = (i: number, field: keyof Omit<ServiceTier, "id" | "service_id">, value: number) => {
    setTiers(tiers.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  };
  const removeTier = (i: number) => {
    if (tiers.length === 1) return;
    setTiers(tiers.filter((_, idx) => idx !== i));
  };

  /* Tiered services used to print their whole tier list inside the table
     cell, so a five-tier service made a row five times taller than its
     neighbours. The range and count say the same thing in one line; the
     full breakdown is one click away in the edit dialog. */
  const renderPrice = (s: Service) => {
    if (s.pricing_type === "flat") {
      return (
        <span className="font-mono text-[hsl(var(--foreground))] font-semibold tabular-nums">
          ₱{s.price?.toLocaleString()}
        </span>
      );
    }
    if (s.pricing_type === "weight_tiered" && s.tiers.length > 0) {
      const prices = s.tiers.map((t) => t.price);
      const min = Math.min(...prices), max = Math.max(...prices);
      return (
        <div className="min-w-0">
          <p className="truncate font-mono text-[hsl(var(--foreground))] font-semibold tabular-nums">
            ₱{min.toLocaleString()}{min !== max && ` – ₱${max.toLocaleString()}`}
          </p>
          <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
            {s.tiers.length} weight tier{s.tiers.length === 1 ? "" : "s"}
          </p>
        </div>
      );
    }
    return (
      <div className="min-w-0">
        <p className="text-[hsl(var(--muted-foreground))]">Set at billing</p>
        {s.notes && <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]/80">{s.notes}</p>}
      </div>
    );
  };

  return (
    <AdminLayout title="Services" eyebrow="Treatments the clinic offers and what they cost">
      <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10">
        <div className="workspace-card overflow-hidden rounded-[26px]">

          {/* Search and Add live together in the same bar. */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--border)/.7)] p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search services or categories…"
                className="h-9 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-9 pr-3 text-sm text-[hsl(var(--foreground))] outline-none transition-shadow placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
              />
            </div>
            {search && <button onClick={() => setSearch("")} className={BTN_QUIET}>Clear</button>}
            <button onClick={openAdd} className={`${BTN_PRIMARY} ml-auto`}>
              <Plus className="h-4 w-4" /> Add service
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : grouped.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                <Stethoscope className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </div>
              <p className="text-sm font-bold">
                {search ? "No services match your search" : "No services yet"}
              </p>
              <p className="mx-auto mt-1.5 max-w-[300px] text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                {search
                  ? "Try a different term, or clear the search to see everything."
                  : "Add the treatments your clinic offers so they can be booked and billed."}
              </p>
              {!search && (
                <button onClick={openAdd} className={`${BTN_PRIMARY} mt-4`}>
                  <Plus className="h-4 w-4" /> Add your first service
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border)/.7)] bg-[hsl(var(--muted)/.5)]">
                    <th scope="col" className={`${TABLE_LABEL} py-3 pl-5 pr-3 text-left`}>Service</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[130px] px-3 py-3 text-left`}>Pricing</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[180px] px-3 py-3 text-left`}>Price</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[100px] py-3 pl-3 pr-5 text-right`}>Actions</th>
                  </tr>
                </thead>

                {grouped.map((group) => (
                  <tbody key={group.category}>
                    {/* Category is the section header, so per-row colour
                        chips would just repeat what this line already says. */}
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={4}
                        className="border-y border-[hsl(var(--border)/.7)] bg-[hsl(var(--muted)/.5)] px-5 py-2.5 text-left"
                      >
                        <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--foreground))]">
                          {group.category}
                        </span>
                        <span className="ml-2 text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                          {group.items.length} service{group.items.length === 1 ? "" : "s"}
                        </span>
                      </th>
                    </tr>

                    {group.items.map((s) => (
                      <tr key={s.id} className="border-b border-[hsl(var(--border)/.55)] transition last:border-0 hover:bg-[hsl(var(--muted)/.35)]">
                        <td className="py-3.5 pl-5 pr-3">
                          <p className="font-semibold">{s.name}</p>
                        </td>

                        <td className="px-3 py-3.5">
                          {/* whitespace-nowrap: "Fixed price" was wrapping
                              to two lines inside its own pill. */}
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                            PRICING_PILL[s.pricing_type] ?? PRICING_PILL.variable
                          }`}>
                            {s.pricing_type === "weight_tiered" && <Scale className="h-3 w-3" />}
                            {PRICING_LABEL[s.pricing_type]}
                          </span>
                        </td>

                        <td className="px-3 py-3.5">{renderPrice(s)}</td>

                        <td className="py-3.5 pl-3 pr-5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(s)}
                              title="Edit service"
                              aria-label={`Edit ${s.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--primary)/.1)] hover:text-[hsl(var(--primary))]"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(s)}
                              title="Delete service"
                              aria-label={`Delete ${s.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-0 [&>button]:hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--border)/.7)] px-6 pb-5 pt-6">
            <h2 className="font-sidebar text-lg font-bold leading-none">
              {editTarget ? "Edit service" : "Add service"}
            </h2>
            <button
              onClick={closeDialog}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <label className={FORM_LABEL}>Service name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rabies Vaccination" className={FIELD} />
            </div>

            <div>
              <label className={FORM_LABEL}>Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="rounded-xl border-[hsl(var(--input))]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className={FORM_LABEL}>How it's priced</label>
              <Select value={pricingType} onValueChange={(v) => setPricingType(v as any)}>
                <SelectTrigger className="rounded-xl border-[hsl(var(--input))]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Fixed price — same for every pet</SelectItem>
                  <SelectItem value="weight_tiered">By pet weight — price per weight range</SelectItem>
                  <SelectItem value="variable">Varies — set at billing</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {pricingType === "flat" && (
              <div>
                <label className={FORM_LABEL}>Price (₱)</label>
                <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className={FIELD} />
              </div>
            )}

            {pricingType === "weight_tiered" && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className={`${FORM_LABEL} mb-0`}>Weight tiers</label>
                  <button onClick={addTier} className="text-xs font-bold text-[hsl(var(--primary))] transition hover:opacity-75">
                    + Add tier
                  </button>
                </div>

                {/* Column headings once, not repeated as placeholders in
                    every row. */}
                <div className="mb-1.5 grid grid-cols-[1fr_1fr_1.3fr_32px] gap-2 px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">From (kg)</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">To (kg)</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Price (₱)</span>
                  <span />
                </div>

                <div className="space-y-2">
                  {tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1.3fr_32px] items-center gap-2">
                      <Input type="number" value={t.min_weight} onChange={(e) => updateTier(i, "min_weight", parseFloat(e.target.value) || 0)} className={FIELD} />
                      <Input type="number" value={t.max_weight} onChange={(e) => updateTier(i, "max_weight", parseFloat(e.target.value) || 0)} className={FIELD} />
                      <Input type="number" value={t.price} onChange={(e) => updateTier(i, "price", parseFloat(e.target.value) || 0)} className={FIELD} />
                      <button
                        onClick={() => removeTier(i)}
                        disabled={tiers.length === 1}
                        aria-label="Remove tier"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))] disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className={FORM_LABEL}>
                Notes <span className="text-[hsl(var(--muted-foreground))] font-medium">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={pricingType === "variable" ? "e.g. Priced per case after examination" : "Anything staff should know about this service"}
                className="w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-[hsl(var(--border)/.7)] px-6 pb-6 pt-3">
            <button onClick={closeDialog} className={BTN_QUIET}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={BTN_PRIMARY}>
              {saving ? "Saving…" : editTarget ? "Save changes" : "Add service"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sidebar text-lg font-bold">Delete this service?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTarget?.name}</span> will be removed from
              the service list and can no longer be added to invoices. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep service</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-xl bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              {deleting ? "Deleting…" : "Delete service"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
