import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Inbox, Calendar, Package, FileBarChart, LogOut } from "lucide-react";
import { useAdminStore } from "@/store/adminStore";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/clients", icon: Users, label: "Clients & Pets" },
  { to: "/appointments", icon: Inbox, label: "Appointments" },
  { to: "/scheduling", icon: Calendar, label: "Scheduling" },
  { to: "/inventory", icon: Package, label: "Inventory" },
  { to: "/history", icon: FileBarChart, label: "History" },
  { to: "/reports", icon: FileBarChart, label: "Reports" },
];

export default function Sidebar() {
  const logout = useAdminStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <aside className="w-60 flex-shrink-0 bg-sidebar-bg flex flex-col">
      <div className="p-4 border-b border-sidebar-hover">
        <h2 className="text-sidebar-fg font-semibold text-sm tracking-wide uppercase">Navigation</h2>
      </div>
      <nav className="flex-1 py-2 space-y-0.5 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-active text-primary-foreground"
                  : "text-sidebar-fg hover:bg-sidebar-hover"
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-2 border-t border-sidebar-hover">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-fg hover:bg-sidebar-hover w-full transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
