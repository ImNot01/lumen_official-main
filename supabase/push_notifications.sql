-- Run once in the Supabase SQL editor after replacing both placeholders:
--   1. Set the function URL to https://<project-ref>.supabase.co/functions/v1/send-push
--   2. Use a long random webhook secret; set the same value as
--      LUMEN_PUSH_WEBHOOK_SECRET when deploying the send-push function.
-- Generate a VAPID key pair with `npx web-push generate-vapid-keys`.
-- Put the public key in the frontend as VITE_VAPID_PUBLIC_KEY, and set
-- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, and
-- LUMEN_PUSH_WEBHOOK_SECRET as function secrets. Then deploy:
--   supabase functions deploy send-push --no-verify-jwt
--   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
--     VAPID_SUBJECT=mailto:you@example.com LUMEN_PUSH_WEBHOOK_SECRET=...
-- Also add VITE_VAPID_PUBLIC_KEY=... to the frontend .env and rebuild/redeploy.

create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/send-push',
  'lumen_push_function_url'
);
select vault.create_secret(
  'REPLACE_WITH_A_LONG_RANDOM_WEBHOOK_SECRET',
  'lumen_push_webhook_secret'
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2048
     or p_p256dh is null or char_length(p_p256dh) > 256
     or p_auth is null or char_length(p_auth) > 256 then
    raise exception 'Invalid push subscription';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        created_at = now();
end
$$;
revoke all on function public.register_push_subscription(text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text) to authenticated;

create or replace function public.push_new_message() returns trigger
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  function_url text;
  webhook_secret text;
begin
  select decrypted_secret into function_url
    from vault.decrypted_secrets where name = 'lumen_push_function_url' limit 1;
  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets where name = 'lumen_push_webhook_secret' limit 1;

  if function_url is null or webhook_secret is null
     or function_url like '%<project-ref>%' 
     or webhook_secret like 'REPLACE_WITH_%' then
    raise warning 'Lumen push is not configured; message push was skipped';
    return new;
  end if;

  perform net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', webhook_secret
    ),
    body := jsonb_build_object('message_id', new.id)
  );
  return new;
end
$$;

drop trigger if exists messages_push_notification_trg on public.messages;
create trigger messages_push_notification_trg
  after insert on public.messages
  for each row execute function public.push_new_message();

revoke all on function public.push_new_message() from public, anon, authenticated;

create table if not exists public.call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('offer', 'answer', 'candidate', 'hangup', 'decline', 'busy')),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 32768),
  created_at timestamptz not null default now(),
  constraint call_signals_no_self_call check (sender_id <> recipient_id)
);
create index if not exists call_signals_recipient_created_idx
  on public.call_signals (recipient_id, created_at);

create or replace function public.push_incoming_call() returns trigger
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  function_url text;
  webhook_secret text;
begin
  if new.type <> 'offer' then
    return new;
  end if;
  select decrypted_secret into function_url
    from vault.decrypted_secrets where name = 'lumen_push_function_url' limit 1;
  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets where name = 'lumen_push_webhook_secret' limit 1;
  if function_url is null or webhook_secret is null
     or function_url like '%<project-ref>%'
     or webhook_secret like 'REPLACE_WITH_%' then
    raise warning 'Lumen push is not configured; incoming call push was skipped';
    return new;
  end if;

  perform net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', webhook_secret
    ),
    body := jsonb_build_object('call_signal_id', new.id)
  );
  return new;
end
$$;
drop trigger if exists call_signals_push_notification_trg on public.call_signals;
create trigger call_signals_push_notification_trg
  after insert on public.call_signals
  for each row execute function public.push_incoming_call();
revoke all on function public.push_incoming_call() from public, anon, authenticated;

alter table public.call_signals enable row level security;
revoke all on public.call_signals from anon, authenticated;
grant select, insert, delete on public.call_signals to authenticated;

drop policy if exists call_signals_select_participants on public.call_signals;
create policy call_signals_select_participants on public.call_signals
  for select to authenticated using (
    (sender_id = auth.uid() or recipient_id = auth.uid())
    and public.is_member(conversation_id)
    and public.can_message(conversation_id)
    and exists (
      select 1
      from public.conversations c
      join public.conversation_members sender
        on sender.conversation_id = c.id and sender.user_id = call_signals.sender_id
      join public.conversation_members recipient
        on recipient.conversation_id = c.id and recipient.user_id = call_signals.recipient_id
      where c.id = call_signals.conversation_id and c.type = 'direct'
    )
  );
drop policy if exists call_signals_insert_sender on public.call_signals;
create policy call_signals_insert_sender on public.call_signals
  for insert to authenticated with check (
    sender_id = auth.uid()
    and recipient_id <> auth.uid()
    and public.is_member(conversation_id)
    and public.can_message(conversation_id)
    and exists (
      select 1
      from public.conversations c
      join public.conversation_members sender
        on sender.conversation_id = c.id and sender.user_id = auth.uid()
      join public.conversation_members recipient
        on recipient.conversation_id = c.id and recipient.user_id = call_signals.recipient_id
      where c.id = call_signals.conversation_id and c.type = 'direct'
    )
  );
drop policy if exists call_signals_delete_recipient on public.call_signals;
create policy call_signals_delete_recipient on public.call_signals
  for delete to authenticated using (recipient_id = auth.uid());

create or replace function public.purge_old_call_signals() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.call_signals where created_at < now() - interval '1 day';
  return new;
end
$$;
drop trigger if exists call_signals_purge_old_trg on public.call_signals;
create trigger call_signals_purge_old_trg
  after insert on public.call_signals
  for each row execute function public.purge_old_call_signals();
revoke all on function public.purge_old_call_signals() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_signals'
  ) then
    alter publication supabase_realtime add table public.call_signals;
  end if;
end
$$;

-- Private Realtime permissions for member-only typing/presence.
drop policy if exists lumen_private_realtime_select on realtime.messages;
create policy lumen_private_realtime_select
  on realtime.messages for select to authenticated
  using (
    (extension = 'presence' and topic = 'presence:online')
    or (
      extension = 'broadcast'
      and (
        topic = 'user:' || auth.uid()::text
        or (
          topic ~ '^conv:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and public.is_member(case
            when substring(topic from 6) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then substring(topic from 6)::uuid
            else null
          end)
        )
      )
    )
  );

drop policy if exists lumen_private_realtime_insert on realtime.messages;
create policy lumen_private_realtime_insert
  on realtime.messages for insert to authenticated
  with check (
    (
      extension = 'presence'
      and topic = 'presence:online'
    )
    or (
      extension = 'broadcast'
      and (
        topic ~ '^conv:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and public.is_member(case
            when substring(topic from 6) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then substring(topic from 6)::uuid
            else null
        end)
      )
    )
  );
