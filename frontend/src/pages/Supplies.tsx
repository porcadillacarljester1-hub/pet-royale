import { useState, useRef, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchInventory, updateStock, addInventoryItem,
  updateInventoryItem, deleteInventoryItem, uploadProductImage,
} from "@/api/inventory";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, X, Pencil, Trash2, Minus, Box, Layers, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getProductImage } from "@/components/InventoryCard";
import type { InventoryItem } from "@/types";
import { useAdminStore } from "@/store/adminStore";

/* ── Shared button/field classes, on the same hsl(var(--…)) tokens as
   Appointments, Billing and Services — not a separate palette. ── */
const BTN_PRIMARY = "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[hsl(var(--primary))] px-4 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:opacity-40";
const BTN_GHOST = "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]";
const BTN_QUIET = "inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-bold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]";
const FIELD = "rounded-xl border-[hsl(var(--input))] focus-visible:ring-[hsl(var(--primary)/.2)] focus-visible:border-[hsl(var(--primary))]";

/* Sentence case, matching how every dialog field label actually looks
   elsewhere in the app (the reschedule dialog, the payment form) —
   full-contrast text, no uppercase treatment. Table headers keep the
   tracked small-caps convention, since that's genuinely how this app's
   tables are headed. */
const FORM_LABEL = "mb-2 block text-[13px] font-bold";
const TABLE_LABEL = "text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]";

const CATEGORIES = ["Vaccine", "Deworming", "Parenteral/Injectable", "Oral Medication", "Topical Medication"];
const LOW_STOCK_THRESHOLD = 10;

/* Category had five colours — blue, green, purple, amber, teal — none of
   which meant anything. It's a grouping, not a state, so it's neutral
   now and colour is left to the stock status, which reuses the exact
   hue families already meaning "good / needs attention / urgent" on
   Appointments and Billing (green / amber / terracotta), rather than
   inventing a fresh palette for the same three ideas. */
function stockStatus(stock: number) {
  if (stock === 0) return { label: "Out of stock", pill: "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]" };
  if (stock <= LOW_STOCK_THRESHOLD) return { label: "Low stock", pill: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]" };
  return { label: "In stock", pill: "bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]" };
}

/* Same shape as the StatCard on Billing, so the two pages' overview
   cards are literally the same component in different clothes rather
   than two independently designed card styles. */
function StatCard({
  icon: Icon, accent, label, value, caption,
}: { icon: React.ElementType; accent: string; label: string; value: string | number; caption: string }) {
  return (
    <div className="workspace-card rounded-[24px] p-5">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
          {label}
        </p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>
          <Icon size={17} />
        </span>
      </div>
      <p className="mt-5 text-[26px] font-bold tracking-[-.05em]">{value}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{caption}</p>
    </div>
  );
}

