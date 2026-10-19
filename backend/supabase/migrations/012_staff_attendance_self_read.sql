DROP POLICY IF EXISTS "Active staff can read own attendance" ON public.staff_attendance;
CREATE POLICY "Active staff can read own attendance"
  ON public.staff_attendance
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff AS viewer
      WHERE viewer.id = staff_attendance.staff_id
        AND viewer.user_id = auth.uid()
        AND viewer.status = 'active'
        AND viewer.role = 'staff'
    )
  );
