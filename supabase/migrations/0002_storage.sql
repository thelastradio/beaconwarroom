-- Photo proof storage: private bucket, files stored as <event_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and public.is_member(((storage.foldername(name))[1])::uuid));

create policy proofs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and public.can_act(((storage.foldername(name))[1])::uuid));
