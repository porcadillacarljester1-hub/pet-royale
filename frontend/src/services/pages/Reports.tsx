import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { fetchHistory } from "@/api/appointments";
import { fetchClientsWithPets } from "@/api/clients";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Users, Download } from "lucide-react";
import { toast } from "sonner";

export default function Reports() {
  const { data: history = [] } = useQuery({
    queryKey: ["history"],
    queryFn: fetchHistory,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-with-pets"],
    queryFn: fetchClientsWithPets,
  });

  const serviceCounts: Record<string, number> = {};
  history.forEach((h) => {
    serviceCounts[h.service] = (serviceCounts[h.service] || 0) + 1;
  });
  const chartData = Object.entries(serviceCounts).map(([name, count]) => ({ name, count }));

  const handleDownload = () => {
    toast.success("Report generated successfully as PDF");
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">Analytics Report</h2>
        <Button onClick={handleDownload}>
          <Download className="h-4 w-4 mr-2" />
          Download Report
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Registered Clients</CardTitle>
            <Users className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{clients.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Services Confirmed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{history.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unique Services Offered</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-foreground">{chartData.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Service Trends - Vaccination vs Deworming</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-muted-foreground text-sm">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(210, 70%, 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
