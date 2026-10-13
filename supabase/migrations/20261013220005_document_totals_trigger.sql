-- P2d2a, 5/6. The totals are written when a document leaves 'draft', for EVERY role.
--
-- Why a trigger and not only finalize_document(): a CHECK can require that the totals are
-- present and add up, but it cannot read document_items, so it cannot know that they are
-- the RIGHT totals. Without this trigger a privileged
--   update documents set status = 'sent', total_ht = 1, ...
-- would store a wrong total, frozen forever. With it, whatever the caller sent is replaced
-- by what private.compute_totals() says about the lines of the document.
--
--   row is (or stays) a draft             the five totals are forced to NULL
--   row becomes non-draft (UPDATE from    the five totals are OVERWRITTEN from the lines
--     draft, or INSERT directly so)         and from new.timbre_fiscal
--   row was already non-draft             nothing: guard_documents() has frozen it
--
-- A document inserted directly as non-draft has no line yet (a line needs its document
-- first), so it gets zeros. Only a privileged role can do that, and it already could.
--
-- Order. BEFORE row triggers fire in alphabetical order, and CHECK constraints are
-- evaluated after all of them:
--   guard_document_conversion, guard_documents, set_document_totals, set_updated_at, CHECKs
-- so guard_documents has already refused a forbidden transition or a change to a frozen
-- document before this function runs, and the CHECKs see the totals it wrote.
--
-- No extra lock is needed: the row being written is already locked by this statement,
-- and any concurrent write on its lines waits on the FOR SHARE of guard_document_items(),
-- then reads a non-draft status and is refused (DF014).
--
-- SECURITY DEFINER: it must read document_items and call private.compute_totals()
-- whatever the role that issues the document.
create function private.set_document_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_totals record;
begin
  if new.status = 'draft' then
    new.total_ht := null;
    new.total_tva := null;
    new.total_ttc := null;
    new.net_a_payer := null;
    new.tva_breakdown := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    return new;
  end if;

  select t.* into v_totals
  from private.compute_totals(
    (
      select array_agg(row(i.quantity, i.unit_price, i.tva_rate)::private.document_line)
      from public.document_items i
      where i.organization_id = new.organization_id
        and i.document_id = new.id
    ),
    new.timbre_fiscal
  ) t;

  new.total_ht := v_totals.total_ht;
  new.total_tva := v_totals.total_tva;
  new.total_ttc := v_totals.total_ttc;
  new.net_a_payer := v_totals.net_a_payer;
  new.tva_breakdown := v_totals.tva_breakdown;
  return new;
end;
$$;
revoke all on function private.set_document_totals() from public, anon, authenticated, service_role;

create trigger set_document_totals before insert or update on public.documents
  for each row execute function private.set_document_totals();
