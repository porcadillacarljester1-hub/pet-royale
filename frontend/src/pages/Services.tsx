import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchServices, addService, updateService, deleteService,
  type Service, type ServiceTier,
} from "@/api/services";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDown, Loader2, Plus, Scale, Search, Settings2, Stethoscope } from "lucide-react";
import { toast } from "sonner";

/* The page layout, toolbar fields, segmented tabs, table, pills and buttons
   below are the same ones the Patients, Appointments and Billing screens use,
   so all of them look identical. If one changes, move them into a shared file. */

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

/* Column layout shared by the header row and every service row. */
const ROW_GRID = "lg:grid-cols-[minmax(0,1fr)_160px_190px_96px]";

const PRICING_LABEL: Record<string, string> = {
  flat: "Fixed price",
  weight_tiered: "By pet weight",
  variable: "Set at billing",
};

/* Soft filled pills, one colour per pricing type, like the status pills on
   the other screens. */
const PRICING_PILL: Record<string, string> = {
  flat: "bg-[hsl(145_40%_90%)] text-[hsl(145_42%_24%)]",
  weight_tiered: "bg-[hsl(220_70%_93%)] text-[hsl(220_55%_32%)]",
  variable: "bg-[hsl(40_80%_90%)] text-[hsl(40_70%_26%)]",
};

type PricingFilter = "all" | "flat" | "weight_tiered" | "variable";
type TierInput = Omit<ServiceTier, "id" | "service_id">;

/* Peso amounts always show two decimals, like the Reports screen. */
const money = (n: number) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Checks the weight ranges. Each tier must run upward (From below To) and
   start exactly where the previous one ended, so there are no overlaps and
   no gaps where a pet would have no price. Returns a message, or null. */
function tierRangeProblem(tiers: TierInput[]): string | null {
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.min_weight >= t.max_weight) {
      return `Tier ${i + 1}: "To" must be higher than "From".`;
    }
    if (i > 0) {
      const prev = tiers[i - 1];
      if (t.min_weight < prev.max_weight) {
        return `Tier ${i + 1} overlaps tier ${i}. "From" should be ${prev.max_weight}, where tier ${i} ends.`;
      }
      if (t.min_weight > prev.max_weight) {
        return `There's a gap between tier ${i} and tier ${i + 1}. "From" should be ${prev.max_weight}, so every weight has a price.`;
      }
    }
  }
  return null;
}

/* ── Page layout, same as the other redesigned screens ── */
const PAGE_WRAP = "w-full px-0 pb-8";
const CARD =
  "bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]";
/* PANEL clips its rows to the rounded corners; CARD does not. */
const PANEL = `overflow-hidden ${CARD}`;
const TABLE_HEAD =
  "hidden gap-4 border-y border-[hsl(var(--border)/.8)] bg-[hsl(var(--muted)/.55)] px-6 py-[11px] text-[12px] font-bold text-[hsl(var(--muted-foreground))] lg:grid";
/* Segmented tabs: one soft track with a navy tab for the chosen view. */
const SEG_TRACK =
  "flex max-w-full gap-6 overflow-x-auto border-b border-[hsl(var(--border))] px-5";
const segTab = (active: boolean) =>
  `-mb-px flex h-12 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 text-[14px] transition ${FOCUS_RING} ${
    active
      ? "border-[hsl(var(--primary))] font-bold text-[hsl(var(--foreground))]"
      : "border-transparent font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
  }`;
/* Toolbar buttons: 44px high, 10px radius. */
const CTL_BASE =
  `inline-flex h-11 items-center justify-center rounded-[10px] text-[14px] font-bold ${FOCUS_RING}`;
const CTL_FIELD = "border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] text-[hsl(var(--primary))]";
const ADD_BTN =
  `inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[hsl(var(--primary))] px-5 text-[14px] font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 ${FOCUS_RING}`;
const OUTLINE_BTN =
  `inline-flex h-10 items-center justify-center rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-5 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`;

