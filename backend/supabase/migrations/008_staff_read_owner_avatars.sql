-- Allow active clinic staff to verify owner profile photos in the dashboard.
-- Owner accounts retain their existing policies for inserting and reading
-- their own avatar history rows.

ALTER TABLE public.user_avatar_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view owner avatars" ON public.user_avatar_history;
CREATE POLICY "Staff can view owner avatars"
ON public.user_avatar_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.staff
    WHERE staff.user_id = auth.uid()
      AND staff.status = 'active'
  )
);
