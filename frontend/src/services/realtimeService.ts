import { supabase } from "@/integrations/supabase/client";
import { useNotificationStore } from "@/store/notificationStore";
import { useQueryClient } from "@tanstack/react-query";

class RealtimeService {
  private channels: any[] = [];
  private isInitialized = false;

  init() {
    if (this.isInitialized) {
      console.log('⚠️ Realtime service already initialized');
      return;
    }
    this.isInitialized = true;

    console.log('🚀 Initializing realtime service...');
    this.setupAppointmentRealtime();
    this.setupInventoryRealtime();
    this.setupClientRealtime();

    console.log('✅ Realtime service initialized');
  }

  private setupAppointmentRealtime() {
    const channel = supabase
      .channel('appointments_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'appointments',
        },
        (payload) => {
          console.log('New appointment:', payload.new);
          const appointment = payload.new as any;

          useNotificationStore.getState().addNotification({
            type: 'appointment',
            title: 'New Appointment Request',
            message: `${appointment.client_name} requested ${appointment.service} for ${appointment.pet_name}`,
            data: appointment,
          });

          // Invalidate queries to refresh data
          const queryClient = useQueryClient();
          queryClient.invalidateQueries({ queryKey: ['appointments'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'appointments',
        },
        (payload) => {
          console.log('Appointment updated:', payload.new);
          const appointment = payload.new as any;
          const oldAppointment = payload.old as any;

          // Only notify if status changed
          if (appointment.status !== oldAppointment.status) {
            let title = 'Appointment Updated';
            let message = `Appointment for ${appointment.pet_name} status changed to ${appointment.status}`;

            if (appointment.status === 'confirmed') {
              title = 'Appointment Confirmed';
              message = `${appointment.client_name} confirmed their appointment`;
            }

            useNotificationStore.getState().addNotification({
              type: 'appointment',
              title,
              message,
              data: appointment,
            });
          }

          // Invalidate queries
          const queryClient = useQueryClient();
          queryClient.invalidateQueries({ queryKey: ['appointments'] });
        }
      )
      .subscribe();

    this.channels.push(channel);
  }

  private setupInventoryRealtime() {
    const channel = supabase
      .channel('inventory_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'inventory',
        },
        (payload) => {
          console.log('🔄 Inventory UPDATE event received:', {
            new: payload.new,
            old: payload.old,
            eventType: payload.eventType
          });

          const item = payload.new as any;
          const oldItem = payload.old as any;

          console.log('📊 Stock comparison:', {
            itemName: item.name,
            oldStock: oldItem.stock,
            newStock: item.stock,
            wasAbove5: oldItem.stock > 5,
            isNowLow: item.stock <= 5,
            wasAbove0: oldItem.stock > 0,
            isNowZero: item.stock === 0
          });

          // Check for low stock
          if (item.stock <= 5 && oldItem.stock > 5) {
            console.log('⚠️ Triggering LOW STOCK notification for:', item.name);
            useNotificationStore.getState().addNotification({
              type: 'inventory',
              title: 'Low Stock Alert',
              message: `${item.name} is running low (${item.stock} remaining)`,
              data: item,
            });
          }

          // Check for out of stock
          if (item.stock === 0 && oldItem.stock > 0) {
            console.log('🚫 Triggering OUT OF STOCK notification for:', item.name);
            useNotificationStore.getState().addNotification({
              type: 'inventory',
              title: 'Out of Stock',
              message: `${item.name} is now out of stock`,
              data: item,
            });
          }

          // Invalidate queries
          const queryClient = useQueryClient();
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
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
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'clients',
        },
        (payload) => {
          console.log('New client:', payload.new);
          const client = payload.new as any;

          useNotificationStore.getState().addNotification({
            type: 'client',
            title: 'New Client Registered',
            message: `${client.name} has registered as a new client`,
            data: client,
          });

          // Invalidate queries
          const queryClient = useQueryClient();
          queryClient.invalidateQueries({ queryKey: ['clients'] });
        }
      )
      .subscribe();

    this.channels.push(channel);
  }

  disconnect() {
    this.channels.forEach(channel => {
      supabase.removeChannel(channel);
    });
    this.channels = [];
    this.isInitialized = false;
    console.log('Realtime service disconnected');
  }
}

export const realtimeService = new RealtimeService();