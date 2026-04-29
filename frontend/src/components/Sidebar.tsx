import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Inbox, Package, FileBarChart, LogOut } from "lucide-react";
import { useAdminStore } from "@/store/adminStore";

const allNavItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", adminOnly: false },
  { to: "/clients", icon: Users, label: "Clients & Pets", adminOnly: false },
  { to: "/appointments", icon: Inbox, label: "Appointments", adminOnly: false },
  { to: "/inventory", icon: Package, label: "Inventory", adminOnly: false },
  { to: "/history", icon: FileBarChart, label: "History", adminOnly: false },
  { to: "/reports", icon: FileBarChart, label: "Reports", adminOnly: true },
  { to: "/staff", icon: Users, label: "Staff Management", adminOnly: true },
];

export default function Sidebar() {
  const logout = useAdminStore((s) => s.logout);
  const role = useAdminStore((s) => s.role);
  const email = useAdminStore((s) => s.email);
  const navigate = useNavigate();

  const navItems = allNavItems.filter(
    (item) => !item.adminOnly || role === "admin"
  );

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <aside className="w-60 flex-shrink-0 bg-sidebar-bg flex flex-col">
      <div className="p-4 border-b border-sidebar-hover">
        <h2 className="text-sidebar-fg font-semibold text-sm tracking-wide uppercase">Navigation</h2>
      </div>

      {/* Profile Section */}
      <div className="p-4 border-b border-sidebar-hover flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {email ? email[0].toUpperCase() : "?"}
        </div>
        <div className="overflow-hidden">
          <p className="text-sidebar-fg text-sm font-medium truncate">{email}</p>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            role === "admin"
              ? "bg-blue-100 text-blue-700"
              : "bg-green-100 text-green-700"
          }`}>
            {role === "admin" ? "Admin" : "Staff"}
          </span>
        </div>
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