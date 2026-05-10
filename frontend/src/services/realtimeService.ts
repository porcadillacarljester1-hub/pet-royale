import { supabase } from "@/integrations/supabase/client";
import { useNotificationStore } from "@/store/notificationStore";

type QueryInvalidator = (queryKey: string[]) => void;

class RealtimeService {
  private channels: any[] = [];
  private isInitialized = false;
  private invalidateQuery: QueryInvalidator = () => {};

  setQueryInvalidator(fn: QueryInvalidator) {
    this.invalidateQuery = fn;
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.setupAppointmentRealtime();
    this.setupInventoryRealtime();
    this.setupNotificationRealtime();
  }

  private setupAppointmentRealtime() {
    const channel = supabase
      .channel('appointments_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointments' },
        (payload) => {
          console.log('🔔 New appointment:', payload.new);
          this.invalidateQuery(['appointments']);
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments' },
        (payload) => {
          console.log('📝 Appointment updated:', payload.new);
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
          console.log('📦 Inventory updated:', payload.new);
          this.invalidateQuery(['inventory']);
        }
      )
      .subscribe((status) => {
        console.log('📡 Inventory realtime subscription status:', status);
      });

    this.channels.push(channel);
  }

  // Listen for new notifications created by database triggers
  private setupNotificationRealtime() {
    const channel = supabase
      .channel('notifications_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const notification = payload.new as any;
          console.log('🎵 Playing notification sound for:', notification.title);
          
          // Play sound when notification is created
          useNotificationStore.getState().playSound(
            notification.type === 'inventory' ? 'alert' : 'default'
          );
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