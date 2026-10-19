import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProducts, addProduct, updateProduct, toggleProductAvailability,
  deleteProduct, uploadProductPhoto, recordProductSale,
  PRODUCT_CATEGORIES, type Product,
} from "@/api/products";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, Plus, X, Pencil, Trash2, Package, AlertTriangle, EyeOff,
  Loader2, Store, Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { useAdminStore } from "@/store/adminStore";

/* ── Shared button/field classes, on the same hsl(var(--…)) tokens as
   Appointments, Billing, Services and Supplies — not a separate
   palette. ── */
const BTN_PRIMARY = "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[hsl(var(--primary))] px-4 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:opacity-40";
const BTN_GHOST = "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]";
const BTN_QUIET = "inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-bold text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]";
const FIELD = "rounded-xl border-[hsl(var(--input))] focus-visible:ring-[hsl(var(--primary)/.2)] focus-visible:border-[hsl(var(--primary))]";

/* Sentence case, matching how every dialog field label actually looks
   elsewhere in the app — full-contrast text, no uppercase treatment.
   Table headers keep the tracked small-caps convention, since that's
   genuinely how this app's tables are headed. */
const FORM_LABEL = "mb-2 block text-[13px] font-bold";
const TABLE_LABEL = "text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]";

const LOW_STOCK_THRESHOLD = 10;

/* Only flags the two states that need attention — a healthy stock level
   intentionally renders no badge at all, so the table isn't wallpapered
   in green pills for the common case. Same hue families as everywhere
   else "needs attention / urgent" is signaled (amber / terracotta). */
function stockStatus(stock: number) {
  if (stock === 0) return { label: "Out of stock", pill: "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]" };
  if (stock <= LOW_STOCK_THRESHOLD) return { label: "Low stock", pill: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]" };
  return null;
}

