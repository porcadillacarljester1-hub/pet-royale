import { useState } from "react";
import { updateStock } from "@/api/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RealtimeTester() {
  const [itemId, setItemId] = useState("");
  const [stockValue, setStockValue] = useState("");

  const testLowStock = async () => {
    if (!itemId) {
      alert("Please enter an item ID first");
      return;
    }
    // Set stock to 3 (should trigger low stock alert)
    await updateStock(itemId, 3);
    alert("Set stock to 3 - check console and notifications");
  };

  const testOutOfStock = async () => {
    if (!itemId) {
      alert("Please enter an item ID first");
      return;
    }
    // Set stock to 0 (should trigger out of stock alert)
    await updateStock(itemId, 0);
    alert("Set stock to 0 - check console and notifications");
  };

  const testCustomStock = async () => {
    if (!itemId || !stockValue) {
      alert("Please enter both item ID and stock value");
      return;
    }
    await updateStock(itemId, parseInt(stockValue));
    alert(`Set stock to ${stockValue} - check console and notifications`);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Realtime Test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium">Item ID</label>
          <Input
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            placeholder="Enter inventory item ID"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={testLowStock} variant="outline" className="flex-1">
            Test Low Stock (3)
          </Button>
          <Button onClick={testOutOfStock} variant="outline" className="flex-1">
            Test Out of Stock (0)
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            value={stockValue}
            onChange={(e) => setStockValue(e.target.value)}
            placeholder="Custom stock"
            type="number"
          />
          <Button onClick={testCustomStock} variant="outline">
            Set Custom
          </Button>
        </div>

        <div className="text-sm text-muted-foreground">
          <p>• Open browser console to see realtime events</p>
          <p>• Check notification bell for alerts</p>
          <p>• Look for 🔄 and 📊 console logs</p>
        </div>
      </CardContent>
    </Card>
  );
}