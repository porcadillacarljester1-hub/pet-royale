-- Visit notifications: addressed to the owner, and worded "visit" to match
-- the app (the tab is "Visits", the button is "Book a visit").
--
-- Completed, before: "Major Major Major's appointment for Test (Grooming)
--                     has been marked as done."   (reads like it's for staff)
-- Completed, after:  "Your visit for Test (Grooming) is complete."
-- Confirmed, after:  "<Name>, your Grooming visit for Test has been confirmed."
--
-- The completed notification is skipped when the appointment has no owner
-- account (walk-ins have no client_id); otherwise the row would have no
-- recipient and show up in the staff list reading "Your visit...".
--
-- Rename this file with the next number in this folder, e.g.
-- 032_completed_notification_wording.sql
--
-- NOTE: the confirmed notification is written by confirmAppointment() in
-- src/api/appointments.ts (admin app), not by this trigger. Change its
-- title and message there too, or new confirmations will still say
-- "appointment".

CREATE OR REPLACE FUNCTION public.handle_appointment_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- New request — unchanged: no client_user_id, because it's
  -- genuinely addressed to staff.
  if TG_OP = 'INSERT' then
    insert into public.notifications (title, message, type)
    values (
      'New Appointment Request',
      NEW.client_name || ' booked ' || NEW.service || ' for ' || NEW.pet_name,
      'appointment'
    );
  end if;

  if TG_OP = 'UPDATE' and NEW.status != OLD.status then
    -- 'confirmed' insert removed — confirmAppointment already
    -- creates this notification, correctly addressed to the client.
    -- Keeping both was the actual duplicate.

    if NEW.status = 'completed' and NEW.client_id is not null then
      insert into public.notifications (title, message, type, client_user_id)
      values (
        'Visit Completed',
        'Your visit for ' || NEW.pet_name || ' (' || NEW.service || ') is complete.',
        'appointment',
        NEW.client_id
      );
    end if;
  end if;

  return NEW;
end;
$function$;

-- Bring existing notifications in line. Each statement only matches the
-- old wording, so running this again changes nothing.

-- 1. The oldest completed wording ("...marked as done.")
update public.notifications
set message = regexp_replace(
  message,
  '^.+''s appointment for (.+) \((.+)\) has been marked as done\.$',
  'Your appointment for \1 (\2) is complete.'
)
where title in ('Appointment Completed', 'Visit Completed')
  and message like '%has been marked as done.';

-- 2. "appointment" -> "visit" in the client-facing messages
update public.notifications
set message = replace(message, ' appointment for ', ' visit for ')
where title in ('Appointment Completed', 'Appointment Confirmed')
  and message like '% appointment for %';

-- 3. Titles
update public.notifications set title = 'Visit Completed' where title = 'Appointment Completed';
update public.notifications set title = 'Visit Confirmed'  where title = 'Appointment Confirmed';