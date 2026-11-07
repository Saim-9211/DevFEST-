-- Supabase platform setup: private claim-photo bucket + realtime publication.
-- Skipped automatically where the Supabase `storage` schema doesn't exist (local test shim).
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not found; skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('claim-photos', 'claim-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$
    create policy claim_photos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'claim-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  $p$;
  execute $p$
    create policy claim_photos_select on storage.objects for select to authenticated
      using (bucket_id = 'claim-photos'
             and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))
  $p$;
end $$;

-- Realtime: live building progress for ambassadors and residents (RLS still applies to events).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping realtime setup';
    return;
  end if;
  alter publication supabase_realtime add table public.baskets, public.building_members;
end $$;
