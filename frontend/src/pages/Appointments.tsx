import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAppointments,
  confirmAppointment,
  completeAppointment,
  type Appointment
} from "@/api/appointments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, Loader2, CheckSquare } from "lucide-react";

export default function Appointments() {
  const queryClient = useQueryClient();
  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["appointments"],
    queryFn: fetchAppointments,
  });

  const incoming = appointments.filter((r) => r.status === "incoming");
  const confirmed = appointments.filter((r) => r.status === "confirmed");

  const handleConfirmAction = async (id: string) => {
    try {
      await confirmAppointment(id);
      toast.success("Appointment confirmed!");
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    } catch {
      toast.error("Failed to confirm appointment.");
    }
  };

  const handleCompleteAction = async (id: string) => {
    try {
      await completeAppointment(id);
      toast.success("Appointment marked as done!");
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["history"] });
    } catch {
      toast.error("Failed to complete appointment.");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "incoming": return <Badge className="bg-blue-500 text-white">Incoming</Badge>;
      case "confirmed": return <Badge className="bg-green-500 text-white">Confirmed</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const renderTable = (title: string, items: Appointment[], actionRenderer: (req: Appointment) => React.ReactNode) => (
    <Card className="mb-6 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">{title} ({items.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No records found in this section.</p>
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
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="font-medium">{req.client_name}</TableCell>
                  <TableCell>{req.pet_name} ({req.pet_species})</TableCell>
                  <TableCell>{req.service}</TableCell>
                  <TableCell>{req.requested_date}</TableCell>
                  <TableCell>{req.scheduled_time || '--'}</TableCell>
                  <TableCell>{getStatusBadge(req.status)}</TableCell>
                  <TableCell className="text-right">{actionRenderer(req)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <AdminLayout>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-foreground">Appointment Management</h2>
        {isLoading && <Loader2 className="animate-spin text-primary" />}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg">
          <Loader2 className="h-8 w-8 animate-spin mb-2" />
          <p>Connecting to Pet Royale Database...</p>
        </div>
      ) : (
        <>
          {renderTable("Incoming Requests", incoming, (req) => (
            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleConfirmAction(req.id)}>
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              Confirm
            </Button>
          ))}

          {renderTable("Confirmed (Ready for Clinic)", confirmed, (req) => (
            <Button size="sm" variant="outline" className="text-blue-600 border-blue-600 hover:bg-blue-50" onClick={() => handleCompleteAction(req.id)}>
              <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
              Mark Done
            </Button>
          ))}
        </>
      )}
    </AdminLayout>
  );
}