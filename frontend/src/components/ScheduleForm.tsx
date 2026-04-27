import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { ClientWithPets } from "@/types";
import { createAppointment } from "@/api/appointments";
import { useQueryClient } from "@tanstack/react-query";

interface ScheduleFormProps {
  clients: ClientWithPets[];
}

export default function ScheduleForm({ clients }: ScheduleFormProps) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [petId, setPetId] = useState("");
  const [service, setService] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedClient = clients.find((c) => c.id === clientId);
  const selectedPet = selectedClient?.pets.find((p) => p.id === petId);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !petId || !service || !date || !time || !selectedClient || !selectedPet) {
      toast.error("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      await createAppointment({
        client_id: clientId,
        pet_id: petId,
        client_name: selectedClient.name,
        pet_name: selectedPet.name,
        pet_species: selectedPet.species,
        service,
        requested_date: date,
        scheduled_date: date,
        scheduled_time: time,
        status: "incoming",
      });
      toast.success(`Scheduled ${service} for ${selectedPet.name} on ${date} at ${time}`);
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setClientId("");
      setPetId("");
      setService("");
      setDate("");
      setTime("");
    } catch {
      toast.error("Failed to create appointment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-lg">New Schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSchedule} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">Client</label>
            <Select value={clientId} onValueChange={(v) => { setClientId(v); setPetId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedClient && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Pet</label>
              <Select value={petId} onValueChange={setPetId}>
                <SelectTrigger><SelectValue placeholder="Select a pet" /></SelectTrigger>
                <SelectContent>
                  {selectedClient.pets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.species})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">Service</label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Anti-Rabies Vaccine">Anti-Rabies Vaccine</SelectItem>
                <SelectItem value="Deworming">Deworming</SelectItem>
                <SelectItem value="5-in-1 Vaccine">5-in-1 Vaccine</SelectItem>
                <SelectItem value="Anti-Tick Treatment">Anti-Tick Treatment</SelectItem>
                <SelectItem value="General Checkup">General Checkup</SelectItem>
                <SelectItem value="Vitamin Supplement">Vitamin Supplement</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Time</label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Scheduling..." : "Schedule Appointment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
