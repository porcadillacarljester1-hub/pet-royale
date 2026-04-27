# Realtime Notification Troubleshooting

## Why Stock Updates Aren't Triggering Notifications

### **Step 1: Check Browser Console**
Open your browser's developer tools (F12) and look for these logs when updating stock:

#### ✅ **Expected Logs (Working):**
```
🚀 Initializing realtime service...
📡 Inventory realtime subscription status: SUBSCRIBED
🔄 Updating stock: { id: "item-id", newStock: 3 }
✅ Stock updated successfully: [...]
🔄 Inventory UPDATE event received: { new: {...}, old: {...} }
📊 Stock comparison: { itemName: "...", oldStock: 10, newStock: 3, ... }
⚠️ Triggering LOW STOCK notification for: Item Name
```

#### ❌ **Problem Indicators:**
- No "🚀 Initializing realtime service" → Service not starting
- No "📡 Inventory realtime subscription status: SUBSCRIBED" → Realtime not connected
- No "🔄 Inventory UPDATE event received" → Database changes not detected
- No "⚠️ Triggering LOW STOCK notification" → Logic not working

### **Step 2: Test with RealtimeTester**
1. Go to Dashboard
2. Find an existing inventory item ID (check browser Network tab or console)
3. Use the "Realtime Test" component:
   - Enter the item ID
   - Click "Test Low Stock (3)" or "Test Out of Stock (0)"
   - Check console logs and notification bell

### **Step 3: Common Issues & Solutions**

#### **Issue 1: Realtime Not Enabled**
**Symptoms:** No subscription logs, no realtime events
**Solution:**
1. Go to Supabase Dashboard → Database → Replication
2. Ensure `inventory` table has **Realtime** enabled
3. Check RLS policies allow SELECT operations

#### **Issue 2: RLS Policies Blocking**
**Symptoms:** Subscription connects but no events received
**Solution:** Add this policy in SQL Editor:
```sql
CREATE POLICY "Allow realtime inventory access" ON inventory FOR SELECT TO authenticated USING (true);
```

#### **Issue 3: Service Not Initialized**
**Symptoms:** No initialization logs
**Solution:** Ensure you're logged in (realtime only works for authenticated users)

#### **Issue 4: Wrong Stock Comparison**
**Symptoms:** Events received but no notifications triggered
**Check:** The logic requires:
- Low Stock: `oldStock > 5 && newStock <= 5`
- Out of Stock: `oldStock > 0 && newStock === 0`

If you set stock directly to 0 from 10, it should trigger "Out of Stock".

#### **Issue 5: Database Connection**
**Symptoms:** General connection errors
**Solution:** Verify your `.env` file has correct Supabase credentials

### **Step 4: Manual Database Check**

Run this in Supabase SQL Editor to verify your setup:

```sql
-- Check if realtime is enabled
SELECT schemaname, tablename, rowsecurity, replident
FROM pg_catalog.pg_publication_tables
WHERE tablename = 'inventory';

-- Check RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'inventory';

-- Test manual update (replace 'your-item-id')
UPDATE inventory SET stock = 3 WHERE id = 'your-item-id';
```

### **Step 5: Debug Commands**

Add these to browser console for testing:

```javascript
// Check if realtime service is initialized
console.log('Realtime initialized:', window.realtimeService?.isInitialized);

// Check notification store
console.log('Notifications:', window.notificationStore?.getState().notifications);

// Manual stock update test
import { updateStock } from './src/api/inventory';
updateStock('your-item-id', 3);
```

### **Step 6: Alternative Testing**

If realtime isn't working, you can test notifications directly:

```javascript
// In browser console
import { useNotificationStore } from './src/store/notificationStore';

// Test low stock notification
useNotificationStore.getState().addNotification({
  type: 'inventory',
  title: 'Low Stock Alert',
  message: 'Test item is running low (3 remaining)',
  data: { id: 'test', name: 'Test Item' }
});

// Test out of stock notification
useNotificationStore.getState().addNotification({
  type: 'inventory',
  title: 'Out of Stock',
  message: 'Test item is now out of stock',
  data: { id: 'test', name: 'Test Item' }
});
```

### **Step 7: Reset Everything**

If nothing works, try this complete reset:

1. **Clear browser data:** Local Storage, Session Storage, Cookies
2. **Restart the app**
3. **Check Supabase dashboard** for any errors
4. **Verify environment variables** are loaded correctly

### **Expected Behavior**

When you update stock from the UI:
1. ✅ Database update succeeds
2. ✅ Realtime event fires
3. ✅ Notification appears in bell
4. ✅ Sound plays (if enabled)
5. ✅ Browser notification shows (if permitted)

If any step fails, check the corresponding logs and follow the troubleshooting steps above.