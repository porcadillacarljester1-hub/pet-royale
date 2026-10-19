ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS break_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS break_end_at TIMESTAMPTZ;

ALTER TABLE public.staff_attendance
  DROP CONSTRAINT IF EXISTS staff_attendance_break_interval_check,
  ADD CONSTRAINT staff_attendance_break_interval_check
    CHECK (
      (break_start_at IS NULL AND break_end_at IS NULL)
      OR (
        break_start_at IS NOT NULL
        AND break_end_at IS NOT NULL
        AND break_end_at > break_start_at
      )
    ),
  DROP CONSTRAINT IF EXISTS staff_attendance_break_within_shift_check,
  ADD CONSTRAINT staff_attendance_break_within_shift_check
    CHECK (
      break_start_at IS NULL
      OR (
        (clock_in_at IS NULL OR break_start_at >= clock_in_at)
        AND (clock_out_at IS NULL OR break_end_at <= clock_out_at)
      )
    ),
  DROP CONSTRAINT IF EXISTS staff_attendance_absence_has_no_clock_times_check,
  ADD CONSTRAINT staff_attendance_absence_has_no_clock_times_check
    CHECK (
      status NOT IN ('absent', 'on_leave')
      OR (
        clock_in_at IS NULL
        AND clock_out_at IS NULL
        AND break_minutes = 0
        AND break_start_at IS NULL
        AND break_end_at IS NULL
      )
    );

CREATE TABLE IF NOT EXISTS public.staff_attendance_schedule (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  time_in TIME,
  break_start TIME,
  break_end TIME,
  time_out TIME,
  updated_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_attendance_schedule_times_check
    CHECK (
      (time_in IS NULL AND break_start IS NULL AND break_end IS NULL AND time_out IS NULL)
      OR (
        time_in IS NOT NULL
        AND break_start IS NOT NULL
        AND break_end IS NOT NULL
        AND time_out IS NOT NULL
        AND break_start > time_in
        AND break_end > break_start
        AND break_end < time_out
      )
    )
);

INSERT INTO public.staff_attendance_schedule (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.staff_attendance_schedule ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.staff_attendance_schedule TO authenticated;

DROP POLICY IF EXISTS "Active admins can read attendance schedule" ON public.staff_attendance_schedule;
CREATE POLICY "Active admins can read attendance schedule"
  ON public.staff_attendance_schedule
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff AS viewer
      WHERE viewer.user_id = auth.uid()
        AND viewer.status = 'active'
        AND viewer.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Clinic Owner can update attendance schedule" ON public.staff_attendance_schedule;
CREATE POLICY "Clinic Owner can update attendance schedule"
  ON public.staff_attendance_schedule
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff AS viewer
      WHERE viewer.user_id = auth.uid()
        AND viewer.status = 'active'
        AND viewer.role = 'admin'
        AND (
          viewer.protected = TRUE
          OR regexp_replace(lower(coalesce(viewer.job_title, '')), '[^a-z0-9]', '', 'g') = 'clinicowner'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff AS viewer
      WHERE viewer.user_id = auth.uid()
        AND viewer.status = 'active'
        AND viewer.role = 'admin'
        AND (
          viewer.protected = TRUE
          OR regexp_replace(lower(coalesce(viewer.job_title, '')), '[^a-z0-9]', '', 'g') = 'clinicowner'
        )
    )
  );

DROP TRIGGER IF EXISTS update_staff_attendance_schedule_updated_at ON public.staff_attendance_schedule;
CREATE TRIGGER update_staff_attendance_schedule_updated_at
  BEFORE UPDATE ON public.staff_attendance_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
