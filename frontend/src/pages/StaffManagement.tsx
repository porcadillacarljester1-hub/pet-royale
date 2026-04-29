import AdminLayout from "@/components/AdminLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

const fetchStaff = async () => {
  const { data, error } = await (supabase as any)
    .from("staff")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
};

export default function StaffManagement() {
  const queryClient = useQueryClient();
  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: fetchStaff,
  });

  const pending = staff.filter((s: any) => s.status === "pending");
  const approved = staff.filter((s: any) => s.status === "approved");
  const rejected = staff.filter((s: any) => s.status === "rejected");

  const handleApprove = async (id: string) => {
  try {
    await (supabase as any)
      .from("staff")
      .update({ status: "approved" })
      .eq("id", id);

    toast.success("Staff approved successfully!");
    queryClient.invalidateQueries({ queryKey: ["staff"] });
  } catch {
    toast.error("Failed to approve staff.");
  }
};
  const handleReject = async (id: string) => {
    try {
      await (supabase as any)
        .from("staff")
        .update({ status: "rejected" })
        .eq("id", id);

      toast.success("Staff rejected.");
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    } catch {
      toast.error("Failed to reject staff.");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge className="bg-yellow-500 text-white">Pending</Badge>;
      case "approved": return <Badge className="bg-green-500 text-white">Approved</Badge>;
      case "rejected": return <Badge className="bg-red-500 text-white">Rejected</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const renderTable = (title: string, items: any[], showActions: boolean) => (
    <Card className="mb-6 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">{title} ({items.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No records found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Full Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                {showActions && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.full_name}</TableCell>
                  <TableCell>{s.email}</TableCell>
                  <TableCell className="capitalize">{s.role}</TableCell>
                  <TableCell>{getStatusBadge(s.status)}</TableCell>
                  {showActions && (
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleApprove(s.id)}
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleReject(s.id)}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1.5" />
                        Reject
                      </Button>
                    </TableCell>
                  )}
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
        <h2 className="text-2xl font-bold text-foreground">Staff Management</h2>
        {isLoading && <Loader2 className="animate-spin text-primary" />}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg">
          <Loader2 className="h-8 w-8 animate-spin mb-2" />
          <p>Loading staff accounts...</p>
        </div>
      ) : (
        <>
          {renderTable("Pending Approval", pending, true)}
          {renderTable("Approved Staff", approved, false)}
          {renderTable("Rejected", rejected, false)}
        </>
      )}
    </AdminLayout>
  );
}