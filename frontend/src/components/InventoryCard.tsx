import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Minus, Pencil, Trash2 } from "lucide-react";
import type { InventoryItem } from "@/types";

// Static image map for seed data
import rabisinImg from "@/assets/rabisin.jpg";
import nexgardImg from "@/assets/nexgard.jpg";
import royalcaninImg from "@/assets/royalcanin.jpg";
import vanguardplus5Img from "@/assets/vanguardplus5.jpg";
import nexgardspectraImg from "@/assets/nexgardspectra.jpg";
import simparicatrioImg from "@/assets/simparicatrio.jpg";
import lcvitImg from "@/assets/lcvit.jpg";
import aoziImg from "@/assets/aozi.jpg";
import whiskasImg from "@/assets/whiskas.jpg";
import rabbitpelletsImg from "@/assets/rabbitpellets.jpg";
import birdvitaminsImg from "@/assets/birdvitamins.jpg";
import leashcollarImg from "@/assets/leashcollar.jpg";
import steelbowlImg from "@/assets/steelbowl.jpg";
import groomingbrushImg from "@/assets/groomingbrush.jpg";
import hamsterwheelImg from "@/assets/hamsterwheel.jpg";

const imageMap: Record<string, string> = {
  rabisin: rabisinImg,
  nexgard: nexgardImg,
  royalcanin: royalcaninImg,
  vanguardplus5: vanguardplus5Img,
  nexgardspectra: nexgardspectraImg,
  simparicatrio: simparicatrioImg,
  lcvit: lcvitImg,
  aozi: aoziImg,
  whiskas: whiskasImg,
  rabbitpellets: rabbitpelletsImg,
  birdvitamins: birdvitaminsImg,
  leashcollar: leashcollarImg,
  steelbowl: steelbowlImg,
  groomingbrush: groomingbrushImg,
  hamsterwheel: hamsterwheelImg,
};

export function getProductImage(imageKey: string): string | null {
  // Check static map first, then treat as URL (for uploaded images)
  if (imageMap[imageKey]) return imageMap[imageKey];
  if (imageKey.startsWith("http")) return imageKey;
  return null;
}

function getStockBadge(stock: number) {
  if (stock === 0) return <Badge variant="destructive">Out of Stock</Badge>;
  if (stock < 10) return <Badge className="bg-warning text-warning-foreground">Low Stock</Badge>;
  return <Badge className="bg-success text-success-foreground">In Stock</Badge>;
}

interface InventoryCardProps {
  item: InventoryItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function InventoryCard({ item, onIncrement, onDecrement, onEdit, onDelete }: InventoryCardProps) {
  const img = getProductImage(item.image_key);

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="h-44 bg-muted flex items-center justify-center overflow-hidden">
        {img ? (
          <img src={img} alt={item.name} className="w-full h-full object-contain p-3" />
        ) : (
          <span className="text-muted-foreground text-sm">No Image</span>
        )}
      </div>
      <CardContent className="p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-semibold text-foreground leading-tight">{item.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{item.category}</p>
          </div>
          {getStockBadge(item.stock)}
        </div>
        <div className="flex-1" />
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={onDecrement}>
              <Minus className="h-3 w-3" />
            </Button>
            <span className="text-sm font-bold text-foreground w-8 text-center">{item.stock}</span>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={onIncrement}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
