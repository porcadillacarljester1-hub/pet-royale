import { create } from "zustand";
import { audioManager, type SoundType } from "@/services/audioManager";

export interface Notification {
  id: string;
  type: 'appointment' | 'inventory' | 'client' | 'system';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  data?: any;
  soundPlayed?: boolean;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  soundEnabled: boolean;
  soundVolume: number;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read' | 'soundPlayed'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
  requestPermission: () => Promise<boolean>;
  showBrowserNotification: (title: string, options?: NotificationOptions) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundVolume: (volume: number) => void;
  playSound: (soundType: SoundType) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  soundEnabled: true,
  soundVolume: 0.5,

  addNotification: (notification) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString(),
      timestamp: new Date(),
      read: false,
      soundPlayed: false,
    };

    set((state) => ({
      notifications: [newNotification, ...state.notifications].slice(0, 50), // Keep last 50
      unreadCount: state.unreadCount + 1,
    }));

    // Play sound if enabled
    if (get().soundEnabled && !newNotification.soundPlayed) {
      get().playSound(getSoundTypeForNotification(notification.type));
      newNotification.soundPlayed = true;
    }

    // Show browser notification if permission granted
    get().showBrowserNotification(notification.title, {
      body: notification.message,
      icon: '/favicon.ico',
      tag: notification.type,
    });
  },

  markAsRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  clearNotifications: () => {
    set({ notifications: [], unreadCount: 0 });
  },

  requestPermission: async () => {
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  },

  showBrowserNotification: (title, options) => {
    if (Notification.permission === 'granted') {
      new Notification(title, options);
    }
  },

  setSoundEnabled: (enabled) => {
    set({ soundEnabled: enabled });
    audioManager.setEnabled(enabled);
  },

  setSoundVolume: (volume) => {
    set({ soundVolume: volume });
    audioManager.setVolume(volume);
  },

  playSound: (soundType) => {
    audioManager.play(soundType);
  },
}));

// Helper function to determine sound type based on notification type
function getSoundTypeForNotification(type: string): SoundType {
  switch (type) {
    case 'inventory':
      return 'alert'; // More urgent for stock issues
    case 'appointment':
      return 'default'; // Standard for appointments
    case 'client':
      return 'success'; // Positive for new clients
    case 'system':
      return 'default';
    default:
      return 'default';
  }
}