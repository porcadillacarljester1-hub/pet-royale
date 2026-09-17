import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchNotifications, type Notification } from "@/api/notifications";

const NAVY = "#1E3A5F";

export function NotificationBell() {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  const loadCount = useCallback(async () => {
    try {
      const data: Notification[] = await fetchNotifications();
      
      setUnreadCount(
        data.filter(
          (n) => !n.is_read && (n.type === "appointment" || n.type === "inventory")
        ).length
      );
    } catch {
      // A failed count shouldn't surface an error in the header.
    }
  }, []);

  useEffect(() => {
    void loadCount();

    const channel = (supabase as any)
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload: any) => {
          if (payload.eventType === "INSERT") {
            const type = (payload.new as any)?.type;
            if (type === "appointment" || type === "inventory") {
              setUnreadCount((c) => c + 1);
            }
          } else {
            // Reads and deletes both change the count in ways that are
            // easier to recount than to track incrementally.
            void loadCount();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadCount]);

  return (
    <button
      onClick={() => navigate("/notifications")}
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      className="relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-[#F1F5F9]"
    >
      <Bell className="h-5 w-5" style={{ color: NAVY }} />
      {unreadCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center ring-2 ring-white"
          style={{ backgroundColor: "#B91C1C" }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
