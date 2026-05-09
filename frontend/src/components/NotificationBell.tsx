import { useState, useEffect, useCallback } from "react";
import { Bell, BellRing, X, CheckCheck, Trash2, Volume2, VolumeX, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { fetchNotifications, markAsRead, markAllAsRead, deleteNotification, deleteAllNotifications, type Notification } from "@/api/notifications";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useNotificationStore } from "@/store/notificationStore";

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const {
    soundEnabled,
    soundVolume,
    setSoundEnabled,
    setSoundVolume,
    playSound,
  } = useNotificationStore();

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const loadNotifications = useCallback(async () => {
    try {
      const data = await fetchNotifications();
      setNotifications(data);
    } catch (error) {
      console.error('Failed to load notifications');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();

    const channel = (supabase as any)
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload: any) => {
          // ✅ instantly add new notification without refetching
          const newNotification = payload.new as Notification;
          setNotifications(prev => [newNotification, ...prev]);
          if (soundEnabled) playSound('default');
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [soundEnabled, loadNotifications, playSound]);

  const handleMarkAsRead = async (id: string) => {
    await markAsRead(id);
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    );
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead();
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    toast.success('All notifications marked as read');
  };

  const handleDelete = async (id: string) => {
    await deleteNotification(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
    toast.success('Notification deleted');
  };

  const handleDeleteAll = async () => {
    await deleteAllNotifications();
    setNotifications([]);
    toast.success('All notifications cleared');
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'appointment': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'inventory': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'client': return 'bg-green-100 text-green-700 border-green-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'appointment': return 'Appointment';
      case 'inventory': return 'Inventory';
      case 'client': return 'Client';
      default: return 'General';
    }
  };

  const getBorderColor = (type: string) => {
    switch (type) {
      case 'appointment': return '#3b82f6';
      case 'inventory': return '#f97316';
      case 'client': return '#22c55e';
      default: return '#6b7280';
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          {unreadCount > 0 ? (
            <BellRing className="h-5 w-5" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-96 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-foreground">
            Notifications {unreadCount > 0 && (
              <span className="text-sm text-muted-foreground font-normal">
                ({unreadCount} unread)
              </span>
            )}
          </h3>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
              className="h-8 px-2"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllAsRead}
                className="h-8 px-2"
                title="Mark all as read"
              >
                <CheckCheck className="h-4 w-4" />
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteAll}
                className="h-8 px-2"
                title="Delete all"
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>
        </div>

        {/* Sound Settings */}
        {showSettings && (
          <div className="px-4 py-3 border-b space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {soundEnabled ? (
                  <Volume2 className="h-4 w-4" />
                ) : (
                  <VolumeX className="h-4 w-4" />
                )}
                <span className="text-sm font-medium">Sound Notifications</span>
              </div>
              <Switch
                checked={soundEnabled}
                onCheckedChange={setSoundEnabled}
              />
            </div>
            {soundEnabled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Volume</span>
                  <span className="text-sm text-muted-foreground">
                    {Math.round(soundVolume * 100)}%
                  </span>
                </div>
                <Slider
                  value={[soundVolume]}
                  onValueChange={(value) => setSoundVolume(value[0])}
                  max={1}
                  min={0}
                  step={0.1}
                  className="w-full"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playSound('default')}
                  className="w-full"
                >
                  Test Sound
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Notification List */}
        <ScrollArea className="h-96">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-3 border-l-4 border-b hover:bg-muted/50 transition-colors ${
                  !notification.is_read ? 'bg-blue-50' : 'bg-background'
                }`}
                style={{ borderLeftColor: getBorderColor(notification.type) }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => !notification.is_read && handleMarkAsRead(notification.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant="outline"
                        className={`text-xs ${getTypeColor(notification.type)}`}
                      >
                        {getTypeLabel(notification.type)}
                      </Badge>
                      {!notification.is_read && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                      )}
                    </div>
                    <p className="font-medium text-sm leading-tight mb-1">
                      {notification.title}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {notification.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1">
                    {!notification.is_read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleMarkAsRead(notification.id)}
                        title="Mark as read"
                      >
                        <CheckCheck className="h-3.5 w-3.5 text-blue-500" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleDelete(notification.id)}
                      title="Delete"
                    >
                      <X className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}