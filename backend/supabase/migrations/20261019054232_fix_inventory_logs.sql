-- Columns the app writes
alter table public.inventory_logs
  add column if not exists source_table text,
  add column if not exists source_id uuid;

-- Supplies and pet essentials aren't in products, so product_id can be empty
alter table public.inventory_logs
  alter column product_id drop not null;

-- If changed_by isn't a real staff member, save the log with it empty
-- instead of rejecting the whole row.
create or replace function public.inventory_logs_clean_changed_by()
returns trigger
language plpgsql
as $$
begin
  if new.changed_by is not null
     and not exists (select 1 from public.staff where id = new.changed_by) then
    new.changed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_logs_clean_changed_by on public.inventory_logs;
create trigger trg_inventory_logs_clean_changed_by
  before insert or update on public.inventory_logs
  for each row execute function public.inventory_logs_clean_changed_by();

notify pgrst, 'reload schema';