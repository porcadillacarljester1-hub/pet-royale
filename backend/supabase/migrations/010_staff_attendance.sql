CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'on_leave', 'late', 'half_day')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS staff_attendance_date_idx
  ON public.staff_attendance (attendance_date);

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_attendance TO authenticated;

DROP POLICY IF EXISTS "Active admins can read staff attendance" ON public.staff_attendance;
CREATE POLICY "Active admins can read staff attendance"
  ON public.staff_attendance
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff
      WHERE staff.user_id = auth.uid()
        AND staff.status = 'active'
        AND staff.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Active admins can insert staff attendance" ON public.staff_attendance;
CREATE POLICY "Active admins can insert staff attendance"
  ON public.staff_attendance
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff
      WHERE staff.user_id = auth.uid()
        AND staff.status = 'active'
        AND staff.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Active admins can update staff attendance" ON public.staff_attendance;
CREATE POLICY "Active admins can update staff attendance"
  ON public.staff_attendance
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff
      WHERE staff.user_id = auth.uid()
        AND staff.status = 'active'
        AND staff.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff
      WHERE staff.user_id = auth.uid()
        AND staff.status = 'active'
        AND staff.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Active admins can delete staff attendance" ON public.staff_attendance;
CREATE POLICY "Active admins can delete staff attendance"
  ON public.staff_attendance
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff
      WHERE staff.user_id = auth.uid()
        AND staff.status = 'active'
        AND staff.role = 'admin'
    )
  );

DROP TRIGGER IF EXISTS update_staff_attendance_updated_at ON public.staff_attendance;
CREATE TRIGGER update_staff_attendance_updated_at
  BEFORE UPDATE ON public.staff_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
