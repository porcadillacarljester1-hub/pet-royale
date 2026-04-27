import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments } from "@/api/appointments";
import { fetchInventory } from "@/api/inventory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Bell, AlertTriangle } from "lucide-react";
import { RealtimeTester } from "@/components/RealtimeTester";

export default function Dashboard() {
  const { data: appointments = [] } = useQuery({
    queryKey: ["appointments"],
    queryFn: fetchAppointments,
  });
  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
  });

  const criticalItems = inventory.filter((i) => i.stock < 10);

  return (
    <AdminLayout>
      <h2 className="text-2xl font-bold text-foreground mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Requests</CardTitle>
            <CalendarClock className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{appointments.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Today's Notifications</CardTitle>
            <Bell className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{appointments.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Critical Stock Items</CardTitle>
            <AlertTriangle className="h-5 w-5 text-warning" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{criticalItems.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Critical Stock Items</CardTitle>
          </CardHeader>
          <CardContent>
            {criticalItems.length === 0 ? (
              <p className="text-muted-foreground text-sm">All items are well-stocked.</p>
            ) : (
              <div className="space-y-3">
                {criticalItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="font-medium text-foreground">{item.name}</p>
                      <p className="text-sm text-muted-foreground">{item.category}</p>
                    </div>
                    <Badge variant={item.stock === 0 ? "destructive" : "secondary"} className={item.stock > 0 && item.stock < 10 ? "bg-warning text-warning-foreground" : ""}>
                      {item.stock === 0 ? "Out of Stock" : `Low Stock - ${item.stock}`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <RealtimeTester />
      </div>
    </AdminLayout>
  );
}