/* Same shape as the StatCard on Billing and Supplies. */
function StatCard({
  icon: Icon, accent, label, value, caption,
}: { icon: React.ElementType; accent: string; label: string; value: number; caption: string }) {
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

export default function PetEssentials() {
  const queryClient = useQueryClient();
  const currentStaffId = useAdminStore((s) => s.staffId);
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");

  const [showAdd, setShowAdd] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [stock, setStock] = useState("");
  const [costPrice, setCostPrice] = useState("");

  const [showRecordSale, setShowRecordSale] = useState(false);
  const [saleProduct, setSaleProduct] = useState<Product | null>(null);
  const [saleQuantity, setSaleQuantity] = useState("1");
  const [recordingSale, setRecordingSale] = useState(false);

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || p.name.toLowerCase().includes(q);
    const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
    const matchesAvailability =
      availabilityFilter === "all" ||
      (availabilityFilter === "available" && p.is_available) ||
      (availabilityFilter === "hidden" && !p.is_available);
    return matchesSearch && matchesCategory && matchesAvailability;
  });

  const totalProducts = products.length;
  const listedCount = products.filter((p) => p.is_available).length;
  const lowStockCount = products.filter((p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= LOW_STOCK_THRESHOLD).length;
  const unavailableCount = products.filter((p) => !p.is_available).length;

  const hasFilters = !!search || categoryFilter !== "all" || availabilityFilter !== "all";
  const resetFilters = () => { setSearch(""); setCategoryFilter("all"); setAvailabilityFilter("all"); };

  const resetForm = () => {
    setName(""); setCategory(""); setPrice(""); setStock(""); setCostPrice(""); setDescription("");
    setImageFile(null); setImagePreview(null);
  };

  const openAdd = () => { resetForm(); setEditProduct(null); setShowAdd(true); };

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setName(p.name);
    setCategory(p.category);
    setPrice(String(p.price));
    setStock(String(p.stock ?? 0));
    setCostPrice(String(p.cost_price ?? 0));
    setDescription(p.description || "");
    setImageFile(null);
    setImagePreview(p.image_url);
    setShowAdd(true);
  };

  const closeDialog = () => { setShowAdd(false); setEditProduct(null); resetForm(); };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!name || !category || !price) {
      toast.error("Please fill in name, category and price.");
      return;
    }
    setLoading(true);
    try {
      let imageUrl = editProduct?.image_url || null;
      if (imageFile) imageUrl = await uploadProductPhoto(imageFile);
      const input = {
        name,
        category,
        price: parseFloat(price) || 0,
        cost_price: parseFloat(costPrice) || 0,
        stock: parseInt(stock) || 0,
        description: description || null,
        image_url: imageUrl,
      };
      if (editProduct) {
        await updateProduct(editProduct.id, input, currentStaffId);
        toast.success("Product updated.");
      } else {
        await addProduct(input);
        toast.success("Product added.");
      }
      queryClient.invalidateQueries({ queryKey: ["products"] });
      closeDialog();
    } catch { toast.error("Failed to save product."); } finally { setLoading(false); }
  };

  const handleToggleAvailability = async (p: Product) => {
    if ((p.stock ?? 0) === 0 && !p.is_available) {
      toast.error("Out of stock — restock this item before listing it.");
      return;
    }
    try {
      await toggleProductAvailability(p.id, !p.is_available);
      toast.success(p.is_available ? `${p.name} is hidden from the app.` : `${p.name} is now listed.`);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch { toast.error("Failed to update availability."); }
  };

  const handleRecordSale = async () => {
    if (!saleProduct) return;
    if (!currentStaffId) {
      toast.error("Your staff profile is not linked to this dashboard session. Log in again or contact the clinic admin.");
      return;
    }
    const qty = parseInt(saleQuantity);
    if (!qty || qty < 1) { toast.error("Enter a quantity of at least 1."); return; }
    if (qty > (saleProduct.stock ?? 0)) { toast.error(`Only ${saleProduct.stock} in stock.`); return; }

    setRecordingSale(true);
    try {
      await recordProductSale(saleProduct.id, qty, currentStaffId);
      toast.success(`Sale recorded: ${qty} × ${saleProduct.name}`);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setShowRecordSale(false);
      setSaleProduct(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to record sale.");
    } finally { setRecordingSale(false); }
  };

  const handleDelete = async () => {
    if (!deleteProductId) return;
    try {
      await deleteProduct(deleteProductId);
      toast.success("Product deleted.");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setDeleteProductId(null);
    } catch { toast.error("Failed to delete product."); }
  };

  const deleteTargetName = products.find((p) => p.id === deleteProductId)?.name;

  return (
    <AdminLayout title="Pet Essentials" eyebrow="Retail products sold to pet owners through the mobile app">
      <div className="mx-auto max-w-[1440px] space-y-5 px-5 py-7 sm:px-8 lg:px-10">

        {/* "Total Products / Visible to clients in the app" counted every
            product including the hidden ones — which by definition aren't
            visible. Split into a total and a listed count. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Package} accent="bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"
            label="Products" value={totalProducts} caption="In the catalogue"
          />
          <StatCard
            icon={Store} accent="bg-[hsl(145_42%_88%)] text-[hsl(145_42%_27%)]"
            label="Listed in App" value={listedCount} caption="Clients can buy these"
          />
          <StatCard
            icon={AlertTriangle} accent="bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]"
            label="Running Low" value={lowStockCount} caption={`1–${LOW_STOCK_THRESHOLD} units left`}
          />
          <StatCard
            icon={EyeOff} accent="bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]"
            label="Hidden" value={unavailableCount} caption="Not shown in the app"
          />
        </div>

        <div className="workspace-card overflow-hidden rounded-[26px]">

          {/* Filters and Add together. */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--border)/.7)] p-4">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products by name…"
                className="h-9 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-9 pr-3 text-sm text-[hsl(var(--foreground))] outline-none transition-shadow placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 w-[170px] rounded-xl border-[hsl(var(--input))]"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {PRODUCT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
              <SelectTrigger className="h-9 w-[150px] rounded-xl border-[hsl(var(--input))]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                <SelectItem value="available">Listed only</SelectItem>
                <SelectItem value="hidden">Hidden only</SelectItem>
              </SelectContent>
            </Select>

            {hasFilters && <button onClick={resetFilters} className={BTN_QUIET}>Clear</button>}

            <button onClick={openAdd} className={`${BTN_PRIMARY} ml-auto`}>
              <Plus className="h-4 w-4" /> Add product
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                <Package className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
              </div>
              <p className="text-sm font-bold">
                {hasFilters ? "No products match these filters" : "No products yet"}
              </p>
              <p className="mx-auto mt-1.5 max-w-[300px] text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                {hasFilters
                  ? "Try a different search term, category or availability."
                  : "Add the retail items your clinic sells to pet owners."}
              </p>
              {hasFilters ? (
                <button onClick={resetFilters} className={`${BTN_GHOST} mt-4`}>Clear filters</button>
              ) : (
                <button onClick={openAdd} className={`${BTN_PRIMARY} mt-4`}>
                  <Plus className="h-4 w-4" /> Add your first product
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] table-fixed border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border)/.7)] bg-[hsl(var(--muted)/.5)]">
                    <th scope="col" className={`${TABLE_LABEL} py-3 pl-5 pr-3 text-left`}>Product</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[150px] px-3 py-3 text-left`}>Category</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[110px] px-3 py-3 text-left`}>Price</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[140px] px-3 py-3 text-left`}>Stock</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[130px] px-3 py-3 text-left`}>Listed in app</th>
                    <th scope="col" className={`${TABLE_LABEL} w-[170px] py-3 pl-3 pr-5 text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const stockCount = p.stock ?? 0;
                    const status = stockStatus(stockCount);
                    const isOutOfStock = stockCount === 0;
                    return (
                      <tr key={p.id} className="border-b border-[hsl(var(--border)/.55)] transition last:border-0 hover:bg-[hsl(var(--muted)/.35)]">
                        <td className="py-3.5 pl-5 pr-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)]">
                              {p.image_url
                                ? <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                                : <Package className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />}
                            </div>
                            <span className="truncate font-semibold">{p.name}</span>
                          </div>
                        </td>

                        <td className="px-3 py-3.5">
                          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                            {p.category}
                          </span>
                        </td>

                        <td className="px-3 py-3.5 font-mono font-semibold tabular-nums">
                          ₱{p.price.toLocaleString()}
                        </td>

                        <td className="px-3 py-3.5">
                          <p className="font-mono font-bold tabular-nums">{stockCount}</p>
                          {status && (
                            <span className={`mt-1 inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.pill}`}>
                              {status.label}
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-3.5">
                          {/* Labelled, and it says why it's blocked rather
                              than only refusing when clicked. */}
                          <button
                            onClick={() => handleToggleAvailability(p)}
                            disabled={isOutOfStock && !p.is_available}
                            role="switch"
                            aria-checked={p.is_available}
                            aria-label={`${p.name} is ${p.is_available ? "listed" : "hidden"}`}
                            title={isOutOfStock && !p.is_available ? "Out of stock — restock to list this" : undefined}
                            className="group inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                              p.is_available ? "bg-[hsl(145_42%_35%)]" : "bg-[hsl(var(--border))]"
                            }`}>
                              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                p.is_available ? "translate-x-[19px]" : "translate-x-[3px]"
                              }`} />
                            </span>
                            <span className={`text-xs font-medium ${
                              p.is_available ? "text-[hsl(145_42%_27%)]" : "text-[hsl(var(--muted-foreground))]"
                            }`}>
                              {p.is_available ? "Listed" : "Hidden"}
                            </span>
                          </button>
                        </td>

                        <td className="py-3.5 pl-3 pr-5">
                          <div className="flex items-center justify-end gap-1">
                            {/* Was a filled primary button on every row, so
                                the page had one primary action per product
                                competing with Add product. Bordered now —
                                still the most prominent thing in the row,
                                without six of them shouting at once. */}
                            <button
                              onClick={() => { setSaleProduct(p); setSaleQuantity("1"); setShowRecordSale(true); }}
                              disabled={isOutOfStock}
                              className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[hsl(var(--primary)/.3)] bg-[hsl(var(--primary)/.08)] px-3 text-xs font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)/.14)] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Receipt className="h-3.5 w-3.5" /> Record sale
                            </button>
                            <button
                              onClick={() => openEdit(p)}
                              title="Edit product" aria-label={`Edit ${p.name}`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeleteProductId(p.id)}
                              title="Delete product" aria-label={`Delete ${p.name}`}
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
                Showing <span className="font-semibold text-[hsl(var(--foreground))]">{filtered.length}</span> of {products.length} product{products.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={showAdd} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-0 [&>button]:hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--border)/.7)] px-6 pb-5 pt-6">
            <h2 className="font-sidebar text-lg font-bold leading-none">
              {editProduct ? "Edit product" : "Add product"}
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
              <label className={FORM_LABEL}>Product name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Royal Canin Mini Adult 1.5kg" className={FIELD} />
            </div>

            <div>
              <label className={FORM_LABEL}>Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="rounded-xl border-[hsl(var(--input))]"><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Paired so the dialog isn't seven stacked fields tall */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={FORM_LABEL}>Selling price (₱)</label>
                <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className={FIELD} />
              </div>
              <div>
                <label className={FORM_LABEL}>Cost per unit (₱)</label>
                <Input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0" className={FIELD} />
                <p className="mt-1.5 text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">What it costs you. Used for profit in Reports.</p>
              </div>
            </div>

            <div>
              <label className={FORM_LABEL}>Stock quantity</label>
              <Input type="number" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" className={FIELD} />
            </div>

            <div>
              <label className={FORM_LABEL}>
                Photo <span className="text-[hsl(var(--muted-foreground))] font-medium">(optional)</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)]">
                  {imagePreview
                    ? <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                    : <Package className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />}
                </div>
                <Input type="file" accept="image/*" onChange={handleImageSelect} className={`${FIELD} flex-1`} />
              </div>
            </div>

            <div>
              <label className={FORM_LABEL}>
                Description <span className="text-[hsl(var(--muted-foreground))] font-medium">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Shown to clients in the app"
                className="w-full resize-none rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.2)]"
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-[hsl(var(--border)/.7)] px-6 pb-6 pt-3">
            <button onClick={closeDialog} className={BTN_QUIET}>Cancel</button>
            <button onClick={handleSave} disabled={loading} className={BTN_PRIMARY}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : editProduct ? "Save changes" : "Add product"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record sale */}
      <Dialog open={showRecordSale} onOpenChange={(open) => !open && setShowRecordSale(false)}>
        <DialogContent className="max-w-sm gap-0 overflow-hidden rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-0 [&>button]:hidden">
          <div className="flex items-center justify-between border-b border-[hsl(var(--border)/.7)] px-6 pb-5 pt-6">
            <h2 className="font-sidebar text-lg font-bold leading-none">Record a sale</h2>
            <button
              onClick={() => setShowRecordSale(false)}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {saleProduct && (
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] px-4 py-3">
                <p className="text-sm font-semibold">{saleProduct.name}</p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                  ₱{saleProduct.price.toLocaleString()} each · {saleProduct.stock} in stock
                </p>
              </div>

              <div>
                <label className={FORM_LABEL}>Quantity sold</label>
                <Input
                  type="number" min="1" max={saleProduct.stock}
                  value={saleQuantity}
                  onChange={(e) => setSaleQuantity(e.target.value)}
                  autoFocus
                  className={FIELD}
                />
              </div>

              <div className="flex items-center justify-between rounded-xl bg-[hsl(var(--primary)/.1)] px-4 py-3">
                <span className="text-sm font-medium text-[hsl(var(--primary))]">Total</span>
                <span className="font-mono text-lg font-bold tabular-nums text-[hsl(var(--primary))]">
                  ₱{((parseInt(saleQuantity) || 0) * saleProduct.price).toLocaleString()}
                </span>
              </div>

              <p className="text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">
                Stock drops by this amount and the sale appears in History and Reports.
              </p>
            </div>
          )}

          <DialogFooter className="px-6 pb-6 pt-1">
            <button onClick={() => setShowRecordSale(false)} className={BTN_QUIET}>Cancel</button>
            <button onClick={handleRecordSale} disabled={recordingSale} className={BTN_PRIMARY}>
              {recordingSale ? <><Loader2 className="h-4 w-4 animate-spin" /> Recording…</> : "Confirm sale"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteProductId} onOpenChange={(open) => !open && setDeleteProductId(null)}>
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--card))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sidebar text-lg font-bold">Delete this product?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              {/* Names the product — the old copy said "this product". */}
              <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTargetName}</span> will be removed from
              the catalogue and disappear from the mobile app immediately. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep product</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="rounded-xl bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              Delete product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