/* Search box with a magnifier. */
function SearchField({
  label, value, onChange, className = "",
}: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={`flex h-11 items-center gap-2 rounded-[10px] border border-[hsl(var(--card-border))] bg-[hsl(var(--muted)/.5)] px-3 focus-within:border-[hsl(var(--primary))] focus-within:ring-2 focus-within:ring-[hsl(var(--primary)/.15)] ${className}`}>
      <Search size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[14px] !outline-none !ring-0 !shadow-none placeholder:text-[hsl(var(--muted-foreground))]"
      />
    </label>
  );
}

/* Compact select for the toolbar. */
function SelectField({
  label, value, onChange, children, className = "",
}: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={onChange}
        aria-label={label}
        className={`h-11 w-full appearance-none rounded-[10px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] pl-3 pr-9 text-[14px] font-semibold transition focus:border-[hsl(var(--primary))] ${FOCUS_RING}`}
      >
        {children}
      </select>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

/* ── Dialog pieces (the dialogs keep their floating-label look) ── */

/* Floating-label fields: the label sits inside the field and moves up
   once there is something in it, like the sign-in form in the app. */
const FLOAT_BOX =
  "w-full rounded-[16px] border-[1.5px] border-[hsl(var(--input))] bg-[hsl(var(--card))] text-[16px] font-medium transition focus:border-[hsl(var(--primary))] focus:outline-none";
const FLOAT_LABEL_UP = "pointer-events-none absolute left-4 top-2 text-[13px] font-medium leading-4 text-[hsl(var(--muted-foreground))]";

function FloatInput({
  label, value, onChange, type = "text", className = "", ...rest
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <div className={`relative ${className}`}>
      <input
        {...rest}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        aria-label={label}
        className={`peer h-14 ${FLOAT_BOX} px-4 pb-1.5 pt-6`}
      />
      <span
        className="pointer-events-none absolute left-4 top-[16px] text-[16px] leading-6 text-[hsl(var(--muted-foreground))] transition-all peer-focus:top-2 peer-focus:text-[13px] peer-focus:leading-4 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[13px] peer-[:not(:placeholder-shown)]:leading-4"
      >
        {label}
      </span>
    </div>
  );
}

function FloatSelect({
  label, value, onChange, children, className = "",
}: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={onChange}
        aria-label={label}
        className={`h-14 appearance-none ${FLOAT_BOX} pb-1 pl-4 pr-10 pt-6`}
      >
        {children}
      </select>
      <span className={FLOAT_LABEL_UP}>{label}</span>
      <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

/* Dialog buttons: the pill shape the other dialogs use. */
const BTN_SOLID =
  "flex h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none";
const BTN_OUTLINE =
  "h-12 rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-6 text-[16px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50";
const TEXT_ACTION = "shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--primary))] hover:underline";
/* Category row actions: 44px tall to tap comfortably, with Delete set apart
   by a divider and a lighter weight, since it is the less common action. */
const ROW_ACTION = "flex min-h-[44px] shrink-0 items-center px-3 text-[15px] font-bold text-[hsl(var(--primary))] hover:underline";
const ROW_DANGER = "ml-1 flex min-h-[44px] shrink-0 items-center border-l border-[hsl(var(--card-border))] pl-4 pr-2 text-[15px] font-medium text-[hsl(var(--destructive))] hover:underline";

interface ServiceCategory { id: string; name: string; sort_order: number; }

async function fetchServiceCategories(): Promise<ServiceCategory[]> {
  const { data, error } = await (supabase as any)
    .from("categories").select("id, name, sort_order").eq("type", "service")
    .order("sort_order").order("name");
  if (error) throw error;
  return data || [];
}

async function addServiceCategory(name: string) {
  const { error } = await (supabase as any)
    .from("categories").insert([{ name: name.trim(), type: "service" }]);
  if (error) throw error;
}

async function renameServiceCategory(id: string, name: string) {
  const { error } = await (supabase as any)
    .rpc("rename_service_category", { p_id: id, p_new_name: name.trim() });
  if (error) throw error;
}

async function deleteServiceCategory(id: string, moveTo: string | null) {
  const { error } = await (supabase as any)
    .rpc("delete_service_category", { p_id: id, p_move_to: moveTo });
  if (error) throw error;
}

function ManageServiceCategoriesDialog({
  open, onClose, categories, services, onAdded, onRenamed, onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  categories: ServiceCategory[];
  services: Service[];
  onAdded?: (name: string) => void;
  onRenamed?: (oldName: string, newName: string) => void;
  onDeleted?: (name: string, movedTo: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServiceCategory | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [deleting, setDeleting] = useState(false);

  const countFor = (name: string) => services.filter((s) => s.category === name).length;
  const isDuplicate = (name: string, exceptId?: string) =>
    categories.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

  // Both queries: a rename or a move changes service rows too.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["categories", "service"] });
    queryClient.invalidateQueries({ queryKey: ["services"] });
  };

  const close = () => {
    setNewName(""); setEditingId(null); setEditingName("");
    setDeleteTarget(null); setMoveTo("");
    onClose();
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    if (isDuplicate(name)) { toast.error(`"${name}" already exists.`); return; }
    setAdding(true);
    try {
      await addServiceCategory(name);
      toast.success(`"${name}" added.`);
      setNewName("");
      onAdded?.(name);
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't add that category.");
    } finally { setAdding(false); }
  };

  const startEdit = (c: ServiceCategory) => { setEditingId(c.id); setEditingName(c.name); };

  const saveEdit = async () => {
    if (!editingId) return;
    const current = categories.find((c) => c.id === editingId);
    const name = editingName.trim();
    if (!name) { toast.error("Category name can't be empty."); return; }
    if (current && name === current.name) { setEditingId(null); return; }
    if (isDuplicate(name, editingId)) { toast.error(`"${name}" already exists.`); return; }
    setSaving(true);
    try {
      await renameServiceCategory(editingId, name);
      const n = current ? countFor(current.name) : 0;
      toast.success(n > 0 ? `Renamed. ${n} service${n === 1 ? "" : "s"} updated.` : "Renamed.");
      setEditingId(null);
      if (current) onRenamed?.(current.name, name);
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't rename that category.");
    } finally { setSaving(false); }
  };

  const deleteCount = deleteTarget ? countFor(deleteTarget.name) : 0;
  const moveOptions = deleteTarget ? categories.filter((c) => c.id !== deleteTarget.id) : [];
  const canConfirmDelete = deleteCount === 0 || !!moveTo;

  const handleDelete = async () => {
    if (!deleteTarget || !canConfirmDelete) return;
    setDeleting(true);
    try {
      await deleteServiceCategory(deleteTarget.id, deleteCount > 0 ? moveTo : null);
      toast.success(
        deleteCount > 0
          ? `"${deleteTarget.name}" removed. ${deleteCount} service${deleteCount === 1 ? "" : "s"} moved to "${moveTo}".`
          : `"${deleteTarget.name}" removed.`
      );
      onDeleted?.(deleteTarget.name, deleteCount > 0 ? moveTo : null);
      setDeleteTarget(null); setMoveTo("");
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't delete that category.");
    } finally { setDeleting(false); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="!flex max-h-[80vh] max-w-[520px] flex-col gap-0 overflow-hidden rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))] p-0 [&>button]:hidden">
          <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-4 pt-6">
            <div>
              <DialogTitle asChild>
                <h2 className="text-[28px] font-bold leading-[34px] tracking-[-.02em]">Manage categories</h2>
              </DialogTitle>
              <DialogDescription asChild>
                <p className="mt-1 text-[15px] text-[hsl(var(--muted-foreground))]">How services are grouped</p>
              </DialogDescription>
            </div>
            <button
              onClick={close}
              className={`rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            <div className="flex items-start gap-3">
              <FloatInput
                label="New category"
                value={newName}
                onChange={setNewName}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                autoComplete="off"
                className="min-w-0 flex-1"
              />
              <button
                onClick={handleAdd}
                disabled={adding || !newName.trim()}
                className="flex h-14 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)] disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-[24px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4">
              {categories.length === 0 ? (
                <p className="py-8 text-center text-[15px] text-[hsl(var(--muted-foreground))]">
                  No categories yet. Add the first one above.
                </p>
              ) : (
                categories.map((c, i) => {
                  const n = countFor(c.name);
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center gap-3 py-3 ${i < categories.length - 1 ? "border-b border-[hsl(var(--card-border))]" : ""}`}
                    >
                      {editingId === c.id ? (
                        <>
                          <FloatInput
                            label="Name"
                            value={editingName}
                            onChange={setEditingName}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                            autoFocus
                            className="min-w-0 flex-1"
                          />
                          <button onClick={saveEdit} disabled={saving} className={TEXT_ACTION}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--muted-foreground))] hover:underline"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 break-words text-[16px] font-bold leading-snug">{c.name}</span>
                          <span className="shrink-0 text-[14px] text-[hsl(var(--muted-foreground))]">
                            {n} service{n === 1 ? "" : "s"}
                          </span>
                          <button onClick={() => startEdit(c)} aria-label={`Rename ${c.name}`} className={ROW_ACTION}>
                            Rename
                          </button>
                          <button
                            onClick={() => { setDeleteTarget(c); setMoveTo(""); }}
                            aria-label={`Delete ${c.name}`}
                            className={ROW_DANGER}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-[hsl(var(--card-border))] px-6 pb-5 pt-3">
            <button onClick={close} className={`${BTN_SOLID} w-full`}>Done</button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o && !deleting) { setDeleteTarget(null); setMoveTo(""); } }}
      >
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold tracking-[-.02em]">Delete this category?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              {deleteCount === 0 ? (
                <>
                  <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTarget?.name}</span> has no
                  services in it, so nothing else changes.
                </>
              ) : (
                <>
                  <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTarget?.name}</span> has{" "}
                  {deleteCount} service{deleteCount === 1 ? "" : "s"}. They move to the category you pick below as
                  part of the delete, so none of them are left without one.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteCount > 0 && (
            moveOptions.length === 0 ? (
              <p className="text-[14px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                This is the only category. Add another one first, so these services have somewhere to go.
              </p>
            ) : (
              <FloatSelect label="Move services to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">Select a category</option>
                {moveOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </FloatSelect>
            )
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className={`${BTN_OUTLINE} mt-0`} disabled={deleting}>Keep category</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting || !canConfirmDelete || (deleteCount > 0 && moveOptions.length === 0)}
              className="h-12 rounded-full bg-[hsl(var(--destructive))] px-6 text-[16px] font-bold text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete category"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function Services() {
  const queryClient = useQueryClient();
  const { data: services = [], isLoading } = useQuery({ queryKey: ["services"], queryFn: fetchServices });
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["categories", "service"],
    queryFn: fetchServiceCategories,
  });

  const [search, setSearch] = useState("");
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  /* Categories the person has folded shut. While searching, every match stays
     open so nothing is hidden. */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showDialog, setShowDialog] = useState(false);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [editTarget, setEditTarget] = useState<Service | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("");
  const [pricingType, setPricingType] = useState<"flat" | "weight_tiered" | "variable">("flat");
  const [price, setPrice] = useState("");
  const [tiers, setTiers] = useState<TierInput[]>([
    { min_weight: 0, max_weight: 5, price: 0 },
  ]);

  /* A remembered category that was renamed or deleted would filter everything
     out of a list the dropdown can't show, so it falls back to all. */
  const activeCategory = categories.some((c) => c.name === categoryFilter) ? categoryFilter : "";

  const filtered = services.filter((s) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || s.name.toLowerCase().includes(q) || (s.category ?? "").toLowerCase().includes(q);
    const matchesPricing = pricingFilter === "all" || s.pricing_type === pricingFilter;
    const matchesCategory = !activeCategory || s.category === activeCategory;
    return matchesSearch && matchesPricing && matchesCategory;
  });

  const searching = search.trim() !== "";
  const hasFilters = searching || pricingFilter !== "all" || !!activeCategory;
  const clearFilters = () => { setSearch(""); setPricingFilter("all"); setCategoryFilter(""); };

  const counts = {
    total: services.length,
    flat: services.filter((s) => s.pricing_type === "flat").length,
    weight: services.filter((s) => s.pricing_type === "weight_tiered").length,
    variable: services.filter((s) => s.pricing_type === "variable").length,
  };

  const knownCategories = new Set(categories.map((c) => c.name));
  const grouped = [
    ...categories.map((c) => ({
      category: c.name,
      uncategorized: false,
      items: filtered.filter((s) => s.category === c.name),
    })),
    {
      category: "Uncategorized",
      uncategorized: true,
      items: filtered.filter((s) => !knownCategories.has(s.category)),
    },
  ].filter((g) => g.items.length > 0);

  const isClosed = (cat: string) => !searching && !!collapsed[cat];
  const toggleGroup = (cat: string) => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }));
  const expandAll = () => setCollapsed({});
  const collapseAll = () => setCollapsed(Object.fromEntries(grouped.map((g) => [g.category, true])));

  const resetForm = () => {
    setName(""); setCategory(""); setPricingType("flat");
    setPrice(""); setTiers([{ min_weight: 0, max_weight: 5, price: 0 }]);
  };

  const openAdd = () => {
    resetForm();
    setCategory(categories[0]?.name ?? "");
    setEditTarget(null);
    setShowDialog(true);
  };

  const openEdit = (s: Service) => {
    setEditTarget(s);
    setName(s.name);

    setCategory(knownCategories.has(s.category) ? s.category : "");
    setPricingType(s.pricing_type);
    setPrice(s.price != null ? String(s.price) : "");
    setTiers(
      s.tiers.length > 0
        ? s.tiers.map((t) => ({ min_weight: t.min_weight, max_weight: t.max_weight, price: t.price }))
        : [{ min_weight: 0, max_weight: 5, price: 0 }]
    );
    setShowDialog(true);
  };

  const closeDialog = () => { setShowDialog(false); setEditTarget(null); resetForm(); };

  const priceOk = pricingType !== "flat" || (Number.isInteger(Number(price)) && Number(price) > 0);
  // Range problems (overlaps, gaps, backwards ranges) are shown under the
  // tiers; a missing price just keeps Save switched off.
  const rangeProblem = pricingType === "weight_tiered" ? tierRangeProblem(tiers) : null;
  const tiersOk = pricingType !== "weight_tiered" || (!rangeProblem && tiers.every((t) => t.price > 0));
  const canSave = !!name.trim() && !!category && priceOk && tiersOk;

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Service name is required."); return; }
    if (!category) { toast.error("Choose a category for this service."); return; }
    if (!priceOk) { toast.error("Set a whole-peso price above ₱0 for this service."); return; }
    if (rangeProblem) { toast.error(rangeProblem); return; }
    if (!tiersOk) { toast.error("Every weight tier needs a price."); return; }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        pricing_type: pricingType,
        price: pricingType === "flat" ? parseInt(price, 10) : null,
        // Notes are no longer edited here. An existing service keeps what
        // it already has, so saving never wipes it.
        notes: editTarget?.notes ?? null,
        tiers: pricingType === "weight_tiered" ? tiers : [],
      };
      if (editTarget) {
        await updateService(editTarget.id, payload);
        toast.success("Service updated.");
      } else {
        await addService(payload);
        toast.success("Service added.");
        // Make sure the new service isn't hidden inside a folded category.
        setCollapsed((c) => ({ ...c, [category]: false }));
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
      if (showDialog) closeDialog();
    } catch { toast.error("Failed to delete service."); } finally { setDeleting(false); }
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    setTiers([...tiers, { min_weight: last?.max_weight ?? 0, max_weight: (last?.max_weight ?? 0) + 5, price: 0 }]);
  };
  const updateTier = (i: number, field: keyof TierInput, value: number) => {
    setTiers(tiers.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  };
  const removeTier = (i: number) => {
    if (tiers.length === 1) return;
    setTiers(tiers.filter((_, idx) => idx !== i));
  };

  const renderPrice = (s: Service) => {
    if (s.pricing_type === "flat") {
      return (
        <span className="text-[14px] font-bold tabular-nums">{money(s.price ?? 0)}</span>
      );
    }
    if (s.pricing_type === "weight_tiered") {
      if (s.tiers.length === 0) {
        return <p className="text-[14px] text-[hsl(var(--destructive))]">No tiers set</p>;
      }
      const prices = s.tiers.map((t) => t.price);
      const min = Math.min(...prices), max = Math.max(...prices);
      return (
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold tabular-nums">
            {money(min)}{min !== max && ` – ${money(max)}`}
          </p>
          <p className="mt-0.5 text-[12.5px] text-[hsl(var(--muted-foreground))]">
            {s.tiers.length} weight tier{s.tiers.length === 1 ? "" : "s"}
          </p>
        </div>
      );
    }
    return <p className="text-[14px] text-[hsl(var(--muted-foreground))]">Set at billing</p>;
  };

  const loading = isLoading || categoriesLoading;

  const TABS: { key: PricingFilter; label: string; n: number }[] = [
    { key: "all", label: "All services", n: counts.total },
    { key: "flat", label: "Fixed price", n: counts.flat },
    { key: "weight_tiered", label: "By pet weight", n: counts.weight },
    { key: "variable", label: "Set at billing", n: counts.variable },
  ];

  return (
    <AdminLayout title="Services">
      <div className={PAGE_WRAP}>

        {/* ── Toolbar: pricing tabs, search, category, actions ── */}
        <div className={`${CARD} flex flex-col pb-4`}>
          <div role="group" aria-label="Pricing type" className={SEG_TRACK}>
            {TABS.map((t) => {
              const active = pricingFilter === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setPricingFilter(t.key)}
                  aria-pressed={active}
                  className={segTab(active)}
                >
                  {t.label}
                  <span
                    className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-bold tabular-nums ${
                      active
                        ? "bg-white/20"
                        : "bg-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
                    } ${t.n === 0 && !active ? "opacity-50" : ""}`}
                  >
                    {loading ? "—" : t.n}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
            <SearchField
              label="Search services"
              value={search}
              onChange={setSearch}
              className="min-w-[200px] max-w-[460px] flex-1 basis-[240px]"
            />
            <SelectField
              label="Category"
              value={activeCategory}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="min-w-[180px] shrink-0"
            >
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </SelectField>
            <div className="flex-1" />
            <button
              onClick={() => setShowManageCategories(true)}
              className={`${CTL_BASE} ${CTL_FIELD} shrink-0 gap-2 px-5 transition hover:bg-[hsl(var(--muted))]`}
            >
              <Settings2 size={16} aria-hidden="true" />
              Manage categories
            </button>
            <button onClick={openAdd} className={ADD_BTN}>
              <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              Add service
            </button>
          </div>
        </div>

        {/* ── Table ── */}
        <div className={PANEL}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
            <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
              {hasFilters
                ? `${filtered.length} of ${services.length} shown`
                : `${services.length} service${services.length === 1 ? "" : "s"} · ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`}
            </p>
            <div className="flex items-center gap-2 text-[14px]">
              {hasFilters && (
                <>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={`font-bold text-[hsl(var(--primary))] underline ${FOCUS_RING}`}
                  >
                    Clear filters
                  </button>
                  <span aria-hidden="true" className="text-[hsl(var(--muted-foreground))]">·</span>
                </>
              )}
              <button type="button" onClick={expandAll} className={`font-bold text-[hsl(var(--primary))] underline ${FOCUS_RING}`}>
                Expand all
              </button>
              <span aria-hidden="true" className="text-[hsl(var(--muted-foreground))]">·</span>
              <button type="button" onClick={collapseAll} className={`font-bold text-[hsl(var(--primary))] underline ${FOCUS_RING}`}>
                Collapse all
              </button>
            </div>
          </div>
          <div className={`${TABLE_HEAD} ${ROW_GRID}`}>
            <span>Service</span>
            <span>Pricing</span>
            <span>Price</span>
            <span className="text-right">Action</span>
          </div>

          {loading ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
              <span className="sr-only">Loading</span>
            </div>
          ) : grouped.length === 0 ? (
            <div className="p-14 text-center">
              <Stethoscope className="mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <p className="mt-3 text-[14px] font-bold">
                {hasFilters ? "No services match your filters" : "No services yet"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[hsl(var(--muted-foreground))]">
                {hasFilters
                  ? "Try a different term, or clear the filters to see everything."
                  : "Add the treatments your clinic offers so they can be booked and billed."}
              </p>
              {hasFilters ? (
                <button onClick={clearFilters} className={`${OUTLINE_BTN} mx-auto mt-4`}>
                  Clear filters
                </button>
              ) : (
                <button onClick={openAdd} className={`${ADD_BTN} mx-auto mt-4`}>
                  Add your first service
                </button>
              )}
            </div>
          ) : (
            grouped.map((group) => {
              const closed = isClosed(group.category);
              const panelId = `svc-group-${group.category.replace(/\W+/g, "-")}`;
              return (
                <section key={group.category}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.category)}
                    aria-expanded={!closed}
                    aria-controls={panelId}
                    disabled={searching}
                    className={`flex w-full items-center gap-2.5 border-t border-[hsl(var(--border)/.7)] bg-[hsl(var(--muted)/.4)] px-5 py-3 text-left text-[14px] transition hover:bg-[hsl(var(--muted)/.6)] disabled:cursor-default lg:px-6 ${FOCUS_RING}`}
                  >
                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      className={`shrink-0 text-[hsl(var(--muted-foreground))] transition-transform ${closed ? "-rotate-90" : ""}`}
                    />
                    <span className="font-bold">{group.category}</span>
                    <span className="font-medium text-[hsl(var(--muted-foreground))]">
                      {group.items.length} service{group.items.length === 1 ? "" : "s"}
                    </span>
                    {group.uncategorized && (
                      <span className="font-medium text-[hsl(var(--muted-foreground))]">
                        · edit a service to give it a category
                      </span>
                    )}
                  </button>

                  {!closed && (
                    <div id={panelId}>
                      {group.items.map((s) => (
                        <div
                          key={s.id}
                          className={`grid gap-3 border-t border-[hsl(var(--border)/.55)] px-5 py-3.5 transition hover:bg-[hsl(var(--muted)/.35)] lg:items-center lg:gap-4 lg:px-6 ${ROW_GRID}`}
                        >
                          <p className="min-w-0 text-[14px] font-bold">{s.name}</p>

                          <div>
                            <span className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-bold ${
                              PRICING_PILL[s.pricing_type] ?? PRICING_PILL.variable
                            }`}>
                              {s.pricing_type === "weight_tiered" && <Scale size={13} aria-hidden="true" />}
                              {PRICING_LABEL[s.pricing_type]}
                            </span>
                          </div>

                          <div className="min-w-0">{renderPrice(s)}</div>

                          <div className="flex items-center justify-start gap-1 lg:justify-end">
                            <button
                              onClick={() => openEdit(s)}
                              aria-label={`Edit ${s.name}`}
                              className={`flex h-9 items-center justify-center rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-4 text-[14px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}

          {!loading && grouped.length > 0 && (
            <div className="border-t border-[hsl(var(--border)/.7)] px-6 py-3.5">
              <p className="text-[14px] text-[hsl(var(--muted-foreground))]">
                Showing <strong className="text-[hsl(var(--foreground))]">{filtered.length}</strong> of {services.length} service{services.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open && !saving) closeDialog(); }}>
        <DialogContent className="!flex max-h-[94vh] max-w-[520px] flex-col gap-0 overflow-hidden rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))] p-0 [&>button]:hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-3 pt-6">
            <DialogTitle asChild>
              <h2 className="text-[28px] font-bold leading-[34px] tracking-[-.02em]">
                {editTarget ? "Edit service" : "Add service"}
              </h2>
            </DialogTitle>
            <DialogDescription className="sr-only">
              {editTarget
                ? "Change this service's name, category and price."
                : "Enter the name, category and price for a new service."}
            </DialogDescription>
            <button
              onClick={closeDialog}
              disabled={saving}
              className={`rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4 pt-2">
            <FloatInput label="Service name" value={name} onChange={setName} autoComplete="off" />

            <div>
              <FloatSelect label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="" />
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </FloatSelect>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[14px] text-[hsl(var(--muted-foreground))]">
                  {categories.length === 0 ? "No categories yet. Use Manage to add the first one." : "Category not listed?"}
                </p>
                <button type="button" onClick={() => setShowManageCategories(true)} className={TEXT_ACTION}>
                  Manage
                </button>
              </div>
            </div>

            <FloatSelect
              label="How it's priced"
              value={pricingType}
              onChange={(e) => setPricingType(e.target.value as typeof pricingType)}
            >
              <option value="flat">Fixed price — same for every pet</option>
              <option value="weight_tiered">By pet weight — price per weight range</option>
              <option value="variable">Set at billing — price entered at the visit</option>
            </FloatSelect>

            {pricingType === "flat" && (
              <div>
                <FloatInput label="Price (₱)" type="number" min="1" step="1" inputMode="numeric" value={price} onChange={setPrice} />
                {price !== "" && !priceOk ? (
                  <p role="alert" className="mt-1.5 px-1 text-[14px] text-[hsl(var(--destructive))]">Needs a whole amount above ₱0, like 150.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                    {[50, 100, 500].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPrice(String((parseInt(price, 10) || 0) + n))}
                        className={`h-8 rounded-full border-[1.5px] border-[hsl(var(--primary))] px-3 text-[14px] font-bold text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                      >
                        +{n}
                      </button>
                    ))}
                    <span className="text-[14px] text-[hsl(var(--muted-foreground))]">Whole pesos only, like 150.</span>
                  </div>
                )}
              </div>
            )}

            {pricingType === "weight_tiered" && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[16px] font-bold">Weight tiers</span>
                  <button type="button" onClick={addTier} className={TEXT_ACTION}>Add tier</button>
                </div>
                <div className="space-y-3">
                  {tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2">
                      <FloatInput label="From (kg)" type="number" min="0" step="1" inputMode="numeric" value={String(t.min_weight)} onChange={(v) => updateTier(i, "min_weight", parseInt(v, 10) || 0)} />
                      <FloatInput label="To (kg)" type="number" min="0" step="1" inputMode="numeric" value={String(t.max_weight)} onChange={(v) => updateTier(i, "max_weight", parseInt(v, 10) || 0)} />
                      <FloatInput label="Price (₱)" type="number" min="0" step="1" inputMode="numeric" value={String(t.price)} onChange={(v) => updateTier(i, "price", parseInt(v, 10) || 0)} />
                      <button
                        type="button"
                        onClick={() => removeTier(i)}
                        disabled={tiers.length === 1}
                        aria-label="Remove tier"
                        className="px-1 py-2 text-[14px] font-bold text-[hsl(var(--destructive))] hover:underline disabled:opacity-30 disabled:no-underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                {rangeProblem && (
                  <p role="alert" className="mt-2 px-1 text-[14px] text-[hsl(var(--destructive))]">{rangeProblem}</p>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[hsl(var(--card-border))] px-6 pb-5 pt-3">
            {editTarget && (
              <button
                type="button"
                onClick={() => setDeleteTarget(editTarget)}
                disabled={saving}
                className={`mr-auto rounded-full px-2 py-2 text-[15px] font-bold text-[hsl(var(--destructive))] hover:underline ${FOCUS_RING}`}
              >
                Delete service
              </button>
            )}
            <button onClick={closeDialog} disabled={saving} className={BTN_OUTLINE}>Cancel</button>
            <button onClick={handleSave} disabled={saving || !canSave} className={BTN_SOLID}>
              {saving
                ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
                : editTarget ? "Save changes" : "Add service"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
      >
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold tracking-[-.02em]">{deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete service?"}</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              It will be removed from the service list and can no longer be added to invoices.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={`${BTN_OUTLINE} mt-0`} disabled={deleting}>Keep service</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="h-12 rounded-full bg-[hsl(var(--destructive))] px-6 text-[16px] font-bold text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              {deleting ? "Deleting…" : "Delete service"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ManageServiceCategoriesDialog
        open={showManageCategories}
        onClose={() => setShowManageCategories(false)}
        categories={categories}
        services={services}
        onAdded={(n) => { if (showDialog) setCategory(n); }}
        onRenamed={(o, n) => {
          setCategory((cur) => (cur === o ? n : cur));
          setCategoryFilter((cur) => (cur === o ? n : cur));
        }}
        onDeleted={(n, to) => {
          setCategory((cur) => (cur === n ? (to ?? "") : cur));
          setCategoryFilter((cur) => (cur === n ? "" : cur));
        }}
      />
    </AdminLayout>
  );
}