export default function Supplies() {
  const queryClient = useQueryClient();
  const currentUserId = useAdminStore((s) => s.id);
  const { data: inventory = [], isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
  });

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newStock, setNewStock] = useState("");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);

  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /* Quick adjust used to write on every click, and every write logs an
     inventory_logs row — so adding twelve units sent twelve requests and
     put twelve entries in History for one restock. Clicks now accumulate
     locally and flush once the person stops. */
  const [pending, setPending] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const t = timers.current;
    return () => { Object.values(t).forEach(clearTimeout); };
  }, []);

  const displayStock = (item: InventoryItem) =>
    pending[item.id] !== undefined ? pending[item.id] : (item.stock || 0);

  const adjustStock = (item: InventoryItem, delta: number) => {
    const next = Math.max(0, displayStock(item) + delta);
    setPending((p) => ({ ...p, [item.id]: next }));

    clearTimeout(timers.current[item.id]);
    timers.current[item.id] = setTimeout(async () => {
      try {
        await updateStock(item.id, next, currentUserId);
        queryClient.invalidateQueries({ queryKey: ["inventory"] });
      } catch {
        toast.error(`Couldn't update stock for ${item.name}.`);
      } finally {
        setPending((p) => {
          const { [item.id]: _drop, ...rest } = p;
          return rest;
        });
      }
    }, 700);
  };

  const filtered = inventory.filter((i) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || i.name.toLowerCase().includes(q);
    const matchesCategory = categoryFilter === "all" || i.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const totalItems = inventory.length;
  const totalUnits = inventory.reduce((sum, i) => sum + (i.stock || 0), 0);
  // Split so "out of stock" isn't buried inside "low stock", which is
  // what the single count did — an item at zero looked merely low.
  const lowStockCount = inventory.filter((i) => (i.stock || 0) > 0 && (i.stock || 0) <= LOW_STOCK_THRESHOLD).length;
  const outOfStockCount = inventory.filter((i) => (i.stock || 0) === 0).length;

  const hasFilters = !!search || categoryFilter !== "all";
  const clearFilters = () => { setSearch(""); setCategoryFilter("all"); };

  const handleImageSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: (f: File | null) => void,
    setPreview: (v: string | null) => void
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      setFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const resetAddForm = () => {
    setNewName(""); setNewCategory(""); setNewStock("");
    setNewImageFile(null); setNewImagePreview(null);
  };

  const handleAdd = async () => {
    if (!newName || !newCategory || !newStock) {
      toast.error("Please fill in name, category and starting stock.");
      return;
    }
    setLoading(true);
    try {
      let imageKey = "";
      if (newImageFile) imageKey = await uploadProductImage(newImageFile);
      await addInventoryItem({
        name: newName,
        category: newCategory,
        stock: parseInt(newStock) || 0,
        image_key: imageKey,
      });
      toast.success("Supply added to inventory.");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setShowAdd(false);
      resetAddForm();
    } catch { toast.error("Failed to add supply."); } finally { setLoading(false); }
  };

  const openEdit = (item: InventoryItem) => {
    setEditItem(item);
    setEditName(item.name);
    setEditCategory(item.category);
    setEditStock(String(item.stock));
    setEditImageFile(null);
    setEditImagePreview(null);
  };

  const handleEdit = async () => {
    if (!editItem || !editName || !editCategory || editStock === "") {
      toast.error("Please fill in name, category and stock.");
      return;
    }
    setLoading(true);
    try {
      let imageKey = editItem.image_key;
      if (editImageFile) imageKey = await uploadProductImage(editImageFile);
      await updateInventoryItem(editItem.id, {
        name: editName,
        category: editCategory,
        stock: Math.max(0, parseInt(editStock) || 0),
        image_key: imageKey,
      }, currentUserId);
      toast.success("Supply updated.");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setEditItem(null);
    } catch { toast.error("Failed to update supply."); } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteInventoryItem(deleteId);
      toast.success("Supply removed from inventory.");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setDeleteId(null);
    } catch { toast.error("Failed to delete supply."); }
  };

  const deleteTargetName = inventory.find((i) => i.id === deleteId)?.name;

  return (
    <AdminLayout title="Supplies" eyebrow="Clinic-use stock for veterinary services and appointments">
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        {/* Four cards, not three — out of stock was folded into the low
            stock count, so an item at zero didn't register as urgent. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Box} accent="bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"
            label="Items Tracked" value={totalItems} caption="Distinct supplies"
          />
          <StatCard
            icon={Layers} accent="bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"
            label="Total Units" value={totalUnits.toLocaleString()} caption="Across all supplies"
          />
          <StatCard
            icon={AlertTriangle} accent="bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]"
            label="Running Low" value={lowStockCount} caption={`1–${LOW_STOCK_THRESHOLD} units left`}
          />
          <StatCard
            icon={X} accent="bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]"
            label="Out of Stock" value={outOfStockCount} caption="Needs restocking"
          />
        </div>

        <div className="workspace-card overflow-hidden rounded-[26px]">

          {/* Search, filter and Add together. */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--border)/.7)] p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search supplies by name…"
                className="h-9 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-9 pr-3 text-sm text-[hsl(var(--foreground))] outline-none transition-shadow placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 w-[200px] rounded-xl border-[hsl(var(--input))]"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {hasFilters && <button onClick={clearFilters} className={BTN_QUIET}>Clear</button>}

            <button onClick={() => setShowAdd(true)} className={`${BTN_PRIMARY} ml-auto`}>
              <Plus className="h-4 w-4" /> Add supply
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                <Box className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </div>
              <p className="text-sm font-bold">
                {hasFilters ? "No supplies match these filters" : "No supplies tracked yet"}
              </p>
              <p className="mx-auto mt-1.5 max-w-[300px] text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                {hasFilters
                  ? "Try a different search term or category."
                  : "Add the medicines and materials the clinic keeps on hand."}
              </p>
              {hasFilters ? (
                <button onClick={clearFilters} className={`${BTN_GHOST} mt-4`}>Clear filters</button>
              ) : (
                <button onClick={() => setShowAdd(true)} className={`${BTN_PRIMARY} mt-4`}>
                  <Plus className="h-4 w-4" /> Add your first supply
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border)/.7)] bg-[hsl(var(--muted)/.5)]">
                    <th scope="col" className={`${TABLE_LABEL} py-3 pl-5 pr-3 text-left`}>Supply</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[200px] px-3 py-3 text-left`}>Category</th>
                    {/* The old table had a Stock column and a Quick Adjust
                        column printing the same number twice. The
                        adjuster is the stock display now. */}
                    <th scope="col" className={`${TABLE_LABEL} w-[150px] px-3 py-3 text-left`}>Units on hand</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[130px] px-3 py-3 text-left`}>Status</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[100px] py-3 pl-3 pr-5 text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const img = getProductImage(item.image_key);
                    const stock = displayStock(item);
                    const status = stockStatus(stock);
                    const isSyncing = pending[item.id] !== undefined;
                    return (
                      <tr key={item.id} className="border-b border-[hsl(var(--border)/.55)] transition last:border-0 hover:bg-[hsl(var(--muted)/.35)]">
                        <td className="py-3.5 pl-5 pr-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)]">
                              {img
                                ? <img src={img} alt="" className="h-full w-full object-contain p-1" />
                                : <Box className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />}
                            </div>
                            <span className="truncate font-semibold">{item.name}</span>
                          </div>
                        </td>

                        <td className="px-3 py-3.5">
                          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                            {item.category}
                          </span>
                        </td>

                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => adjustStock(item, -1)}
                              disabled={stock === 0}
                              aria-label={`Reduce ${item.name} by one`}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-10 text-center font-mono font-bold tabular-nums">{stock}</span>
                            <button
                              onClick={() => adjustStock(item, 1)}
                              aria-label={`Add one to ${item.name}`}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            {isSyncing && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" />}
                          </div>
                        </td>

                        <td className="px-3 py-3.5">
                          <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${status.pill}`}>
                            {status.label}
                          </span>
                        </td>

                        <td className="py-3.5 pl-3 pr-5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(item)}
                              title="Edit supply" aria-label={`Edit ${item.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--primary)/.1)] hover:text-[hsl(var(--primary))]"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeleteId(item.id)}
                              title="Delete supply" aria-label={`Delete ${item.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="border-t border-[hsl(var(--border)/.7)] px-5 py-3.5">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Showing <span className="font-semibold text-[hsl(var(--foreground))]">{filtered.length}</span> of {inventory.length} suppl{inventory.length === 1 ? "y" : "ies"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add dialog */}
      <Dialog open={showAdd} onOpenChange={(open) => { if (!open) { setShowAdd(false); resetAddForm(); } }}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-0 [&>button]:hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--border)/.7)] px-6 pb-5 pt-6">
            <h2 className="font-sidebar text-lg font-bold leading-none">Add supply</h2>
            <button
              onClick={() => { setShowAdd(false); resetAddForm(); }}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <label className={FORM_LABEL}>Supply name</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Rabies Vaccine 1ml" className={FIELD} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={FORM_LABEL}>Category</label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger className="rounded-xl border-[hsl(var(--input))]"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className={FORM_LABEL}>Starting stock</label>
                <Input type="number" value={newStock} onChange={(e) => setNewStock(e.target.value)} placeholder="0" className={FIELD} />
              </div>
            </div>

            <div>
              <label className={FORM_LABEL}>
                Photo <span className="text-[hsl(var(--muted-foreground))] font-medium">(optional)</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)]">
                  {newImagePreview
                    ? <img src={newImagePreview} alt="" className="h-full w-full object-contain p-1" />
                    : <Box className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />}
                </div>
                <Input type="file" accept="image/*" onChange={(e) => handleImageSelect(e, setNewImageFile, setNewImagePreview)} className={`${FIELD} flex-1`} />
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-[hsl(var(--border)/.7)] px-6 pb-6 pt-3">
            <button onClick={() => { setShowAdd(false); resetAddForm(); }} className={BTN_QUIET}>Cancel</button>
            <button onClick={handleAdd} disabled={loading} className={BTN_PRIMARY}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</> : "Add supply"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(open) => { if (!open) setEditItem(null); }}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-0 [&>button]:hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--border)/.7)] px-6 pb-5 pt-6">
            <h2 className="font-sidebar text-lg font-bold leading-none">Edit supply</h2>
            <button
              onClick={() => setEditItem(null)}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <label className={FORM_LABEL}>Supply name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className={FIELD} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={FORM_LABEL}>Category</label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger className="rounded-xl border-[hsl(var(--input))]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className={FORM_LABEL}>Units on hand</label>
                <Input type="number" value={editStock} onChange={(e) => setEditStock(e.target.value)} className={FIELD} />
              </div>
            </div>

            <div>
              <label className={FORM_LABEL}>
                Photo <span className="text-[hsl(var(--muted-foreground))] font-medium">(optional)</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)]">
                  {editImagePreview
                    ? <img src={editImagePreview} alt="" className="h-full w-full object-contain p-1" />
                    : getProductImage(editItem?.image_key || "")
                      ? <img src={getProductImage(editItem!.image_key)} alt="" className="h-full w-full object-contain p-1" />
                      : <Box className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />}
                </div>
                <Input type="file" accept="image/*" onChange={(e) => handleImageSelect(e, setEditImageFile, setEditImagePreview)} className={`${FIELD} flex-1`} />
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-[hsl(var(--border)/.7)] px-6 pb-6 pt-3">
            <button onClick={() => setEditItem(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={handleEdit} disabled={loading} className={BTN_PRIMARY}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sidebar text-lg font-bold">Delete this supply?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              {/* Names the item — the old copy just said "this supply". */}
              <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTargetName}</span> will be removed from
              inventory. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep supply</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="rounded-xl bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              Delete supply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
