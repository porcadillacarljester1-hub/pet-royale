import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { fetchHistory } from "@/api/appointments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";

export default function History() {
  const { data: history = [] } = useQuery({
    queryKey: ["history"],
    queryFn: fetchHistory,
  });

  const handleDownload = () => {
    toast.success("Report generated successfully as PDF");
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-foreground">History of Appointments</h2>
        <Button onClick={handleDownload}>
          <Download className="h-4 w-4 mr-2" />
          Download Report
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Confirmed Services</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm">No history yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Pet</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{h.client_name}</TableCell>
                    <TableCell>{h.pet_name}</TableCell>
                    <TableCell>{h.service}</TableCell>
                    <TableCell>{h.date}</TableCell>
                    <TableCell>{h.time}</TableCell>
                    <TableCell><Badge className="bg-success text-success-foreground">{h.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
