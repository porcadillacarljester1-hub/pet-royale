# Real-Time Notification System

This document explains how to set up and use the real-time notification system for the Pet Royale Admin application.

## Overview

The real-time notification system provides instant updates for:
- New appointment requests
- Appointment status changes
- Inventory stock alerts (low stock, out of stock)
- New client registrations
- Browser notifications (when permission is granted)

## Components

### 1. Notification Store (`src/store/notificationStore.ts`)
Manages notification state using Zustand:
- Stores notifications in memory
- Tracks unread count
- Handles browser notification permissions
- Provides methods to add, mark as read, and clear notifications

### 2. Realtime Service (`src/services/realtimeService.ts`)
Handles Supabase Realtime subscriptions:
- Subscribes to database changes on appointments, inventory, and clients tables
- Automatically triggers notifications based on events
- Invalidates React Query cache to refresh UI data

### 3. Notification Bell Component (`src/components/NotificationBell.tsx`)
UI component for displaying notifications:
- Bell icon with unread badge
- Dropdown popover showing notification list
- Mark as read and clear all functionality
- Formatted timestamps using date-fns

### 4. Notification Tester (`src/components/NotificationTester.tsx`)
Development component for testing notifications (temporary).

## Setup Instructions

### 1. Database Setup
Ensure your Supabase database has the required tables and RLS policies:

```sql
-- Enable realtime for tables
ALTER TABLE appointments REPLICA IDENTITY FULL;
ALTER TABLE inventory REPLICA IDENTITY FULL;
ALTER TABLE clients REPLICA IDENTITY FULL;

-- Ensure RLS policies allow reads (for realtime subscriptions)
CREATE POLICY "Allow authenticated users to read appointments" ON appointments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read inventory" ON inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read clients" ON clients FOR SELECT TO authenticated USING (true);
```

### 2. Supabase Realtime Configuration
In your Supabase dashboard:
1. Go to **Database** → **Replication**
2. Ensure the following tables have **Realtime** enabled:
   - `appointments`
   - `inventory`
   - `clients`

### 3. Browser Notification Permissions
The system automatically requests notification permissions when a user logs in. Users can also manually grant permissions through their browser settings.

## How It Works

### 1. Initialization
When a user logs in, the `RealtimeInitializer` component:
- Initializes the realtime service
- Requests browser notification permissions
- Sets up Supabase realtime subscriptions

### 2. Event Handling
The realtime service listens for:
- **INSERT** events on appointments (new requests)
- **UPDATE** events on appointments (status changes)
- **UPDATE** events on inventory (stock changes)
- **INSERT** events on clients (new registrations)

### 3. Notification Triggers
- **New Appointment**: Triggers when a new appointment is created
- **Appointment Confirmed**: Triggers when status changes to 'confirmed'
- **Low Stock Alert**: Triggers when stock drops to 5 or below
- **Out of Stock**: Triggers when stock reaches 0
- **New Client**: Triggers when a new client registers

### 4. UI Updates
- Notifications appear in the bell dropdown
- Unread count shows on the bell icon
- Browser notifications show (if permission granted)
- React Query cache is invalidated to refresh data

## Usage

### Viewing Notifications
1. Click the bell icon in the header
2. View notification list in the dropdown
3. Click on notifications to mark as read
4. Use "Mark all as read" or "Clear all" buttons

### Testing Notifications
During development, use the `NotificationTester` component on the Dashboard to trigger sample notifications.

## Customization

### Adding New Notification Types
1. Update the `Notification` interface in `notificationStore.ts`
2. Add new subscription logic in `realtimeService.ts`
3. Update notification styling in `NotificationBell.tsx`

### Modifying Triggers
Edit the conditions in `realtimeService.ts` to change when notifications are triggered.

### Custom Notification Messages
Modify the notification creation logic in `realtimeService.ts` to customize messages.

## Browser Support

- **Chrome/Edge**: Full support for notifications
- **Firefox**: Full support for notifications
- **Safari**: Limited support, may require user interaction
- **Mobile browsers**: Support varies, test on target devices

## Troubleshooting

### Notifications Not Appearing
1. Check browser console for errors
2. Verify Supabase realtime is enabled for tables
3. Ensure user is logged in (realtime only works for authenticated users)
4. Check RLS policies allow SELECT operations

### Browser Notifications Not Working
1. Check if permission was granted
2. Try refreshing the page and logging in again
3. Check browser settings for notification permissions

### Realtime Not Connecting
1. Verify Supabase URL and keys are correct
2. Check network connectivity
3. Ensure Supabase project allows realtime connections

## Sound Notifications

The system includes audio notifications that play when new notifications arrive:

### Sound Types:
- **Default Sound**: Appointments and general notifications
- **Alert Sound**: Critical inventory alerts (low stock, out of stock)
- **Success Sound**: Positive events (new clients, confirmations)

### User Controls:
- **Enable/Disable**: Toggle sound notifications on/off
- **Volume Control**: Adjust volume from 0-100%
- **Test Sound**: Preview the current sound settings

### Setup:
1. Add MP3 files to `public/` directory:
   - `notification.mp3` (default)
   - `alert.mp3` (urgent)
   - `success.mp3` (positive)
2. Sounds are automatically preloaded and respect user preferences

See `SOUND_NOTIFICATIONS.md` for complete audio setup guide.

## Performance

- Notifications are stored in memory only (not persisted)
- Maximum 50 notifications kept in history
- Realtime connections are cleaned up on logout
- React Query handles efficient data refetching