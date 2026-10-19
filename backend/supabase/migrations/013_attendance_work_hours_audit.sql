ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS clock_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clock_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_by UUID;

ALTER TABLE public.staff_attendance
  DROP CONSTRAINT IF EXISTS staff_attendance_break_minutes_check,
  ADD CONSTRAINT staff_attendance_break_minutes_check
    CHECK (break_minutes BETWEEN 0 AND 1440),
  DROP CONSTRAINT IF EXISTS staff_attendance_clock_range_check,
  ADD CONSTRAINT staff_attendance_clock_range_check
    CHECK (clock_out_at IS NULL OR (clock_in_at IS NOT NULL AND clock_out_at > clock_in_at)),
  DROP CONSTRAINT IF EXISTS staff_attendance_absence_has_no_clock_times_check,
  ADD CONSTRAINT staff_attendance_absence_has_no_clock_times_check
    CHECK (
      status NOT IN ('absent', 'on_leave')
      OR (clock_in_at IS NULL AND clock_out_at IS NULL AND break_minutes = 0)
    );

CREATE TABLE IF NOT EXISTS public.staff_attendance_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attendance_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  old_record JSONB,
  new_record JSONB
);

CREATE INDEX IF NOT EXISTS staff_attendance_audit_staff_date_idx
  ON public.staff_attendance_audit (staff_id, changed_at DESC);

ALTER TABLE public.staff_attendance_audit ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.staff_attendance_audit TO authenticated;

DROP POLICY IF EXISTS "Active admins can read attendance audit" ON public.staff_attendance_audit;
CREATE POLICY "Active admins can read attendance audit"
  ON public.staff_attendance_audit
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

CREATE OR REPLACE FUNCTION public.audit_staff_attendance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.staff_attendance_audit (attendance_id, staff_id, changed_by, operation, new_record)
    VALUES (NEW.id, NEW.staff_id, auth.uid(), TG_OP, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.staff_attendance_audit (attendance_id, staff_id, changed_by, operation, old_record, new_record)
    VALUES (NEW.id, NEW.staff_id, auth.uid(), TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.staff_attendance_audit (attendance_id, staff_id, changed_by, operation, old_record)
    VALUES (OLD.id, OLD.staff_id, auth.uid(), TG_OP, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_staff_attendance_change ON public.staff_attendance;
CREATE TRIGGER audit_staff_attendance_change
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_staff_attendance_change();
