// Quick realtime verification script
// Run this in browser console to test realtime setup

import { supabase } from './src/integrations/supabase/client';

console.log('🔍 Testing Realtime Setup...');

// Test 1: Check connection
console.log('1. Connection status:', supabase.auth.getUser());

// Test 2: Check realtime subscription
const channel = supabase
  .channel('test-inventory')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'inventory'
  }, (payload) => {
    console.log('✅ Realtime event received:', payload);
  })
  .subscribe((status) => {
    console.log('📡 Subscription status:', status);
  });

// Test 3: Manual database update
setTimeout(async () => {
  console.log('3. Testing manual update...');
  const { data, error } = await supabase
    .from('inventory')
    .update({ stock: 999 })
    .eq('id', 'test-id') // Replace with real ID
    .select();

  if (error) {
    console.error('❌ Update failed:', error);
  } else {
    console.log('✅ Update successful:', data);
  }
}, 2000);

// Cleanup after 10 seconds
setTimeout(() => {
  console.log('🧹 Cleaning up test subscription...');
  supabase.removeChannel(channel);
}, 10000);