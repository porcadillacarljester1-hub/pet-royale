import { useState } from "react";
import { useNotificationStore, type Notification } from "@/store/notificationStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Bell, BellRing, X, CheckCheck, Settings, Volume2, VolumeX } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    soundEnabled,
    soundVolume,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    setSoundEnabled,
    setSoundVolume,
    playSound
  } = useNotificationStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const handleMarkAsRead = (id: string) => {
    markAsRead(id);
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead();
  };

  const handleClearAll = () => {
    clearNotifications();
  };

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
  };

  const handleVolumeChange = (value: number[]) => {
    setSoundVolume(value[0]);
  };

  const testSound = () => {
    playSound('default');
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
      <PopoverContent className="w-80 p-0" align="end">
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Notifications</CardTitle>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSettings(!showSettings)}
                  className="h-8 px-2"
                >
                  <Settings className="h-4 w-4" />
                </Button>
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleMarkAllAsRead}
                    className="h-8 px-2"
                  >
                    <CheckCheck className="h-4 w-4" />
                  </Button>
                )}
                {notifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearAll}
                    className="h-8 px-2"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          {showSettings && (
            <CardContent className="border-b">
              <div className="space-y-4">
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
                    onCheckedChange={handleSoundToggle}
                  />
                </div>

                {soundEnabled && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Volume</span>
                      <span className="text-sm text-muted-foreground">{Math.round(soundVolume * 100)}%</span>
                    </div>
                    <Slider
                      value={[soundVolume]}
                      onValueChange={handleVolumeChange}
                      max={1}
                      min={0}
                      step={0.1}
                      className="w-full"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testSound}
                      className="w-full"
                    >
                      Test Sound
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          )}

          <CardContent className="p-0">
            <ScrollArea className="h-80">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No notifications yet</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkAsRead={handleMarkAsRead}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </PopoverContent>
    </Popover>
  );
}

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
}

function NotificationItem({ notification, onMarkAsRead }: NotificationItemProps) {
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'appointment':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'inventory':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'client':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div
      className={`p-3 border-l-4 cursor-pointer hover:bg-muted/50 transition-colors ${
        notification.read ? 'bg-background' : 'bg-muted/20'
      }`}
      style={{ borderLeftColor: getTypeColor(notification.type).split(' ')[1].replace('text-', '') }}
      onClick={() => !notification.read && onMarkAsRead(notification.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className={`text-xs ${getTypeColor(notification.type)}`}>
              {notification.type}
            </Badge>
            {!notification.read && (
              <div className="w-2 h-2 bg-blue-500 rounded-full" />
            )}
          </div>
          <h4 className="font-medium text-sm leading-tight mb-1">
            {notification.title}
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
          </p>
        </div>
      </div>
    </div>
  );
}