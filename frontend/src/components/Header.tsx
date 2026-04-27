import logo from "@/assets/PetRoyaleLogo.jpg";
import { NotificationBell } from "@/components/NotificationBell";

export default function Header() {
  return (
    <header className="h-16 bg-white border-b border-border flex-shrink-0 flex items-center justify-between px-4 gap-3">
      <div className="flex items-center gap-3">
        <img src={logo} alt="Pet Royale Logo" className="h-12 w-auto object-contain" />
        <h1 className="text-lg font-bold text-foreground tracking-tight">Pet Royale Admin System</h1>
      </div>
      <NotificationBell />
    </header>
  );
}
