import { useState, useRef, useEffect, useId } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProducts, addProduct, updateProduct, toggleProductAvailability,
  deleteProduct, uploadProductPhoto, recordProductSale,
  type Product,
} from "@/api/products";
import {
  fetchInventory, updateStock, addInventoryItem,
  updateInventoryItem, deleteInventoryItem, uploadProductImage,
} from "@/api/inventory";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, X, Minus, Box, Package, Loader2, Settings2, Check, Clock3,
  ChevronDown, Download, FileSpreadsheet, FileText, Search, MoreVertical,
} from "lucide-react";
import { toast } from "sonner";
import { getProductImage } from "@/components/InventoryCard";
import PhotoCropper from "@/components/PhotoCropper";
import type { InventoryItem } from "@/types";
import { useAdminStore } from "@/store/adminStore";
import jsPDF from "jspdf";
// jspdf-autotable v4+ must be imported and called as a function.
import autoTable from "jspdf-autotable";
// xlsx-js-style is SheetJS with cell styles and frozen panes. Install: npm i xlsx-js-style
import * as XLSX from "xlsx-js-style";

/* ══════════════════ Inventory ══════════════════
   One screen, two tabs. Pet Essentials is retail (priced, sold through
   the mobile app, "shown in app" toggle). Supplies is clinic-use stock
   (never priced, never sold). Categories live in the shared
   `categories` table, scoped by type ('product' | 'supply').

   Matches Billing and Appointments: ONE filter card (segmented status pills with count badges,
   search, category, Categories, Export menu, Add), then one table card
   with a soft header row, filled status pills, a Manage menu on each row
   and a "Showing X of Y" footer. The fields, buttons
   and table below are the same pieces those screens use.
   If either changes, move them into a shared file. */

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";

/* Same page width and side padding as Appointments, so cards line up with the
   page title on the left and the header buttons on the right. */
const PAGE_WRAP = "mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-10";

