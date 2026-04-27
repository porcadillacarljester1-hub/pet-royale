import AdminLayout from "@/components/AdminLayout";
import { useQuery } from "@tanstack/react-query";
import { fetchClientsWithPets } from "@/api/clients";
import ScheduleForm from "@/components/ScheduleForm";

export default function Scheduling() {
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-with-pets"],
    queryFn: fetchClientsWithPets,
  });

  return (
    <AdminLayout>
      <h2 className="text-2xl font-bold text-foreground mb-6">Schedule Vaccination / Deworming</h2>
      <ScheduleForm clients={clients} />
    </AdminLayout>
  );
}
