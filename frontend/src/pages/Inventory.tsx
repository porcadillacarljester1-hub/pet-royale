import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchInventory, updateStock, addInventoryItem, updateInventoryItem, deleteInventoryItem, uploadProductImage } from "@/api/inventory";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus } from "lucide-react";
import { toast } from "sonner";
import InventoryCard, { getProductImage } from "@/components/InventoryCard";
import type { InventoryItem } from "@/types";

export default function Inventory() {
  const queryClient = useQueryClient();
  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
  });

  const [search, setSearch] = useState("");
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

  const filtered = inventory.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.category.toLowerCase().includes(search.toLowerCase())
  );

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

  const handleStockChange = async (id: string, newStockVal: number) => {
    try {
      await updateStock(id, newStockVal);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch {
      toast.error("Failed to update stock.");
    }
  };

  const handleAdd = async () => {
    if (!newName || !newCategory || !newStock) {
      toast.error("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      let imageKey = "";
      if (newImageFile) {
        imageKey = await uploadProductImage(newImageFile);
      }
      await addInventoryItem({
        name: newName,
        category: newCategory,
        stock: parseInt(newStock) || 0,
        image_key: imageKey,
      });
      toast.success("New supply added successfully!");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setShowAdd(false);
      setNewName("");
      setNewCategory("");
      setNewStock("");
      setNewImageFile(null);
      setNewImagePreview(null);
    } catch {
      toast.error("Failed to add supply.");
    } finally {
      setLoading(false);
    }
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
      toast.error("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      let imageKey = editItem.image_key;
      if (editImageFile) {
        imageKey = await uploadProductImage(editImageFile);
      }
      await updateInventoryItem(editItem.id, {
        name: editName,
        category: editCategory,
        stock: Math.max(0, parseInt(editStock) || 0),
        image_key: imageKey,
      });
      toast.success("Supply updated successfully!");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setEditItem(null);
    } catch {
      toast.error("Failed to update supply.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteInventoryItem(deleteId);
      toast.success("Supply deleted successfully!");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setDeleteId(null);
    } catch {
      toast.error("Failed to delete supply.");
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">Inventory of Supplies</h2>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add New Supply
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search inventory..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">No items found</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filtered.map((item) => (
            <InventoryCard
              key={item.id}
              item={item}
              onIncrement={() => handleStockChange(item.id, item.stock + 1)}
              onDecrement={() => handleStockChange(item.id, item.stock - 1)}
              onEdit={() => openEdit(item)}
              onDelete={() => setDeleteId(item.id)}
            />
          ))}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Supply</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Product Image</label>
              <Input type="file" accept="image/*" onChange={(e) => handleImageSelect(e, setNewImageFile, setNewImagePreview)} />
              {newImagePreview && (
                <img src={newImagePreview} alt="Preview" className="mt-2 h-24 w-24 object-contain rounded bg-muted p-1" />
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Product Name</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Enter product name" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Category</label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Vaccine">Vaccine</SelectItem>
                  <SelectItem value="Deworming">Deworming</SelectItem>
                  <SelectItem value="Supplement">Supplement</SelectItem>
                  <SelectItem value="Food">Food</SelectItem>
                  <SelectItem value="Accessory">Accessory</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Initial Stock</label>
              <Input type="number" value={newStock} onChange={(e) => setNewStock(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={loading}>{loading ? "Adding..." : "Add Supply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Supply</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Product Image</label>
              {editItem && getProductImage(editItem.image_key) && !editImagePreview && (
                <img src={getProductImage(editItem.image_key)!} alt="Current" className="mb-2 h-24 w-24 object-contain rounded bg-muted p-1" />
              )}
              {editImagePreview && (
                <img src={editImagePreview} alt="Preview" className="mb-2 h-24 w-24 object-contain rounded bg-muted p-1" />
              )}
              <Input type="file" accept="image/*" onChange={(e) => handleImageSelect(e, setEditImageFile, setEditImagePreview)} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Product Name</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Category</label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Vaccine">Vaccine</SelectItem>
                  <SelectItem value="Deworming">Deworming</SelectItem>
                  <SelectItem value="Supplement">Supplement</SelectItem>
                  <SelectItem value="Food">Food</SelectItem>
                  <SelectItem value="Accessory">Accessory</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Stock Count</label>
              <Input type="number" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={loading}>{loading ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supply</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this item? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
