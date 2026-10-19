// supabase/functions/notify-appointment-status/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req) => {
  // Reject callers that don't know the webhook secret.
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    const payload = await req.json();
    const { type, table, record, old_record } = payload;

    if (type !== 'UPDATE' || table !== 'appointments') {
      return new Response('ignored: not an appointment update', { status: 200 });
    }

    const oldStatus = old_record?.status;
    const newStatus = record?.status;

    if (oldStatus === newStatus) {
      return new Response('ignored: status unchanged', { status: 200 });
    }
    if (newStatus !== 'confirmed' && newStatus !== 'completed') {
      return new Response('ignored: not a notifiable status', { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: rows, error } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', record.client_id);

    if (error) {
      console.error('Failed to look up push tokens', error);
      return new Response('error looking up tokens', { status: 500 });
    }

    const tokens = (rows ?? []).map((r) => r.token as string);
    if (tokens.length === 0) {
      console.log('No push tokens for client', record.client_id);
      return new Response('no push tokens for this client', { status: 200 });
    }

    const title = newStatus === 'confirmed' ? 'Appointment Confirmed!' : 'Appointment Completed!';
    const body =
      newStatus === 'confirmed'
        ? `Your appointment for ${record.pet_name} (${record.service}) has been confirmed by the clinic.`
        : `Your appointment for ${record.pet_name} (${record.service}) has been marked as done.`;

    const pushResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title,
          body,
          sound: 'default',
          priority: 'high',
          channelId: 'default',
          data: { screen: '/(tabs)/appointments', appointmentId: record.id },
        }))
      ),
    });

    if (!pushResponse.ok) {
      const text = await pushResponse.text();
      console.error('Expo push API rejected the request', pushResponse.status, text);
      return new Response('push send failed', { status: 502 });
    }

    // Per-token failures come back inside a 200 response. Log every error,
    // and drop dead tokens.
    const result = await pushResponse.json();
    const dead: string[] = [];
    (result.data ?? []).forEach((t: any, i: number) => {
      if (t.status === 'error') {
        console.error('Expo ticket error', tokens[i], t.message, t.details);
        if (t.details?.error === 'DeviceNotRegistered') dead.push(tokens[i]);
      }
    });
    if (dead.length) await supabase.from('push_tokens').delete().in('token', dead);

    return new Response('notification sent', { status: 200 });
  } catch (err) {
    console.error('Unhandled error in notify-appointment-status', err);
    return new Response('error', { status: 500 });
  }
});