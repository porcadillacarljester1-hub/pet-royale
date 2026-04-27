import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  fetchAppointments, 
  sendAppointmentSchedule, 
  confirmAppointment, 
  type Appointment 
} from "@/api/appointments"; 
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCell as TableData, TableHeader as THeader, TableBody as TBody } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Send, CheckCircle, Loader2 } from "lucide-react";

export default function Appointments() {
  const queryClient = useQueryClient();
  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["appointments"],
    queryFn: fetchAppointments,
  });

  const [scheduleModal, setScheduleModal] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  // Filter lists from Supabase data
  const incoming = appointments.filter((r) => r.status === "incoming");
  const pendingClient = appointments.filter((r) => r.status === "pending_client");
  const confirmed = appointments.filter((r) => r.status === "confirmed");

  const handleSend = async () => {
    if (!scheduleModal || !date || !time) {
      toast.error("Please set both date and time.");
      return;
    }
    try {
      await sendAppointmentSchedule(scheduleModal, date, time);
      toast.success("Schedule sent to client.");
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setScheduleModal(null);
      setDate("");
      setTime("");
    } catch {
      toast.error("Failed to update database.");
    }
  };

  const handleConfirmAction = async (id: string) => {
    try {
      await confirmAppointment(id);
      toast.success("Appointment confirmed!");
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    } catch {
      toast.error("Failed to confirm appointment.");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "incoming": return <Badge className="bg-blue-500 text-white">Incoming</Badge>;
      case "pending_client": return <Badge className="bg-yellow-500 text-white">Pending Client</Badge>;
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
                <TableHead>Requested Date</TableHead>
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
                  <TableCell>{req.scheduled_date || req.requested_date}</TableCell>
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
            <Button size="sm" onClick={() => setScheduleModal(req.id)}>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Set Schedule
            </Button>
          ))}

          {renderTable("Pending Client Confirmation", pendingClient, (req) => (
            <Button size="sm" variant="outline" className="text-green-600 border-green-600 hover:bg-green-50" onClick={() => handleConfirmAction(req.id)}>
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              Mark Confirmed
            </Button>
          ))}

          {renderTable("Confirmed (Ready for Clinic)", confirmed, () => (
            <span className="text-muted-foreground text-sm italic">Scheduled</span>
          ))}
        </>
      )}

      {/* Schedule Modal */}
      <Dialog open={!!scheduleModal} onOpenChange={(open) => !open && setScheduleModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Appointment Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Time</label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleModal(null)}>Cancel</Button>
            <Button onClick={handleSend} className="bg-blue-600 hover:bg-blue-700">
              Update Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}