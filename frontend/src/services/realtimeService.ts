import { supabase } from "@/integrations/supabase/client";
import { useNotificationStore } from "@/store/notificationStore";

type QueryInvalidator = (queryKey: string[]) => void;

class RealtimeService {
  private channels: any[] = [];
  private isInitialized = false;
  private invalidateQuery: QueryInvalidator = () => {};

  // Call this from a React component to pass queryClient.invalidateQueries
  setQueryInvalidator(fn: QueryInvalidator) {
    this.invalidateQuery = fn;
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.setupAppointmentRealtime();
    this.setupInventoryRealtime();
    this.setupClientRealtime();
  }

  private setupAppointmentRealtime() {
    const channel = supabase
      .channel('appointments_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointments' },
        (payload) => {
          const appointment = payload.new as any;
          useNotificationStore.getState().addNotification({
            type: 'appointment',
            title: 'New Appointment Request',
            message: `${appointment.client_name} requested ${appointment.service} for ${appointment.pet_name}`,
            data: appointment,
          });
          this.invalidateQuery(['appointments']);
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments' },
        (payload) => {
          const appointment = payload.new as any;
          const oldAppointment = payload.old as any;

          if (appointment.status !== oldAppointment.status) {
            let title = 'Appointment Updated';
            let message = `Appointment for ${appointment.pet_name} status changed to ${appointment.status}`;

            if (appointment.status === 'confirmed') {
              title = 'Appointment Confirmed';
              message = `${appointment.client_name}'s appointment has been confirmed`;
            } else if (appointment.status === 'completed') {
              title = 'Appointment Completed';
              message = `${appointment.client_name}'s appointment has been completed`;
            }

            useNotificationStore.getState().addNotification({
              type: 'appointment',
              title,
              message,
              data: appointment,
            });
          }
          this.invalidateQuery(['appointments']);
        }
      )
      .subscribe();

    this.channels.push(channel);
  }

  private setupInventoryRealtime() {
    const channel = supabase
      .channel('inventory_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inventory' },
        (payload) => {
          const item = payload.new as any;
          const oldItem = payload.old as any;

          if (item.stock <= 5 && oldItem.stock > 5) {
            useNotificationStore.getState().addNotification({
              type: 'inventory',
              title: 'Low Stock Alert',
              message: `${item.name} is running low (${item.stock} remaining)`,
              data: item,
            });
          }

          if (item.stock === 0 && oldItem.stock > 0) {
            useNotificationStore.getState().addNotification({
              type: 'inventory',
              title: 'Out of Stock',
              message: `${item.name} is now out of stock`,
              data: item,
            });
          }

          this.invalidateQuery(['inventory']);
        }
      )
      .subscribe((status) => {
        console.log('📡 Inventory realtime subscription status:', status);
      });

    this.channels.push(channel);
  }

  private setupClientRealtime() {
    const channel = supabase
      .channel('clients_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clients' },
        (payload) => {
          const client = payload.new as any;
          useNotificationStore.getState().addNotification({
            type: 'client',
            title: 'New Client Registered',
            message: `${client.name} has registered as a new client`,
            data: client,
          });
          this.invalidateQuery(['clients']);
        }
      )
      .subscribe();

    this.channels.push(channel);
  }

  disconnect() {
    this.channels.forEach(channel => supabase.removeChannel(channel));
    this.channels = [];
    this.isInitialized = false;
  }
}

export const realtimeService = new RealtimeService();