/* Compact controls, as on Appointments and Billing: 40px fields and buttons, 10px corners. */
const BTN_SM_OUTLINE = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border-[1.5px] border-[hsl(var(--primary))] bg-white px-4 text-[14px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;
const BTN_SM_SOLID = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[hsl(var(--primary))] px-5 text-[14px] font-semibold text-[hsl(var(--primary-foreground))] shadow-[0_4px_12px_rgb(5_31_66/.22)] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none ${FOCUS_RING}`;

const BTN_SOLID =
  "flex h-12 items-center justify-center gap-2 rounded-full bg-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none";
const BTN_OUTLINE =
  "h-12 rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-6 text-[16px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50";
const TEXT_ACTION = "shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--primary))] hover:underline disabled:opacity-40 disabled:no-underline";
const TEXT_DANGER = "shrink-0 px-2 py-2 text-[15px] font-bold text-[hsl(var(--destructive))] hover:underline";
const ROW_BTN = `flex h-9 items-center justify-center whitespace-nowrap rounded-lg border-[1.5px] border-[hsl(var(--primary))] bg-transparent px-3.5 text-[14px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const FIELD_ERROR = "mt-1.5 px-1 text-[14px] leading-snug text-[hsl(var(--destructive))]";

/* Dropdown panel and its items, shared by the Export menu and each row's Manage menu. */
const MENU_PANEL = "absolute right-0 top-[calc(100%+6px)] z-30 min-w-[200px] rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-1.5 shadow-[0_12px_32px_rgb(5_31_66/.18)]";
const MENU_ITEM = `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`;

/* Safety stock level (SSL): the units the clinic wants to keep on hand as a buffer.
   Every item has its own level. At or below it, the item counts as "Running low";
   at 0 it is "Out of stock". Items with no level saved yet use 10, the old fixed limit. */
const DEFAULT_SAFETY_STOCK = 10;
const safetyOf = (item: unknown): number => {
  const raw = (item as { safety_stock?: number | null } | null)?.safety_stock;
  return typeof raw === "number" && raw >= 0 ? raw : DEFAULT_SAFETY_STOCK;
};
/* 0 = out, 1 = at or below safety stock, 2 = healthy. */
const stockState = (stock: number, safety: number): 0 | 1 | 2 =>
  stock <= 0 ? 0 : stock <= safety ? 1 : 2;
/* ₱610, ₱387.78, ₱54.40 — two decimals whenever there is a fractional part. */
const peso = (n: number) =>
  "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/* Whole number, zero or more. An empty box counts as invalid here; callers
   that treat empty as 0 check for "" first. */
const isWholeNumber = (s: string) => s.trim() !== "" && Number.isInteger(Number(s)) && Number(s) >= 0;

/* The clinic's day, whatever timezone the computer is set to. */
const clinicDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/* Closes a dropdown on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null >) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

/* The ⋮ menu button on each table row, same as Appointments. */
function RowMenu({
  label, items,
}: {
  label: string;
  items: { text: string; onClick: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={`flex h-9 w-9 items-center justify-center rounded-lg text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className={MENU_PANEL}>
          {items.map((i) => (
            <button
              key={i.text}
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); i.onClick(); }}
              className={`${MENU_ITEM} ${i.danger ? "!text-[hsl(var(--destructive))]" : ""}`}
            >
              {i.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Floating-label fields, same as Appointments ── */
const FLOAT_BOX =
  "w-full rounded-[16px] border-[1.5px] border-[hsl(var(--input))] bg-[hsl(var(--card))] text-[16px] font-medium transition focus:border-[hsl(var(--primary))] focus:outline-none";

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

/* Toolbar fields, same look as Appointments: white background, magnifier on the search. */
function SearchField({
  value, onChange, placeholder, className = "",
}: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="h-10 w-full rounded-[10px] border border-[hsl(var(--input))] bg-white pl-10 pr-3 text-[14px] font-medium placeholder:font-normal placeholder:text-[hsl(var(--muted-foreground))] transition focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/.15)]"
      />
    </div>
  );
}

function SelectField({
  value, onChange, label, children, className = "",
}: {
  value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>; label: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={onChange}
        aria-label={label}
        className="h-10 w-full appearance-none rounded-[10px] border border-[hsl(var(--input))] bg-white pl-3.5 pr-9 text-[14px] font-semibold transition focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/.15)]"
      >
        {children}
      </select>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
    </div>
  );
}

/* ── Dialog pieces ──
   White surface, hairline dividers, 40px controls: the same look as the screen behind them.
   Fields have a label above them and groups have one note, not helper text on random fields. */
const DLG = "!flex max-h-[94vh] w-full flex-col gap-0 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white p-0 shadow-[0_20px_50px_rgb(5_31_66/.25)] [&>button]:hidden";
const DLG_BODY = "grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5";
const DLG_FOOT = "flex shrink-0 justify-end gap-2 border-t border-[hsl(var(--border))] px-6 py-3.5";
const FIELD_BOX = "h-10 w-full rounded-[10px] border bg-white px-3 text-[14px] font-medium placeholder:font-normal placeholder:text-[hsl(var(--muted-foreground))] transition focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/.15)] disabled:opacity-50";
const LINK_ACTION = `rounded text-[13px] font-semibold text-[hsl(var(--primary))] hover:underline ${FOCUS_RING}`;
const ROW_TEXT = `shrink-0 rounded-lg px-2 py-1.5 text-[13px] font-semibold transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 ${FOCUS_RING}`;

function DialogHead({
  title, description, showDescription, onClose, disabled,
}: { title: string; description: string; showDescription?: boolean; onClose: () => void; disabled?: boolean }) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-6 pb-4 pt-5">
      <div className="min-w-0">
        <DialogTitle asChild>
          <DialogTitle className="text-[20px] font-bold leading-[26px] tracking-[-.01em]">{title}</DialogTitle>
        </DialogTitle>
        <DialogDescription className={showDescription ? "mt-0.5 text-[13px] text-[hsl(var(--muted-foreground))]" : "sr-only"}>
          {description}
        </DialogDescription>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        aria-label="Close"
        className={`-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-50 ${FOCUS_RING}`}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function FormGroup({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[12px] font-bold uppercase tracking-[.04em] text-[hsl(var(--muted-foreground))]">{title}</h3>
      {children}
      {note && <p className="mt-2 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">{note}</p>}
    </section>
  );
}

function LabeledInput({
  label, value, onChange, error, type = "text", className = "", ...rest
}: {
  label: string; value: string; onChange: (v: string) => void; error?: string; type?: string; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const id = useId();
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold">{label}</label>
      <input
        {...rest}
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={`${FIELD_BOX} ${error ? "border-[hsl(var(--destructive))]" : "border-[hsl(var(--input))]"}`}
      />
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] leading-snug text-[hsl(var(--destructive))]">{error}</p>}
    </div>
  );
}

function LabeledSelect({
  label, value, onChange, action, children,
}: {
  label: string; value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold">{label}</label>
        {action}
      </div>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={onChange}
          className={`${FIELD_BOX} appearance-none border-[hsl(var(--input))] pr-9`}
        >
          {children}
        </select>
        <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
      </div>
    </div>
  );
}

/* ── Categories ── */
interface Category { id: string; name: string; type: "product" | "supply"; sort_order: number; }

/* Products and supplies store their category as plain text, so renaming a
   category has to rename it on every item too. These are the tables holding
   those items. If your supplies table has a different name, change it here. */
const ITEM_TABLE = { product: "products", supply: "inventory" } as const;

async function fetchCategories(type: "product" | "supply"): Promise<Category[]> {
  const { data, error } = await (supabase as any)
    .from("categories").select("*").eq("type", type).order("sort_order").order("name");
  if (error) throw error;
  return data || [];
}

async function addCategory(name: string, type: "product" | "supply") {
  const { error } = await (supabase as any).from("categories").insert([{ name: name.trim(), type }]);
  if (error) throw error;
}

/* Renames the category and every item using it. If the items can't be
   updated, the category name is put back so the two never disagree. */
async function renameCategory(id: string, oldName: string, newName: string, type: "product" | "supply") {
  const next = newName.trim();
  const { error } = await (supabase as any).from("categories").update({ name: next }).eq("id", id);
  if (error) throw error;
  const { error: itemsError } = await (supabase as any)
    .from(ITEM_TABLE[type]).update({ category: next }).eq("category", oldName);
  if (itemsError) {
    await (supabase as any).from("categories").update({ name: oldName }).eq("id", id);
    throw itemsError;
  }
}

async function deleteCategoryRow(id: string) {
  const { error } = await (supabase as any).from("categories").delete().eq("id", id);
  if (error) throw error;
}

function ManageCategoriesDialog({
  type, open, onClose, onAdded, onRenamed,
}: {
  type: "product" | "supply";
  open: boolean;
  onClose: () => void;
  onAdded?: (name: string) => void;
  onRenamed?: (oldName: string, newName: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["categories", type],
    queryFn: () => fetchCategories(type),
    enabled: open,
  });
  // Same cached lists the tabs use, to show how many items each category has.
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: fetchProducts, enabled: open && type === "product" });
  const { data: supplies = [] } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory, enabled: open && type === "supply" });
  const items: { category: string }[] = type === "product" ? products : supplies;
  const noun = type === "product" ? "product" : "suppl";
  const countFor = (name: string) => items.filter((i) => i.category === name).length;
  const countLabel = (n: number) =>
    type === "product" ? `${n} product${n === 1 ? "" : "s"}` : `${n} suppl${n === 1 ? "y" : "ies"}`;

  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isDuplicate = (name: string, exceptId?: string) =>
    categories.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

  // A rename changes item rows too, so refresh them as well.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["categories", type] });
    queryClient.invalidateQueries({ queryKey: [type === "product" ? "products" : "inventory"] });
  };

  const close = () => {
    setNewName(""); setEditingId(null); setEditingName(""); setDeleteTarget(null);
    onClose();
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    if (isDuplicate(name)) {
      toast.error(`"${name}" already exists.`);
      return;
    }
    setAdding(true);
    try {
      await addCategory(name, type);
      toast.success(`"${name}" added.`);
      setNewName("");
      onAdded?.(name);
      invalidate();
    } catch { toast.error("Couldn't add that category."); } finally { setAdding(false); }
  };

  const startEdit = (c: Category) => { setEditingId(c.id); setEditingName(c.name); };

  const saveEdit = async () => {
    if (!editingId) return;
    const current = categories.find((c) => c.id === editingId);
    const name = editingName.trim();
    if (!name) { toast.error("Category name can't be empty."); return; }
    if (current && name === current.name) { setEditingId(null); return; }
    if (isDuplicate(name, editingId)) { toast.error(`"${name}" already exists.`); return; }
    if (!current) return;
    setSaving(true);
    try {
      await renameCategory(editingId, current.name, name, type);
      const n = countFor(current.name);
      toast.success(n > 0 ? `Renamed. ${countLabel(n)} updated.` : "Category renamed.");
      setEditingId(null);
      onRenamed?.(current.name, name);
      invalidate();
    } catch { toast.error("Couldn't rename that category."); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCategoryRow(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" removed.`);
      setDeleteTarget(null);
      invalidate();
    } catch { toast.error("Couldn't delete that category."); } finally { setDeleting(false); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className={`${DLG} max-h-[80vh] max-w-[520px]`}>
          <DialogHead
            title="Manage categories"
            description={type === "product" ? "Pet Essentials" : "Supplies"}
            showDescription
            onClose={close}
          />
          <div className="flex shrink-0 gap-2 border-b border-[hsl(var(--border))] px-6 py-4">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              placeholder="New category"
              aria-label="New category"
              autoComplete="off"
              className={`${FIELD_BOX} min-w-0 flex-1 border-[hsl(var(--input))]`}
            />
            <button onClick={handleAdd} disabled={adding || !newName.trim()} className={`${BTN_SM_OUTLINE} shrink-0`}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
              </div>
            ) : categories.length === 0 ? (
              <p className="px-6 py-10 text-center text-[14px] text-[hsl(var(--muted-foreground))]">
                No categories yet. Add the first one above.
              </p>
            ) : (
              categories.map((c) => (
                <div
                  key={c.id}
                  className="flex min-h-[56px] items-center gap-2 border-b border-[hsl(var(--border)/.7)] px-6 py-2 hover:bg-[hsl(var(--muted)/.35)]"
                >
                  {editingId === c.id ? (
                    <>
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                        aria-label="Name"
                        autoFocus
                        className={`${FIELD_BOX} min-w-0 flex-1 border-[hsl(var(--input))]`}
                      />
                      <button onClick={saveEdit} disabled={saving} className={`${ROW_TEXT} text-[hsl(var(--primary))]`}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                      </button>
                      <button onClick={() => setEditingId(null)} disabled={saving} className={`${ROW_TEXT} text-[hsl(var(--muted-foreground))]`}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 break-words text-[14px] font-semibold leading-snug">{c.name}</span>
                      <span className="shrink-0 text-[13px] text-[hsl(var(--muted-foreground))]">{countLabel(countFor(c.name))}</span>
                      <button onClick={() => startEdit(c)} aria-label={`Rename ${c.name}`} className={ROW_TEXT}>Rename</button>
                      <button onClick={() => setDeleteTarget(c)} aria-label={`Delete ${c.name}`} className={`${ROW_TEXT} text-[hsl(var(--destructive))]`}>Delete</button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
          <div className={DLG_FOOT}>
            <button onClick={close} className={BTN_SM_SOLID}>Done</button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold tracking-[-.02em]">Delete this category?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTarget?.name}</span> won&apos;t
              be offered for new {type === "product" ? "products" : "supplies"} anymore. Anything already using
              this category keeps it — nothing existing changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={`${BTN_OUTLINE} mt-0`} disabled={deleting}>Keep category</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
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

/* ── Shared pieces ── */

/* The segmented control, styled exactly like the Appointments status tabs:
   a soft track, a navy pill under the chosen option, and a small count badge
   (amber when it needs attention, faded at zero). Used for the
   Pet Essentials / Supplies switch (no counts) and the status filters. */
function Segmented<T extends string>({
  options, value, onChange, label,
}: {
  options: { key: T; label: string; count?: number; warn?: boolean }[];
  value: T;
  onChange: (key: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-10 max-w-full gap-0 overflow-x-auto rounded-xl bg-white p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((o) => {
        const active = value === o.key;
        const attention = !active && !!o.warn && (o.count ?? 0) > 0;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className={`flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[14px] font-semibold transition ${FOCUS_RING} ${
              active
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`text-[13px] tabular-nums ${
                active
                  ? "font-medium opacity-80"
                  : attention
                    ? "font-bold text-[hsl(40_70%_30%)]"
                    : o.count === 0
                      ? "font-medium opacity-40"
                      : "font-medium opacity-60"
              }`}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* The tab bar, filters and table sit flush on one white page with hairline dividers, and
   their text all starts at the same 24px (px-6) left edge. */
/* One card that holds the status filter and the toolbar, like Appointments. */
const FILTER_CARD = "-mx-5 space-y-3 border-b border-[hsl(var(--border))] bg-white px-6 py-3 sm:-mx-8 lg:-mx-10";

/* The table card. No overflow clipping, so a row's menu can open past the edge.
   Padding (px-6), header size and row dividers match Appointments. */
const TABLE_CARD = "-mx-5 rounded-none border-b border-[hsl(var(--border))] bg-white sm:-mx-8 lg:-mx-10";
const TABLE_HEAD = "hidden gap-4 border-b border-[hsl(var(--border)/.8)] bg-white px-6 py-[11px] text-[12px] font-bold text-[hsl(var(--muted-foreground))] lg:grid";
const TABLE_FOOT = "px-6 py-3.5 text-[13px] text-[hsl(var(--muted-foreground))]";
const ROW_BASE = "grid gap-3 border-b border-[hsl(var(--border)/.7)] px-6 py-3 transition lg:items-center lg:gap-4";

/* Item name: up to two lines, full name on hover, so similar products
   ("Pedigree Dentastix L…" vs "…S…") can always be told apart. */
/* Label shown only when the row is stacked (below lg), where there is no header row. */
const STACK_LABEL = "mr-1.5 text-[13px] font-normal text-[hsl(var(--muted-foreground))] lg:hidden";
const NAME_CLASS = "line-clamp-2 min-w-0 break-words text-[15px] font-semibold leading-snug";

function Thumb({ src, contain, fallback }: { src?: string | null; contain?: boolean; fallback: React.ReactNode }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.6)]">
      {src
        ? <img src={src} alt="" className={contain ? "h-full w-full object-contain p-1" : "h-full w-full object-cover"} />
        : fallback}
    </div>
  );
}

/* Photo box with a styled "Choose photo" button in place of the browser's file input. */
/* A cropped photo as a File, so the upload functions that take a File work unchanged. */
function croppedFile(blob: Blob, original: File | null): File {
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const base = (original?.name || "photo").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

function PhotoPicker({
  id, preview, fileName, onSelect, size, contain, fallback,
}: {
  id: string; preview: string | null | undefined; fileName?: string;
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  size: number; contain?: boolean; fallback: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.6)]"
      >
        {preview
          ? <img src={preview} alt="" className={contain ? "h-full w-full object-contain p-1" : "h-full w-full object-cover"} />
          : fallback}
      </div>
      <input id={id} type="file" accept="image/*" onChange={onSelect} className="peer sr-only" />
      <label
        htmlFor={id}
        className={`${BTN_SM_OUTLINE} shrink-0 cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-[hsl(var(--accent))] peer-focus-visible:ring-offset-2`}
      >
        Choose photo
      </label>
      <p className="min-w-0 truncate text-[13px] text-[hsl(var(--muted-foreground))]">
        {fileName || (preview ? "Choose a new photo to replace this one." : "Optional")}
      </p>
    </div>
  );
}

function EmptyState({
  icon: Icon, title, hint, hasFilters, onClear, onAdd, addLabel,
}: {
  icon: React.ElementType; title: string; hint: string; hasFilters: boolean;
  onClear: () => void; onAdd: () => void; addLabel: string;
}) {
  return (
    <div className="p-14 text-center">
      <Icon className="mx-auto text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      <p className="mt-3 text-[15px] font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[14px] text-[hsl(var(--muted-foreground))]">{hint}</p>
      {hasFilters ? (
        <button
          onClick={onClear}
          className={`${BTN_SM_OUTLINE} mx-auto mt-4`}
        >
          Clear filters
        </button>
      ) : (
        <button onClick={onAdd} className={`${BTN_SM_SOLID} mx-auto mt-4`}>
          <Plus size={16} strokeWidth={2.6} aria-hidden="true" />
          {addLabel}
        </button>
      )}
    </div>
  );
}

/* Pet Essentials: a small Low / Out tag beside the number, nothing for healthy stock. */
function productStockTag(stock: number, safety: number) {
  if (stock === 0) return { label: "Out", pill: "bg-[hsl(15_72%_90%)] text-[hsl(15_60%_38%)]" };
  if (stock <= safety) return { label: "Low", pill: "bg-[hsl(40_55%_88%)] text-[hsl(40_55%_30%)]" };
  return null;
}

/* Supplies: the same filled status pill as Completed and Paid on Appointments and Billing. */
function supplyStockStatus(stock: number, safety: number) {
  if (stock === 0) {
    return { label: "Out of stock", icon: X, pill: "bg-[hsl(12_70%_92%)] text-[hsl(12_58%_36%)]" };
  }
  if (stock <= safety) {
    return { label: "Low stock", icon: Clock3, pill: "bg-[hsl(40_70%_88%)] text-[hsl(40_70%_26%)]" };
  }
  return { label: "In stock", icon: Check, pill: "bg-[hsl(145_40%_90%)] text-[hsl(145_42%_24%)]" };
}

/* Stock report for the whole screen: Pet Essentials and Supplies together,
   as a printable PDF and a styled Excel file. Reads the same cached queries
   as the two tabs, so it never shows different numbers from the screen.
   Renders ONE "Export" menu (Excel / PDF) like Appointments. It sits in the
   tab bar at the top right and covers both tabs. */
function InventoryExport() {
  const fullName = useAdminStore((s) => [s.title, s.fullName].filter(Boolean).join(" "));
  const { data: products = [], isLoading: productsLoading, isError: productsError } =
    useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const { data: supplies = [], isLoading: suppliesLoading, isError: suppliesError } =
    useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const { data: clinic } = useQuery({
    queryKey: ["clinic-settings"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("clinic_settings").select("*").limit(1).maybeSingle();
      return data;
    },
  });
  const [busy, setBusy] = useState<null | "pdf" | "excel">(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuOpen, () => setMenuOpen(false), menuRef);

  const level = (item: { stock?: number | null }) => stockState(item.stock ?? 0, safetyOf(item));
  const LEVEL_LABEL = ["Out", "Low", "In stock"];
  const num = (n: number) =>
    Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const phpMoney = (n: number) => `PHP ${num(n)}`;
  const localDay = clinicDay;

  /* Items that need attention come first, then alphabetical. */
  const prepare = () => {
    const order = (a: { name: string; stock: number }, b: { name: string; stock: number }) =>
      level(a) - level(b) || a.name.localeCompare(b.name);
    const prods = [...products].sort(order);
    const sups = [...supplies].sort(order);
    const sum = (rows: { stock: number }[]) => rows.reduce((t, r) => t + (r.stock ?? 0), 0);
    const costValue = prods.reduce((t, p) => t + (p.stock ?? 0) * (p.cost_price ?? 0), 0);
    const missingCost = prods.filter((p) => (p.stock ?? 0) > 0 && !(p.cost_price > 0)).length;
    const all = [...prods, ...sups];
    const out = all.filter((i) => (i.stock ?? 0) <= 0).length;
    const low = all.filter((i) => level(i) === 1).length;
    const reorder = [...all]
      .filter((i) => level(i) < 2)
      .sort(order)
      .map((i) => ((i.stock ?? 0) <= 0 ? `${i.name} (out of stock)` : `${i.name} (${i.stock} left, safety stock ${safetyOf(i)})`));
    return {
      prods, sups, prodUnits: sum(prods), supUnits: sum(sups),
      costValue, missingCost, out, low, reorder,
    };
  };

  const clinicName = () => clinic?.clinic_name?.trim() || "Pet Royale Clinic and Veterinary Services";
  const generatedOn = () =>
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

  const exportPDF = () => {
    if (busy) return;
    setBusy("pdf");
    try {
      const d = prepare();
      const name = clinicName();
      const contact = [clinic?.address, clinic?.phone_number, clinic?.email].filter(Boolean).join("  |  ");
      type RGB = [number, number, number];
      const TEAL: RGB = [14, 79, 69];
      const INK: RGB = [26, 26, 26];
      const GREY: RGB = [107, 107, 107];
      const RULE: RGB = [220, 220, 214];
      const STATUS_COLOR: RGB[] = [[138, 36, 36], [107, 71, 16], [31, 95, 60]];
      const doc = new jsPDF({ orientation: "portrait", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 15;
      const CW = W - M * 2;

      doc.setFont("times", "bold"); doc.setFontSize(16); doc.setTextColor(...INK);
      doc.text(name, W / 2, 20, { align: "center" });
      if (contact) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY);
        doc.text(contact, W / 2, 26, { align: "center", maxWidth: CW });
      }
      doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, 31, W - M, 31);

      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...GREY);
      doc.text("REPORT", M, 41);
      doc.setFont("times", "bold"); doc.setFontSize(22); doc.setTextColor(...TEAL);
      doc.text("Inventory stock report", M, 50);
      const kv = (label: string, value: string, y: number) => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...INK);
        doc.text(value, W - M, y, { align: "right" });
        const vw = doc.getTextWidth(value);
        doc.setFont("helvetica", "normal"); doc.setTextColor(...GREY);
        doc.text(label, W - M - vw - 3, y, { align: "right" });
      };
      kv("Stock as of", generatedOn(), 41);
      kv("Scope", "Pet Essentials and Supplies", 46.5);
      if (fullName) kv("Prepared by", fullName, 52);

      const y0 = 58;
      const figures: [string, string, string, RGB][] = [
        ["ITEMS TRACKED", String(d.prods.length + d.sups.length), `${d.prods.length} essentials - ${d.sups.length} supplies`, INK],
        ["STOCK VALUE", d.costValue > 0 ? phpMoney(d.costValue) : "Not entered", "Pet Essentials, at cost price", INK],
        ["LOW STOCK", String(d.low), "At or below safety stock", [107, 71, 16]],
        ["OUT OF STOCK", String(d.out), "Needs reordering", [138, 36, 36]],
      ];
      doc.setDrawColor(...TEAL); doc.setLineWidth(0.8); doc.line(M, y0, W - M, y0);
      const colW = CW / 4;
      figures.forEach(([label, value, caption, color], i) => {
        const x = M + i * colW + (i > 0 ? 4 : 0);
        doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...GREY);
        doc.text(label, x, y0 + 6);
        doc.setFontSize(12.5); doc.setTextColor(...color);
        doc.text(value, x, y0 + 14);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GREY);
        doc.text(caption, x, y0 + 19);
        if (i > 0) { doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M + i * colW, y0 + 3, M + i * colW, y0 + 21); }
      });
      doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, y0 + 24, W - M, y0 + 24);

      let y = y0 + 32;
      if (d.missingCost > 0) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(122, 84, 16);
        doc.text(`${d.missingCost} product${d.missingCost === 1 ? "" : "s"} in stock ${d.missingCost === 1 ? "has" : "have"} no cost price, so stock value is understated.`, M, y0 + 29);
        y += 3;
      }

      // To reorder
      if (d.reorder.length > 0) {
        const shown = d.reorder.slice(0, 16);
        const more = d.reorder.length - shown.length;
        const text = shown.join("   |   ") + (more > 0 ? `   |   +${more} more` : "");
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
        const lines = doc.splitTextToSize(text, CW - 10) as string[];
        const boxH = 12 + lines.length * 4.6;
        doc.setFillColor(250, 246, 234); doc.setDrawColor(236, 223, 180); doc.setLineWidth(0.3);
        doc.rect(M, y, CW, boxH, "FD");
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(107, 71, 16);
        doc.text("TO REORDER", M + 5, y + 6);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...INK);
        doc.text(lines, M + 5, y + 11.5);
        y += boxH + 9;
      }

      const base = {
        theme: "plain" as const,
        styles: {
          font: "helvetica", fontSize: 8.5, textColor: INK, lineColor: RULE,
          lineWidth: { bottom: 0.2 }, cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
        },
        headStyles: { textColor: GREY, fontStyle: "bold" as const, fontSize: 7.5, lineColor: RULE },
        margin: { left: M, right: M },
      };
      const parse = (hasTotal: boolean, numCols: number[], statusCol: number, levels: number[]) => (data: any) => {
        if (data.section === "head" && numCols.includes(data.column.index)) data.cell.styles.halign = "right";
        if (data.section !== "body") return;
        const isTotal = hasTotal && data.row.index === data.table.body.length - 1;
        if (isTotal) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.lineColor = INK;
          data.cell.styles.lineWidth = { top: 0.6, bottom: 0 };
        } else if (data.column.index === statusCol && levels[data.row.index] !== undefined) {
          data.cell.styles.textColor = STATUS_COLOR[levels[data.row.index]];
          data.cell.styles.fontStyle = "bold";
        }
      };
      const label = (text: string) => {
        if (y > H - 60) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...GREY);
        doc.text(text.toUpperCase(), M, y);
        y += 2.5;
      };
      const after = () => { y = (doc as any).lastAutoTable.finalY + 9; };

      // Pet Essentials
      label("Pet Essentials - retail stock");
      const pLevels = d.prods.map((p) => level(p));
      autoTable(doc, {
        ...base,
        startY: y,
        head: [["PRODUCT", "CATEGORY", "QTY", "SAFETY", "COST (PHP)", "PRICE (PHP)", "VALUE (PHP)", "STATUS"]],
        body: d.prods.length > 0
          ? [...d.prods.map((p) => [
              p.name, p.category, String(p.stock ?? 0), String(safetyOf(p)),
              p.cost_price > 0 ? num(p.cost_price) : "-",
              num(p.price),
              p.cost_price > 0 ? num((p.stock ?? 0) * p.cost_price) : "-",
              LEVEL_LABEL[level(p)],
            ]),
            ["Total", "", String(d.prodUnits), "", "", "", d.costValue > 0 ? num(d.costValue) : "-", ""]]
          : [["No products yet", "", "", "", "", "", "", ""]],
        columnStyles: {
          1: { cellWidth: 28 }, 2: { cellWidth: 12, halign: "right" }, 3: { cellWidth: 14, halign: "right" },
          4: { cellWidth: 20, halign: "right" }, 5: { cellWidth: 20, halign: "right" }, 6: { cellWidth: 24, halign: "right" }, 7: { cellWidth: 18 },
        },
        didParseCell: parse(d.prods.length > 0, [2, 3, 4, 5, 6], 7, pLevels),
      });
      after();

      // Supplies
      label("Supplies - clinic-use stock");
      const sLevels = d.sups.map((i) => level(i));
      autoTable(doc, {
        ...base,
        startY: y,
        head: [["ITEM", "CATEGORY", "QTY", "SAFETY", "STATUS"]],
        body: d.sups.length > 0
          ? [...d.sups.map((i) => [i.name, i.category, String(i.stock ?? 0), String(safetyOf(i)), LEVEL_LABEL[level(i)]]),
             ["Total", "", String(d.supUnits), "", ""]]
          : [["No supplies yet", "", "", "", ""]],
        columnStyles: { 1: { cellWidth: 55 }, 2: { cellWidth: 20, halign: "right" }, 3: { cellWidth: 20, halign: "right" }, 4: { cellWidth: 28 } },
        didParseCell: parse(d.sups.length > 0, [2, 3], 4, sLevels),
      });
      const endY = (doc as any).lastAutoTable.finalY;

      const sigY = H - 28;
      if (endY > sigY - 10) doc.addPage();
      doc.setPage(doc.getNumberOfPages());
      doc.setDrawColor(...INK); doc.setLineWidth(0.3);
      doc.line(M, sigY, M + 55, sigY); doc.line(M + 70, sigY, M + 125, sigY);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY);
      doc.text("Counted by", M, sigY + 5); doc.text("Checked by", M + 70, sigY + 5);

      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, H - 14, W - M, H - 14);
        doc.setFontSize(8); doc.setTextColor(...GREY); doc.setFont("helvetica", "normal");
        doc.text(name, M, H - 9);
        doc.text(`Page ${i} of ${pages}`, W - M, H - 9, { align: "right" });
      }
      doc.save(`pet-royale-inventory_${localDay()}.pdf`);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't build the PDF. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const exportExcel = () => {
    if (busy) return;
    setBusy("excel");
    try {
      const d = prepare();
      const MONEY = '"₱"#,##0.00';
      const TEAL = "0E4F45", INK = "1A1A1A", GRID = "D9D9D9";
      const book = XLSX.utils.book_new();
      const setFmt = (sheet: any, r: number, c: number, z: string) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (sheet[ref] && typeof sheet[ref].v === "number") sheet[ref].z = z;
      };
      const paint = (sheet: any, r: number, c: number, st: Record<string, unknown>) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!sheet[ref]) sheet[ref] = { t: "s", v: "" };
        sheet[ref].s = st;
      };
      const styleTable = (sheet: any, headRow: number, lastRow: number, cols: number, numCols: number[], hasTotal: boolean) => {
        for (let c = 0; c < cols; c++) {
          paint(sheet, headRow, c, {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { patternType: "solid", fgColor: { rgb: TEAL } },
            alignment: { vertical: "center", horizontal: numCols.includes(c) ? "right" : "left" },
            border: { bottom: { style: "medium", color: { rgb: INK } } },
          });
        }
        for (let r = headRow + 1; r <= lastRow; r++) {
          const isTotal = hasTotal && r === lastRow;
          for (let c = 0; c < cols; c++) {
            paint(sheet, r, c, {
              font: { bold: isTotal },
              alignment: { vertical: "center", horizontal: numCols.includes(c) ? "right" : "left" },
              border: isTotal
                ? { top: { style: "medium", color: { rgb: INK } } }
                : { bottom: { style: "thin", color: { rgb: GRID } } },
            });
          }
        }
        const rows: any[] = sheet["!rows"] || [];
        rows[headRow] = { hpt: 22 };
        sheet["!rows"] = rows;
      };
      const freezeTop = (sheet: any) => {
        sheet["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
      };

      // Summary
      const summaryRows: (string | number)[][] = [
        [clinicName()],
        ["Inventory stock report"],
        ["Stock as of", generatedOn()],
        ...(fullName ? [["Prepared by", fullName]] : []),
        [],
        ["Figure", "Value"],
        ["Pet Essentials products", d.prods.length],
        ["Pet Essentials units in stock", d.prodUnits],
        ["Stock value at cost (Pet Essentials)", d.costValue > 0 ? Number(d.costValue.toFixed(2)) : "Not entered"],
        ["Supplies tracked", d.sups.length],
        ["Supplies units in stock", d.supUnits],
        ["Low stock items (at or below safety stock)", d.low],
        ["Out of stock items", d.out],
        ...(d.missingCost > 0
          ? [[], ["Note", `${d.missingCost} product(s) in stock have no cost price, so stock value is understated.`]]
          : []),
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      summarySheet["!cols"] = [{ wch: 44 }, { wch: 26 }];
      const figureStart = summaryRows.findIndex((r) => r[0] === "Figure") + 1;
      setFmt(summarySheet, figureStart + 2, 1, MONEY);
      styleTable(summarySheet, figureStart - 1, figureStart + 6, 2, [1], false);
      paint(summarySheet, 0, 0, { font: { bold: true, sz: 14 } });
      paint(summarySheet, 1, 0, { font: { bold: true, sz: 12, color: { rgb: TEAL } } });
      XLSX.utils.book_append_sheet(book, summarySheet, "Summary");

      // Pet Essentials
      const hasProducts = d.prods.length > 0;
      const productRows: (string | number)[][] = [
        ["Product", "Category", "Qty", "Safety stock", "Cost", "Price", "Stock value (cost)", "Status", "Shown in app"],
        ...(hasProducts
          ? [
              ...d.prods.map((p) => [
                p.name, p.category, p.stock ?? 0, safetyOf(p),
                p.cost_price > 0 ? Number(p.cost_price.toFixed(2)) : "Not entered",
                Number(Number(p.price).toFixed(2)),
                p.cost_price > 0 ? Number(((p.stock ?? 0) * p.cost_price).toFixed(2)) : "-",
                LEVEL_LABEL[level(p)],
                p.is_available ? "Yes" : "No",
              ]),
              ["TOTAL", "", d.prodUnits, "", "", "", d.costValue > 0 ? Number(d.costValue.toFixed(2)) : "-", "", ""],
            ]
          : [["No products yet", "", "", "", "", "", "", "", ""]]),
      ];
      const productSheet = XLSX.utils.aoa_to_sheet(productRows);
      productSheet["!cols"] = [{ wch: 30 }, { wch: 26 }, { wch: 8 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 14 }];
      for (let r = 1; r < productRows.length; r++) [4, 5, 6].forEach((c) => setFmt(productSheet, r, c, MONEY));
      styleTable(productSheet, 0, productRows.length - 1, 9, [2, 3, 4, 5, 6], hasProducts);
      freezeTop(productSheet);
      XLSX.utils.book_append_sheet(book, productSheet, "Pet Essentials");

      // Supplies
      const hasSupplies = d.sups.length > 0;
      const supplyRows: (string | number)[][] = [
        ["Item", "Category", "Qty", "Safety stock", "Status"],
        ...(hasSupplies
          ? [
              ...d.sups.map((i) => [i.name, i.category, i.stock ?? 0, safetyOf(i), LEVEL_LABEL[level(i)]]),
              ["TOTAL", "", d.supUnits, "", ""],
            ]
          : [["No supplies yet", "", "", "", ""]]),
      ];
      const supplySheet = XLSX.utils.aoa_to_sheet(supplyRows);
      supplySheet["!cols"] = [{ wch: 32 }, { wch: 26 }, { wch: 8 }, { wch: 13 }, { wch: 14 }];
      styleTable(supplySheet, 0, supplyRows.length - 1, 5, [2, 3], hasSupplies);
      freezeTop(supplySheet);
      XLSX.utils.book_append_sheet(book, supplySheet, "Supplies");

      XLSX.writeFile(book, `pet-royale-inventory_${localDay()}.xlsx`);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't build the spreadsheet. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  /* Wait for both lists: exporting while one is still loading would say
     "No supplies yet" (or "No products yet") for a list that just hasn't
     arrived. */
  const loadingLists = productsLoading || suppliesLoading;
  const failedLists = productsError || suppliesError;
  const empty = products.length === 0 && supplies.length === 0;
  const blocked = busy !== null || empty || loadingLists || failedLists;
  const exportTitle = failedLists
    ? "The stock lists didn't load, so there is nothing to download yet"
    : "Download the whole stock list (Pet Essentials and Supplies)";
  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        disabled={blocked}
        title={exportTitle}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={BTN_SM_OUTLINE}
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
        Export
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {menuOpen && (
        <div role="menu" className={MENU_PANEL}>
          <button
            role="menuitem"
            type="button"
            onClick={() => { setMenuOpen(false); exportExcel(); }}
            className={MENU_ITEM}
          >
            <FileSpreadsheet size={18} aria-hidden="true" />
            Excel spreadsheet
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => { setMenuOpen(false); exportPDF(); }}
            className={MENU_ITEM}
          >
            <FileText size={18} aria-hidden="true" />
            PDF report
          </button>
        </div>
      )}
    </div>
  );
}

/* Remembers the Category filter for each tab while the browser tab is open,
   so switching tabs or screens doesn't reset it to "All categories". */
function useStoredFilter(key: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try { return sessionStorage.getItem(key) ?? "all"; } catch { return "all"; }
  });
  const update = (v: string) => {
    setValue(v);
    try { sessionStorage.setItem(key, v); } catch { /* storage unavailable: just won't persist */ }
  };
  return [value, update];
}

/* An item a notification card asked to show. `key` changes on every request,
   so tapping the same card twice still scrolls and highlights again. */
type FocusRequest = { id: string; key: number } | null;

type InventoryTab = "essentials" | "supplies";
const TAB_PATH: Record<InventoryTab, string> = {
  essentials: "/inventory/pet-essentials",
  supplies: "/inventory/supplies",
};

export default function Inventory() {
  /* A notification card can open this screen on a specific tab and item
     via navigation state. This also runs when Inventory is already open,
     so a card tapped from here still switches tab and highlights the item. */
  const location = useLocation();
  const navigate = useNavigate();
  const hint = location.state as { tab?: InventoryTab; itemId?: string } | null;
  /* The tab is part of the URL: /inventory/pet-essentials and
     /inventory/supplies are the two sidebar entries. */
  const tab: InventoryTab = location.pathname.endsWith("/supplies") ? "supplies" : "essentials";
  const [focus, setFocus] = useState<FocusRequest>(null);
  useEffect(() => {
    const isBare = location.pathname === "/inventory";
    if (!hint && !isBare) return;
    const target = TAB_PATH[hint?.tab ?? tab];
    if (target !== location.pathname) {
      /* Move to the right tab first. Carry the hint along so the item can
         be highlighted once the page is on that tab. */
      navigate(target, { replace: true, state: hint });
      return;
    }
    if (hint) {
      setFocus(hint.itemId ? { id: hint.itemId, key: Date.now() } : null);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [hint, location.pathname, navigate, tab]);

  /* The subtitle under the page title, like the date on Dashboard and
     Appointments. Same cached lists the tabs use, so no extra requests. */
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const { data: supplies } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const subtitle =
    tab === "essentials"
      ? products ? `Pet Essentials · ${products.length} product${products.length === 1 ? "" : "s"}` : "Pet Essentials"
      : supplies ? `Supplies · ${supplies.length} item${supplies.length === 1 ? "" : "s"}` : "Supplies";

  return (
    <AdminLayout title="Inventory" subtitle={subtitle}>
      {tab === "essentials" ? <PetEssentialsTab focus={focus} /> : <SuppliesTab focus={focus} />}
    </AdminLayout>
  );
}

/* ══════════════════ Pet Essentials tab ══════════════════ */
type EssentialsFilter = "all" | "listed" | "hidden" | "low" | "out";

/* Product (category under the name), Price, Stock, Safety stock, Shown in app,
   Actions. The name column takes the spare width and wraps to two lines. */
const ESSENTIALS_COLS = "lg:grid-cols-[minmax(0,1fr)_72px_80px_88px_124px_164px]";

function PetEssentialsTab({ focus }: { focus: FocusRequest }) {
  const queryClient = useQueryClient();
  const currentStaffId = useAdminStore((s) => s.staffId);
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["categories", "product"],
    queryFn: () => fetchCategories("product"),
  });
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useStoredFilter("pet-royale-inventory-category-essentials");
  // A saved category that has since been deleted or renamed would leave an
  // empty-looking list. Once categories have loaded, fall back to "All".
  useEffect(() => {
    if (categoriesLoading) return;
    if (categoryFilter !== "all" && !categories.some((c) => c.name === categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categories, categoriesLoading, categoryFilter]);
  const [statusFilter, setStatusFilter] = useState<EssentialsFilter>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [stock, setStock] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [safetyStock, setSafetyStock] = useState(String(DEFAULT_SAFETY_STOCK));
  /* Price = Cost ÷ (1 − Margin), recomputed live; price stays editable. */
  const [targetMargin, setTargetMargin] = useState("");
  const [showRecordSale, setShowRecordSale] = useState(false);
  const [saleProduct, setSaleProduct] = useState<Product | null>(null);
  const [saleQuantity, setSaleQuantity] = useState("1");
  const [recordingSale, setRecordingSale] = useState(false);

  /* Arriving from a notification card: scroll to the row and mark it for a few seconds. */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusHandled = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || focusHandled.current === focus.key) return;
    if (!products.some((p) => p.id === focus.id)) return;
    focusHandled.current = focus.key;
    setHighlightId(focus.id);
    requestAnimationFrame(() => {
      document.getElementById(`inventory-row-${focus.id}`)?.scrollIntoView({ block: "center" });
    });
  }, [focus, products]);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 6000);
    return () => clearTimeout(t);
  }, [highlightId]);

  /* Only runs when staff type in Cost or Margin. It used to be an effect, which
     also fired when Edit opened and overwrote the saved price with one rebuilt
     from a rounded margin. */
  const applyMargin = (costStr: string, marginStr: string) => {
    const cost = parseFloat(costStr);
    const margin = parseFloat(marginStr);
    if (!marginStr || Number.isNaN(cost) || cost <= 0 || Number.isNaN(margin) || margin >= 100 || margin < 0) return;
    setPrice((cost / (1 - margin / 100)).toFixed(2));
  };

  const isLow = (p: Product) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= safetyOf(p);
  const isOut = (p: Product) => (p.stock ?? 0) === 0;

  /* Filter counts follow the search and category. */
  const base = products.filter((p) => {
    const q = search.toLowerCase();
    return (!q || p.name.toLowerCase().includes(q)) && (categoryFilter === "all" || p.category === categoryFilter);
  });
  const counts = {
    all: base.length,
    listed: base.filter((p) => p.is_available).length,
    hidden: base.filter((p) => !p.is_available).length,
    low: base.filter(isLow).length,
    out: base.filter(isOut).length,
  };
  const filtered = base.filter((p) =>
    statusFilter === "all" ||
    (statusFilter === "listed" && p.is_available) ||
    (statusFilter === "hidden" && !p.is_available) ||
    (statusFilter === "low" && isLow(p)) ||
    (statusFilter === "out" && isOut(p))
  );

  const hasFilters = !!search || categoryFilter !== "all" || statusFilter !== "all";
  const resetFilters = () => { setSearch(""); setCategoryFilter("all"); setStatusFilter("all"); };
  const resetForm = () => {
    setName(""); setCategory(""); setPrice(""); setStock(""); setCostPrice("");
    setSafetyStock(String(DEFAULT_SAFETY_STOCK));
    setTargetMargin("");
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
    setSafetyStock(String(safetyOf(p)));
    const cost = Number(p.cost_price ?? 0);
    const currentPrice = Number(p.price ?? 0);
    setTargetMargin(cost > 0 && currentPrice > 0 ? String(Math.round(((currentPrice - cost) / currentPrice) * 1000) / 10) : "");
    setImageFile(null);
    setImagePreview(p.image_url);
    setShowAdd(true);
  };
  const closeDialog = () => { setShowAdd(false); setEditProduct(null); resetForm(); };
  // A chosen photo opens the cropper first; only the cropped square is kept.
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still opens the cropper
    if (file) setCropFile(file);
  };
  const applyCrop = (blob: Blob) => {
    const cropped = croppedFile(blob, cropFile);
    setImageFile(cropped);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(cropped);
    setCropFile(null);
  };

  /* An empty stock or cost box counts as 0, as before. Anything typed must be
     valid: no negative stock, no 2.5 units, no negative cost, and a selling
     price above zero. */
  const priceOk = parseFloat(price) > 0;
  const costOk = costPrice === "" || parseFloat(costPrice) >= 0;
  const stockOk = stock === "" || isWholeNumber(stock);
  const safetyOk = isWholeNumber(safetyStock);
  const canSave = !!name.trim() && !!category && priceOk && costOk && stockOk && safetyOk;

  const handleSave = async () => {
    const cleanName = name.trim();
    if (!cleanName || !category || !price) {
      toast.error("Please fill in name, category and price.");
      return;
    }
    if (!priceOk) { toast.error("Set a selling price above ₱0."); return; }
    if (!costOk) { toast.error("Cost can't be negative."); return; }
    if (!stockOk) { toast.error("Stock must be a whole number, 0 or more."); return; }
    if (!safetyOk) { toast.error("Safety stock must be a whole number, 0 or more."); return; }
    setLoading(true);
    try {
      let imageUrl = editProduct?.image_url || null;
      if (imageFile) imageUrl = await uploadProductPhoto(imageFile);
      const input = {
        name: cleanName,
        category,
        price: parseFloat(price),
        cost_price: parseFloat(costPrice) || 0,
        stock: stock === "" ? 0 : parseInt(stock, 10),
        safety_stock: parseInt(safetyStock, 10),
        // The description is no longer edited here. An existing product keeps
        // the one it has, so saving never wipes it.
        description: editProduct?.description ?? null,
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

  const saleQty = Number(saleQuantity);
  const saleQtyOk = Number.isInteger(saleQty) && saleQty >= 1;
  const handleRecordSale = async () => {
    if (!saleProduct) return;
    if (!currentStaffId) {
      toast.error("Your staff profile is not linked to this dashboard session. Log in again or contact the clinic admin.");
      return;
    }
    if (!saleQtyOk) { toast.error("Enter a whole number of 1 or more."); return; }
    if (saleQty > (saleProduct.stock ?? 0)) { toast.error(`Only ${saleProduct.stock} in stock.`); return; }
    setRecordingSale(true);
    try {
      await recordProductSale(saleProduct.id, saleQty, currentStaffId);
      toast.success(`Sale recorded: ${saleQty} × ${saleProduct.name}`);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setShowRecordSale(false);
      setSaleProduct(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to record sale.");
    } finally { setRecordingSale(false); }
  };
  const handleDelete = async () => {
    if (!deleteProductId) return;
    setDeletingProduct(true);
    try {
      await deleteProduct(deleteProductId);
      toast.success("Product deleted.");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setDeleteProductId(null);
    } catch { toast.error("Failed to delete product."); } finally { setDeletingProduct(false); }
  };
  const deleteTargetName = products.find((p) => p.id === deleteProductId)?.name;

  return (
    <>
      <div className={`${PAGE_WRAP} min-h-full bg-white pb-8`}>

        {/* ── One filter card: status pills, then the toolbar (same as Appointments) ── */}
        <div className={FILTER_CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<EssentialsFilter>
            label="Show products"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { key: "all", label: "All", count: counts.all },
              { key: "listed", label: "Shown in app", count: counts.listed },
              { key: "hidden", label: "Hidden", count: counts.hidden },
              { key: "low", label: "Running low", count: counts.low, warn: true },
              { key: "out", label: "Out of stock", count: counts.out, warn: true },
            ]}
          />
          <InventoryExport />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField placeholder="Search products by name" value={search} onChange={setSearch} className="min-w-[200px] flex-1 basis-[200px]" />
            <SelectField
              label="Category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="min-w-[180px] shrink-0"
            >
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </SelectField>
            <button
              onClick={() => setShowManageCategories(true)}
              className={`${BTN_SM_OUTLINE} shrink-0`}
            >
              <Settings2 size={16} aria-hidden="true" />
              Categories
            </button>
            <button
              onClick={openAdd}
              className={`${BTN_SM_SOLID} shrink-0`}
            >
              <Plus size={16} strokeWidth={2.6} aria-hidden="true" />
              Add product
            </button>
          </div>
        </div>

        {/* ── Table ── */}
        <div className={TABLE_CARD}>
          <div className={`${TABLE_HEAD} ${ESSENTIALS_COLS}`}>
            <span>Product</span>
            <span className="text-right">Price</span>
            <span className="text-right">Stock</span>
            <span className="text-right">Safety stock</span>
            <span className="lg:pl-4">Shown in app</span>
            <span className="text-right">Action</span>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
              <span className="sr-only">Loading</span>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Package}
              title={hasFilters ? "No products match these filters" : "No products yet"}
              hint={hasFilters ? "Try a different name, category or filter." : "Add the retail items your clinic sells to pet owners."}
              hasFilters={hasFilters} onClear={resetFilters} onAdd={openAdd} addLabel="Add your first product"
            />
          ) : (
            <>
              {filtered.map((p) => {
                const stockCount = p.stock ?? 0;
                const safety = safetyOf(p);
                const tag = productStockTag(stockCount, safety);
                const isOutOfStock = stockCount === 0;
                return (
                  <div
                    key={p.id}
                    id={`inventory-row-${p.id}`}
                    className={`${ROW_BASE} ${ESSENTIALS_COLS} ${
                      highlightId === p.id ? "bg-[hsl(var(--accent)/.18)]" : "hover:bg-[hsl(var(--muted)/.35)]"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <Thumb src={p.image_url} fallback={<Package className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />} />
                      <div className="min-w-0">
                        <span title={p.name} className={NAME_CLASS}>{p.name}</span>
                        <span className="block truncate text-[13px] text-[hsl(var(--muted-foreground))]" title={p.category}>{p.category}</span>
                      </div>
                    </div>
                    <p className="text-[15px] font-semibold tabular-nums lg:text-right">
                      <span className={STACK_LABEL}>Price</span>{peso(p.price)}
                    </p>
                    <p className="text-[15px] font-medium tabular-nums lg:text-right">
                      <span className={STACK_LABEL}>Stock</span>
                      {tag && (
                        <span className={`mr-2 inline-block rounded-md px-2 py-0.5 align-[1px] text-xs font-bold ${tag.pill}`}>
                          {tag.label}
                        </span>
                      )}
                      {stockCount}
                    </p>
                    <p className="text-[15px] tabular-nums text-[hsl(var(--muted-foreground))] lg:text-right">
                      <span className={STACK_LABEL}>Safety stock</span>{safety}
                    </p>
                    <div className="lg:pl-4">
                      <button
                        onClick={() => handleToggleAvailability(p)}
                        disabled={isOutOfStock && !p.is_available}
                        role="switch"
                        aria-checked={p.is_available}
                        aria-label={`${p.name} is ${p.is_available ? "shown" : "hidden"} in the app`}
                        title={isOutOfStock && !p.is_available ? "Out of stock — restock to list this" : undefined}
                        className={`inline-flex items-center gap-2.5 rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                      >
                        <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                          p.is_available ? "bg-[hsl(145_42%_35%)]" : "bg-[hsl(var(--muted-foreground)/.55)]"
                        }`}>
                          <span className={`inline-block h-[18px] w-[18px] rounded-full bg-white transition-transform ${
                            p.is_available ? "translate-x-[23px]" : "translate-x-[3px]"
                          }`} />
                        </span>
                        <span className={`text-[14px] ${
                          p.is_available ? "font-bold text-[hsl(145_42%_27%)]" : "font-medium text-[hsl(var(--muted-foreground))]"
                        }`}>
                          {p.is_available ? "Shown" : "Hidden"}
                        </span>
                      </button>
                    </div>
                    <div className="flex items-center justify-start gap-2 lg:justify-end">
                      <button
                        onClick={() => { setSaleProduct(p); setSaleQuantity("1"); setShowRecordSale(true); }}
                        disabled={isOutOfStock}
                        className={ROW_BTN}
                      >
                        Record sale
                      </button>
                      <RowMenu
                        label={`Manage ${p.name}`}
                        items={[
                          { text: "Edit product", onClick: () => openEdit(p) },
                          { text: "Delete product", danger: true, onClick: () => setDeleteProductId(p.id) },
                        ]}
                      />
                    </div>
                  </div>
                );
              })}
              <div className={TABLE_FOOT}>
                Showing <span className="font-bold text-[hsl(var(--foreground))]">{filtered.length}</span> of {products.length}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add / Edit product */}
      <Dialog open={showAdd} onOpenChange={(open) => { if (!open && !loading) closeDialog(); }}>
        <DialogContent className={`${DLG} max-w-[640px]`}>
          <DialogHead
            title={editProduct ? "Edit product" : "Add product"}
            description={editProduct ? "Change this product's details, price and stock." : "Enter the details, price and stock for a new product."}
            onClose={closeDialog}
            disabled={loading}
          />
          <div className={DLG_BODY}>
            <FormGroup title="Details">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput label="Product name" value={name} onChange={setName} autoComplete="off" />
                <LabeledSelect
                  label="Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  action={<button type="button" onClick={() => setShowManageCategories(true)} className={LINK_ACTION}>Manage categories</button>}
                >
                  <option value="">Select a category</option>
                  {category && !categories.some((c) => c.name === category) && <option value={category}>{category}</option>}
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </LabeledSelect>
              </div>
            </FormGroup>
            <FormGroup title="Pricing" note="Cost is used for profit in Reports. Selling price fills in from cost and margin, and you can still edit it.">
              <div className="grid gap-3 sm:grid-cols-3">
                <LabeledInput
                  label="Cost per unit (₱)" type="number" min="0" step="0.01" value={costPrice}
                  onChange={(v) => { setCostPrice(v); applyMargin(v, targetMargin); }}
                  error={!costOk ? "Cost can't be negative." : undefined}
                />
                <LabeledInput
                  label="Target margin (%)" type="number" min="0" max="99" value={targetMargin}
                  onChange={(v) => { setTargetMargin(v); applyMargin(costPrice, v); }}
                />
                <LabeledInput
                  label="Selling price (₱)" type="number" min="0" step="0.01" value={price} onChange={setPrice}
                  error={price !== "" && !priceOk ? "Needs an amount above ₱0." : undefined}
                />
              </div>
            </FormGroup>
            <FormGroup title="Stock" note="Shows as Running low when stock reaches the safety stock level.">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput
                  label="Stock quantity" type="number" min="0" step="1" inputMode="numeric" value={stock} onChange={setStock}
                  error={!stockOk ? "Use a whole number, 0 or more." : undefined}
                />
                <LabeledInput
                  label="Safety stock level" type="number" min="0" step="1" inputMode="numeric" value={safetyStock} onChange={setSafetyStock}
                  error={!safetyOk ? "Use a whole number, 0 or more." : undefined}
                />
              </div>
            </FormGroup>
            <FormGroup title="Photo">
              <PhotoPicker
                id="product-photo"
                preview={imagePreview}
                fileName={imageFile?.name}
                onSelect={handleImageSelect}
                size={56}
                fallback={<Package className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />}
              />
            </FormGroup>
          </div>
          <div className={DLG_FOOT}>
            <button onClick={closeDialog} disabled={loading} className={BTN_SM_OUTLINE}>Cancel</button>
            <button onClick={handleSave} disabled={loading || !canSave} className={BTN_SM_SOLID}>
              {loading
                ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
                : editProduct ? "Save changes" : "Add product"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record a sale */}
      <Dialog open={showRecordSale} onOpenChange={(open) => { if (!open && !recordingSale) setShowRecordSale(false); }}>
        <DialogContent className="max-w-[440px] grid-cols-[minmax(0,1fr)] gap-0 rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))] p-7 [&>button]:hidden">
          <div className="mb-5 flex items-start justify-between gap-3">
            <DialogTitle asChild>
              <DialogTitle className="text-[28px] font-bold leading-[34px] tracking-[-.02em]">Record a sale</DialogTitle>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Enter how many units were sold. Stock drops by that amount.
            </DialogDescription>
            <button
              onClick={() => setShowRecordSale(false)}
              disabled={recordingSale}
              className={`rounded-full px-1 py-2 text-[15px] font-bold text-[hsl(var(--primary))] ${FOCUS_RING}`}
            >
              Close
            </button>
          </div>
          {saleProduct && (
            <div className="space-y-3">
              <div className="rounded-[16px] border-[1.5px] border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4 py-3">
                <p className="text-[16px] font-bold">{saleProduct.name}</p>
                <p className="mt-0.5 text-[14px] text-[hsl(var(--muted-foreground))]">
                  {peso(saleProduct.price)} each · {saleProduct.stock} in stock
                </p>
              </div>
              <div>
                <FloatInput
                  label="Quantity sold" type="number" min="1" step="1" inputMode="numeric" max={String(saleProduct.stock)}
                  value={saleQuantity} onChange={setSaleQuantity} autoFocus
                />
                {saleQuantity !== "" && !saleQtyOk && (
                  <p role="alert" className={FIELD_ERROR}>Use a whole number of 1 or more.</p>
                )}
              </div>
              <div className="flex items-baseline justify-between rounded-[16px] border-[1.5px] border-[hsl(var(--card-border))] bg-[hsl(var(--card))] px-4 py-3">
                <span className="text-[16px] font-bold">Total</span>
                <span className="text-[24px] font-bold tabular-nums">
                  {peso(saleQtyOk ? saleQty * saleProduct.price : 0)}
                </span>
              </div>
              <p className="text-[14px] leading-snug text-[hsl(var(--muted-foreground))]">
                Stock drops by this amount and the sale appears in History and Reports.
              </p>
            </div>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button onClick={() => setShowRecordSale(false)} disabled={recordingSale} className={BTN_OUTLINE}>Cancel</button>
            <button onClick={handleRecordSale} disabled={recordingSale || !saleQtyOk} className={BTN_SOLID}>
              {recordingSale ? <><Loader2 size={15} className="animate-spin" /> Recording…</> : "Confirm sale"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteProductId} onOpenChange={(open) => { if (!open && !deletingProduct) setDeleteProductId(null); }}>
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold tracking-[-.02em]">Delete this product?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTargetName}</span> will be removed from
              the catalogue and disappear from the mobile app immediately. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={`${BTN_OUTLINE} mt-0`} disabled={deletingProduct}>Keep product</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deletingProduct}
              className="h-12 rounded-full bg-[hsl(var(--destructive))] px-6 text-[16px] font-bold text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              {deletingProduct ? "Deleting…" : "Delete product"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PhotoCropper
        file={cropFile}
        title="Adjust product photo"
        onCancel={() => setCropFile(null)}
        onDone={applyCrop}
      />
      <ManageCategoriesDialog
        type="product"
        open={showManageCategories}
        onClose={() => setShowManageCategories(false)}
        onAdded={(n) => { if (showAdd) setCategory(n); }}
        onRenamed={(o, n) => setCategory((cur) => (cur === o ? n : cur))}
      />
    </>
  );
}

/* ══════════════════ Supplies tab ══════════════════ */
type SuppliesFilter = "all" | "ok" | "low" | "out";

/* Supply (category under the name), Units on hand, Safety stock, Status, Actions.
   The name column takes the spare width and wraps to two lines. */
const SUPPLIES_COLS = "lg:grid-cols-[minmax(0,1fr)_170px_96px_150px_48px]";

function SuppliesTab({ focus }: { focus: FocusRequest }) {
  const queryClient = useQueryClient();
  const currentUserId = useAdminStore((s) => s.id);
  const { data: inventory = [], isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
  });
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["categories", "supply"],
    queryFn: () => fetchCategories("supply"),
  });
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useStoredFilter("pet-royale-inventory-category-supplies");
  // A saved category that has since been deleted or renamed would leave an
  // empty-looking list. Once categories have loaded, fall back to "All".
  useEffect(() => {
    if (categoriesLoading) return;
    if (categoryFilter !== "all" && !categories.some((c) => c.name === categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categories, categoriesLoading, categoryFilter]);
  const [statusFilter, setStatusFilter] = useState<SuppliesFilter>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newStock, setNewStock] = useState("");
  const [newSafety, setNewSafety] = useState(String(DEFAULT_SAFETY_STOCK));
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editSafety, setEditSafety] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<{ file: File; which: "new" | "edit" } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletingSupply, setDeletingSupply] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queued = useRef<Record<string, { item: InventoryItem; next: number }>>({});
  const userIdRef = useRef(currentUserId);
  userIdRef.current = currentUserId;

  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusHandled = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || focusHandled.current === focus.key) return;
    if (!inventory.some((i) => i.id === focus.id)) return;
    focusHandled.current = focus.key;
    setHighlightId(focus.id);
    requestAnimationFrame(() => {
      document.getElementById(`inventory-row-${focus.id}`)?.scrollIntoView({ block: "center" });
    });
  }, [focus, inventory]);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 6000);
    return () => clearTimeout(t);
  }, [highlightId]);

  /* Leaving the tab inside the 700ms window used to drop the change. Now any
     queued change is sent right away instead of cancelled. */
  useEffect(() => {
    const t = timers.current;
    const q = queued.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
      Object.values(q).forEach(({ item, next }) => {
        updateStock(item.id, next, userIdRef.current)
          .then(() => queryClient.invalidateQueries({ queryKey: ["inventory"] }))
          .catch(() => toast.error(`Couldn't update stock for ${item.name}.`));
      });
    };
  }, [queryClient]);

  const displayStock = (item: InventoryItem) =>
    pending[item.id] !== undefined ? pending[item.id] : (item.stock || 0);

  const adjustStock = (item: InventoryItem, delta: number) => {
    const next = Math.max(0, displayStock(item) + delta);
    setPending((p) => ({ ...p, [item.id]: next }));
    clearTimeout(timers.current[item.id]);
    queued.current[item.id] = { item, next };
    timers.current[item.id] = setTimeout(async () => {
      delete queued.current[item.id];
      try {
        await updateStock(item.id, next, currentUserId);
        /* Wait for the refetch so the number doesn't flick back to the old value. */
        await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      } catch {
        toast.error(`Couldn't update stock for ${item.name}.`);
      } finally {
        /* Only clear if no newer click has replaced this value meanwhile. */
        setPending((p) => {
          if (p[item.id] !== next) return p;
          const { [item.id]: _drop, ...rest } = p;
          return rest;
        });
      }
    }, 700);
  };

  const kind = (i: InventoryItem): Exclude<SuppliesFilter, "all"> => {
    const s = i.stock || 0;
    return s === 0 ? "out" : s <= safetyOf(i) ? "low" : "ok";
  };

  /* Filter counts follow the search and category. */
  const base = inventory.filter((i) => {
    const q = search.toLowerCase();
    return (!q || i.name.toLowerCase().includes(q)) && (categoryFilter === "all" || i.category === categoryFilter);
  });
  const counts = {
    all: base.length,
    ok: base.filter((i) => kind(i) === "ok").length,
    low: base.filter((i) => kind(i) === "low").length,
    out: base.filter((i) => kind(i) === "out").length,
  };
  const filtered = base.filter((i) => statusFilter === "all" || kind(i) === statusFilter);

  const totalUnits = inventory.reduce((sum, i) => sum + (i.stock || 0), 0);
  const hasFilters = !!search || categoryFilter !== "all" || statusFilter !== "all";
  const clearFilters = () => { setSearch(""); setCategoryFilter("all"); setStatusFilter("all"); };

  // A chosen photo opens the cropper first; only the cropped square is kept.
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>, which: "new" | "edit") => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still opens the cropper
    if (file) setCropTarget({ file, which });
  };
  const applyCrop = (blob: Blob) => {
    if (!cropTarget) return;
    const cropped = croppedFile(blob, cropTarget.file);
    const reader = new FileReader();
    if (cropTarget.which === "new") {
      setNewImageFile(cropped);
      reader.onloadend = () => setNewImagePreview(reader.result as string);
    } else {
      setEditImageFile(cropped);
      reader.onloadend = () => setEditImagePreview(reader.result as string);
    }
    reader.readAsDataURL(cropped);
    setCropTarget(null);
  };

  const resetAddForm = () => {
    setNewName(""); setNewCategory(""); setNewStock("");
    setNewSafety(String(DEFAULT_SAFETY_STOCK));
    setNewImageFile(null); setNewImagePreview(null);
  };

  /* Stock must be a whole number, 0 or more. Typing it is required. */
  const newStockOk = isWholeNumber(newStock);
  const newSafetyOk = isWholeNumber(newSafety);
  const canAdd = !!newName.trim() && !!newCategory && newStockOk && newSafetyOk;
  const handleAdd = async () => {
    const cleanName = newName.trim();
    if (!cleanName || !newCategory || newStock === "") {
      toast.error("Please fill in name, category and starting stock.");
      return;
    }
    if (!newStockOk) { toast.error("Stock must be a whole number, 0 or more."); return; }
    if (!newSafetyOk) { toast.error("Safety stock must be a whole number, 0 or more."); return; }
    setLoading(true);
    try {
      let imageKey = "";
      if (newImageFile) imageKey = await uploadProductImage(newImageFile);
      const input = {
        name: cleanName,
        category: newCategory,
        stock: parseInt(newStock, 10),
        safety_stock: parseInt(newSafety, 10),
        image_key: imageKey,
      };
      await addInventoryItem(input);
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
    // Start from what the row shows, including a +/- change still waiting to save.
    setEditStock(String(displayStock(item)));
    setEditSafety(String(safetyOf(item)));
    setEditImageFile(null);
    setEditImagePreview(null);
  };

  const editStockOk = isWholeNumber(editStock);
  const editSafetyOk = isWholeNumber(editSafety);
  const canEdit = !!editName.trim() && !!editCategory && editStockOk && editSafetyOk;
  const handleEdit = async () => {
    const cleanName = editName.trim();
    if (!editItem || !cleanName || !editCategory || editStock === "") {
      toast.error("Please fill in name, category and stock.");
      return;
    }
    if (!editStockOk) { toast.error("Stock must be a whole number, 0 or more."); return; }
    if (!editSafetyOk) { toast.error("Safety stock must be a whole number, 0 or more."); return; }
    setLoading(true);
    try {
      let imageKey = editItem.image_key;
      if (editImageFile) imageKey = await uploadProductImage(editImageFile);
      /* This save sets the stock itself, so drop any +/- change still waiting
         to send. Otherwise it would arrive later and overwrite this save. */
      clearTimeout(timers.current[editItem.id]);
      delete timers.current[editItem.id];
      delete queued.current[editItem.id];
      const changes = {
        name: cleanName,
        category: editCategory,
        stock: parseInt(editStock, 10),
        safety_stock: parseInt(editSafety, 10),
        image_key: imageKey,
      };
      await updateInventoryItem(editItem.id, changes, currentUserId);
      const savedId = editItem.id;
      setPending((p) => {
        const { [savedId]: _drop, ...rest } = p;
        return rest;
      });
      toast.success("Supply updated.");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setEditItem(null);
    } catch { toast.error("Failed to update supply."); } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeletingSupply(true);
    try {
      await deleteInventoryItem(deleteId);
      toast.success("Supply removed from inventory.");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setDeleteId(null);
    } catch { toast.error("Failed to delete supply."); } finally { setDeletingSupply(false); }
  };

  const deleteTargetName = inventory.find((i) => i.id === deleteId)?.name;
  const editPreview = editImagePreview || (editItem ? getProductImage(editItem.image_key) : null);

  return (
    <>
      <div className={`${PAGE_WRAP} min-h-full bg-white pb-8`}>

        {/* ── One filter card: status pills, then the toolbar (same as Appointments) ── */}
        <div className={FILTER_CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<SuppliesFilter>
            label="Show supplies"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { key: "all", label: "All", count: counts.all },
              { key: "ok", label: "In stock", count: counts.ok },
              { key: "low", label: "Running low", count: counts.low, warn: true },
              { key: "out", label: "Out of stock", count: counts.out, warn: true },
            ]}
          />
          <InventoryExport />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField placeholder="Search supplies by name" value={search} onChange={setSearch} className="min-w-[200px] flex-1 basis-[200px]" />
            <SelectField
              label="Category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="min-w-[180px] shrink-0"
            >
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </SelectField>
            <button
              onClick={() => setShowManageCategories(true)}
              className={`${BTN_SM_OUTLINE} shrink-0`}
            >
              <Settings2 size={16} aria-hidden="true" />
              Categories
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className={`${BTN_SM_SOLID} shrink-0`}
            >
              <Plus size={16} strokeWidth={2.6} aria-hidden="true" />
              Add supply
            </button>
          </div>
        </div>

        {/* ── Table ── */}
        <div className={TABLE_CARD}>
          <div className={`${TABLE_HEAD} ${SUPPLIES_COLS}`}>
            <span>Supply</span>
            <span>Units on hand</span>
            <span className="text-right">Safety stock</span>
            <span className="lg:pl-4">Status</span>
            <span className="text-right">Action</span>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
              <span className="sr-only">Loading</span>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Box}
              title={hasFilters ? "No supplies match these filters" : "No supplies tracked yet"}
              hint={hasFilters ? "Try a different name, category or filter." : "Add the medicines and materials the clinic keeps on hand."}
              hasFilters={hasFilters} onClear={clearFilters} onAdd={() => setShowAdd(true)} addLabel="Add your first supply"
            />
          ) : (
            <>
              {filtered.map((item) => {
                const img = getProductImage(item.image_key);
                const stock = displayStock(item);
                const safety = safetyOf(item);
                const status = supplyStockStatus(stock, safety);
                const StatusIcon = status.icon;
                const isSyncing = pending[item.id] !== undefined;
                return (
                  <div
                    key={item.id}
                    id={`inventory-row-${item.id}`}
                    className={`${ROW_BASE} ${SUPPLIES_COLS} ${
                      highlightId === item.id ? "bg-[hsl(var(--accent)/.18)]" : "hover:bg-[hsl(var(--muted)/.35)]"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <Thumb src={img} contain fallback={<Box className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />} />
                      <div className="min-w-0">
                        <span title={item.name} className={NAME_CLASS}>{item.name}</span>
                        <span className="block truncate text-[13px] text-[hsl(var(--muted-foreground))]" title={item.category}>{item.category}</span>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-2" role="group" aria-label={`Units of ${item.name}`}>
                      <button
                        onClick={() => adjustStock(item, -1)}
                        disabled={stock === 0}
                        aria-label={`Reduce ${item.name} by one`}
                        className={`flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[hsl(var(--card))] ${FOCUS_RING}`}
                      >
                        <Minus size={16} aria-hidden="true" />
                      </button>
                      <span className="w-10 text-center text-[15px] font-semibold tabular-nums">{stock}</span>
                      <button
                        onClick={() => adjustStock(item, 1)}
                        aria-label={`Add one to ${item.name}`}
                        className={`flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] ${FOCUS_RING}`}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                      {isSyncing && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" />}
                    </div>
                    <p className="text-[15px] tabular-nums text-[hsl(var(--muted-foreground))] lg:text-right">
                      <span className={STACK_LABEL}>Safety stock</span>{safety}
                    </p>
                    <div className="lg:pl-4">
                      <span className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold ${status.pill}`}>
                        <StatusIcon size={14} strokeWidth={2.6} aria-hidden="true" />
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-start lg:justify-end">
                      <RowMenu
                        label={`Manage ${item.name}`}
                        items={[
                          { text: "Edit supply", onClick: () => openEdit(item) },
                          { text: "Delete supply", danger: true, onClick: () => setDeleteId(item.id) },
                        ]}
                      />
                    </div>
                  </div>
                );
              })}
              <div className={TABLE_FOOT}>
                Showing <span className="font-bold text-[hsl(var(--foreground))]">{filtered.length}</span> of {inventory.length} · {totalUnits.toLocaleString()} units in total
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add supply */}
      <Dialog open={showAdd} onOpenChange={(open) => { if (!open && !loading) { setShowAdd(false); resetAddForm(); } }}>
        <DialogContent className={`${DLG} max-w-[640px]`}>
          <DialogHead
            title="Add supply"
            description="Enter the name, category and starting stock for a new supply."
            onClose={() => { setShowAdd(false); resetAddForm(); }}
            disabled={loading}
          />
          <div className={DLG_BODY}>
            <FormGroup title="Details">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput label="Supply name" value={newName} onChange={setNewName} autoComplete="off" />
                <LabeledSelect
                  label="Category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  action={<button type="button" onClick={() => setShowManageCategories(true)} className={LINK_ACTION}>Manage categories</button>}
                >
                  <option value="">Select a category</option>
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </LabeledSelect>
              </div>
            </FormGroup>
            <FormGroup title="Stock" note="Shows as Running low when units reach the safety stock level.">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput
                  label="Starting stock" type="number" min="0" step="1" inputMode="numeric" value={newStock} onChange={setNewStock}
                  error={newStock !== "" && !newStockOk ? "Use a whole number, 0 or more." : undefined}
                />
                <LabeledInput
                  label="Safety stock level" type="number" min="0" step="1" inputMode="numeric" value={newSafety} onChange={setNewSafety}
                  error={!newSafetyOk ? "Use a whole number, 0 or more." : undefined}
                />
              </div>
            </FormGroup>
            <FormGroup title="Photo">
              <PhotoPicker
                id="supply-photo-new"
                preview={newImagePreview}
                fileName={newImageFile?.name}
                onSelect={(e) => handleImageSelect(e, "new")}
                size={56}
                contain
                fallback={<Box className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />}
              />
            </FormGroup>
          </div>
          <div className={DLG_FOOT}>
            <button onClick={() => { setShowAdd(false); resetAddForm(); }} disabled={loading} className={BTN_SM_OUTLINE}>Cancel</button>
            <button onClick={handleAdd} disabled={loading || !canAdd} className={BTN_SM_SOLID}>
              {loading ? <><Loader2 size={15} className="animate-spin" /> Adding…</> : "Add supply"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit supply: same form as Add */}
      <Dialog open={!!editItem} onOpenChange={(open) => { if (!open && !loading) setEditItem(null); }}>
        <DialogContent className={`${DLG} max-w-[640px]`}>
          <DialogHead
            title="Edit supply"
            description="Change this supply's name, category and units on hand."
            onClose={() => setEditItem(null)}
            disabled={loading}
          />
          <div className={DLG_BODY}>
            <FormGroup title="Details">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput label="Supply name" value={editName} onChange={setEditName} autoComplete="off" />
                <LabeledSelect
                  label="Category"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  action={<button type="button" onClick={() => setShowManageCategories(true)} className={LINK_ACTION}>Manage categories</button>}
                >
                  <option value="">Select a category</option>
                  {editCategory && !categories.some((c) => c.name === editCategory) && <option value={editCategory}>{editCategory}</option>}
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </LabeledSelect>
              </div>
            </FormGroup>
            <FormGroup title="Stock" note="Shows as Running low when units reach the safety stock level.">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput
                  label="Units on hand" type="number" min="0" step="1" inputMode="numeric" value={editStock} onChange={setEditStock}
                  error={editStock !== "" && !editStockOk ? "Use a whole number, 0 or more." : undefined}
                />
                <LabeledInput
                  label="Safety stock level" type="number" min="0" step="1" inputMode="numeric" value={editSafety} onChange={setEditSafety}
                  error={!editSafetyOk ? "Use a whole number, 0 or more." : undefined}
                />
              </div>
            </FormGroup>
            <FormGroup title="Photo">
              <PhotoPicker
                id="supply-photo-edit"
                preview={editPreview}
                fileName={editImageFile?.name}
                onSelect={(e) => handleImageSelect(e, "edit")}
                size={56}
                contain
                fallback={<Box className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />}
              />
            </FormGroup>
          </div>
          <div className={DLG_FOOT}>
            <button onClick={() => setEditItem(null)} disabled={loading} className={BTN_SM_OUTLINE}>Cancel</button>
            <button onClick={handleEdit} disabled={loading || !canEdit} className={BTN_SM_SOLID}>
              {loading ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save changes"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open && !deletingSupply) setDeleteId(null); }}>
        <AlertDialogContent className="rounded-[28px] border border-[hsl(var(--card-border))] bg-[hsl(var(--background))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold tracking-[-.02em]">Delete this supply?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed text-[hsl(var(--muted-foreground))]">
              <span className="font-semibold text-[hsl(var(--foreground))]">{deleteTargetName}</span> will be removed from
              inventory. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={`${BTN_OUTLINE} mt-0`} disabled={deletingSupply}>Keep supply</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deletingSupply}
              className="h-12 rounded-full bg-[hsl(var(--destructive))] px-6 text-[16px] font-bold text-[hsl(var(--destructive-foreground))] hover:opacity-90"
            >
              {deletingSupply ? "Deleting…" : "Delete supply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PhotoCropper
        file={cropTarget?.file ?? null}
        title="Adjust supply photo"
        onCancel={() => setCropTarget(null)}
        onDone={applyCrop}
      />
      <ManageCategoriesDialog
        type="supply"
        open={showManageCategories}
        onClose={() => setShowManageCategories(false)}
        onAdded={(n) => {
          if (showAdd) setNewCategory(n);
          else if (editItem) setEditCategory(n);
        }}
        onRenamed={(o, n) => {
          setNewCategory((cur) => (cur === o ? n : cur));
          setEditCategory((cur) => (cur === o ? n : cur));
        }}
      />
    </>
  );
}
