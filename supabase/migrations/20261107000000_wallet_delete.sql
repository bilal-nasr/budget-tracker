-- Allow deleting a wallet, but only an archived one. The foreign key from
-- transactions already refuses deletion while any transaction (including a
-- soft-deleted one) still points at the wallet, so history can never be lost.
create policy wallets_delete on public.wallets
  for delete using (user_id = (select auth.uid()) and archived_at is not null);
