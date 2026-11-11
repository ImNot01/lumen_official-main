-- =====================================================================
-- LUMEN - PHASE 1 DATABASE (run ONCE on a fresh Supabase project)
-- Supabase dashboard -> SQL Editor -> New query -> paste all -> Run
-- =====================================================================

-- ---------- TABLES ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  avatar_path text,
  bio text not null default '',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_.]{3,24}$'),
  constraint display_name_len check (char_length(display_name) between 1 and 50),
  constraint bio_len check (char_length(bio) <= 200)
);
create unique index profiles_username_key on public.profiles (lower(username));
create index profiles_username_prefix on public.profiles (lower(username) text_pattern_ops);
create index profiles_display_name_prefix on public.profiles (lower(display_name) text_pattern_ops);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  show_online boolean not null default true,
  show_last_seen boolean not null default true,
  read_receipts boolean not null default true,
  notifications_enabled boolean not null default true,
  theme text not null default 'system' check (theme in ('system','light','dark'))
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct','group')),
  name text check (name is null or char_length(name) between 1 and 60),
  avatar_path text,
  direct_key text unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint direct_has_key check (
    (type = 'direct' and direct_key is not null) or (type = 'group' and direct_key is null)
  )
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  pinned boolean not null default false,
  muted boolean not null default false,
  archived boolean not null default false,
  hidden boolean not null default false,
  cleared_at timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'text' check (kind in ('text','image','video','audio','voice','document','system')),
  body text check (body is null or char_length(body) <= 4000),
  reply_to_id uuid references public.messages(id) on delete set null,
  client_id uuid,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint text_needs_body check (
    deleted_at is not null or kind <> 'text' or (body is not null and char_length(btrim(body)) > 0)
  )
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create unique index messages_client_dedupe on public.messages (sender_id, client_id) where client_id is not null;

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 52428800),
  width integer,
  height integer,
  duration_ms integer,
  thumb_path text,
  created_at timestamptz not null default now()
);
create index message_attachments_message_idx on public.message_attachments (message_id);

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table public.message_deletions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now()
);

-- ---------- HELPER FUNCTIONS (used by security rules) ----------
create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members
                 where conversation_id = cid and user_id = auth.uid());
$$;

create or replace function public.is_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members
                 where conversation_id = cid and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_member_path(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then exists (select 1 from public.conversation_members
                 where conversation_id = p::uuid and user_id = auth.uid())
    else false
  end;
$$;

create or replace function public.can_access_message(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = mid and cm.user_id = auth.uid());
$$;

create or replace function public.can_message(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from public.conversations c
    join public.conversation_members o on o.conversation_id = c.id and o.user_id <> auth.uid()
    join public.blocked_users b on
         (b.blocker_id = auth.uid() and b.blocked_id = o.user_id)
      or (b.blocker_id = o.user_id and b.blocked_id = auth.uid())
    where c.id = cid and c.type = 'direct');
$$;

create or replace function public.is_username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(u));
$$;

-- ---------- NEW ACCOUNT -> PROFILE + SETTINGS ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text; dname text;
begin
  uname := lower(coalesce(new.raw_user_meta_data->>'username', ''));
  if uname !~ '^[a-z0-9_.]{3,24}$' then
    uname := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  dname := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), uname), 50);
  insert into public.profiles (id, username, display_name) values (new.id, uname, dname);
  insert into public.user_settings (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- MESSAGE TRIGGERS ----------
create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages where id = new.reply_to_id and conversation_id = new.conversation_id
  ) then
    raise exception 'Invalid reply target';
  end if;
  return new;
end $$;
create trigger messages_before_insert_trg before insert on public.messages
  for each row execute function public.messages_before_insert();

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.conversation_members set hidden = false
    where conversation_id = new.conversation_id and hidden = true;
  return new;
end $$;
create trigger messages_after_insert_trg after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.messages_before_update() returns trigger
language plpgsql as $$
begin
  if old.deleted_at is not null then
    raise exception 'Message was already deleted';
  end if;
  if new.deleted_at is not null then
    new.body := null;
    new.edited_at := old.edited_at;
  elsif new.body is distinct from old.body then
    if old.kind <> 'text' then
      raise exception 'Only text messages can be edited';
    end if;
    new.edited_at := now();
  end if;
  return new;
end $$;
create trigger messages_before_update_trg before update on public.messages
  for each row execute function public.messages_before_update();

-- ---------- RPC: START / FIND A PRIVATE CHAT (no duplicates) ----------
create or replace function public.get_or_create_direct(other_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text; cid uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if other_user is null or other_user = me then raise exception 'Invalid user'; end if;
  if not exists (select 1 from public.profiles where id = other_user) then
    raise exception 'User not found';
  end if;
  if exists (select 1 from public.blocked_users
             where (blocker_id = me and blocked_id = other_user)
                or (blocker_id = other_user and blocked_id = me)) then
    raise exception 'You cannot message this user';
  end if;
  k := least(me::text, other_user::text) || ':' || greatest(me::text, other_user::text);
  perform pg_advisory_xact_lock(hashtext(k));
  select id into cid from public.conversations where direct_key = k;
  if cid is null then
    insert into public.conversations (type, direct_key, created_by) values ('direct', k, me)
      returning id into cid;
    insert into public.conversation_members (conversation_id, user_id)
      values (cid, me), (cid, other_user);
  else
    update public.conversation_members set hidden = false
      where conversation_id = cid and user_id = me;
  end if;
  return cid;
end $$;

-- ---------- RPC: DELETE MY ACCOUNT ----------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- ROW LEVEL SECURITY ----------
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_deletions enable row level security;
alter table public.blocked_users enable row level security;
alter table public.reports enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy settings_select on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy settings_update on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy conversations_select on public.conversations for select to authenticated using (public.is_member(id));
create policy conversations_update on public.conversations for update to authenticated
  using (type = 'group' and public.is_admin(id)) with check (type = 'group' and public.is_admin(id));

create policy members_select on public.conversation_members for select to authenticated
  using (public.is_member(conversation_id));
create policy members_update_own on public.conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messages_select on public.messages for select to authenticated using (
  public.is_member(conversation_id)
  and not exists (select 1 from public.message_deletions d
                  where d.message_id = messages.id and d.user_id = auth.uid())
  and messages.created_at > coalesce(
        (select cm.cleared_at from public.conversation_members cm
         where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()),
        '-infinity'::timestamptz)
);
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and public.is_member(conversation_id) and public.can_message(conversation_id)
);
create policy messages_update_own on public.messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

create policy attachments_select on public.message_attachments for select to authenticated
  using (public.is_member(conversation_id));
create policy attachments_insert on public.message_attachments for insert to authenticated with check (
  exists (select 1 from public.messages m
          where m.id = message_id and m.sender_id = auth.uid()
            and m.conversation_id = message_attachments.conversation_id)
  and storage_path like (conversation_id::text || '/%')
);

create policy reactions_select on public.message_reactions for select to authenticated
  using (public.can_access_message(message_id));
create policy reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_message(message_id));
create policy reactions_delete on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

create policy deletions_select on public.message_deletions for select to authenticated using (user_id = auth.uid());
create policy deletions_insert on public.message_deletions for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_message(message_id));
create policy deletions_delete on public.message_deletions for delete to authenticated using (user_id = auth.uid());

create policy blocked_select on public.blocked_users for select to authenticated using (blocker_id = auth.uid());
create policy blocked_insert on public.blocked_users for insert to authenticated with check (blocker_id = auth.uid());
create policy blocked_delete on public.blocked_users for delete to authenticated using (blocker_id = auth.uid());

create policy reports_select on public.reports for select to authenticated using (reporter_id = auth.uid());
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid());

-- ---------- LOCK DOWN PERMISSIONS (least privilege) ----------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_path, bio, last_seen) on public.profiles to authenticated;
grant select on public.user_settings to authenticated;
grant update (show_online, show_last_seen, read_receipts, notifications_enabled, theme) on public.user_settings to authenticated;
grant select on public.conversations to authenticated;
grant update (name, avatar_path) on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant update (pinned, muted, archived, hidden, last_read_at, cleared_at) on public.conversation_members to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, kind, body, reply_to_id, client_id) on public.messages to authenticated;
grant update (body, edited_at, deleted_at) on public.messages to authenticated;
grant select, insert on public.message_attachments to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant select, insert, delete on public.message_deletions to authenticated;
grant select, insert, delete on public.blocked_users to authenticated;
grant select, insert on public.reports to authenticated;

revoke execute on function public.is_member(uuid), public.is_admin(uuid), public.is_member_path(text),
  public.can_access_message(uuid), public.can_message(uuid), public.get_or_create_direct(uuid),
  public.delete_my_account(), public.is_username_available(text) from public, anon, authenticated;
grant execute on function public.is_member(uuid), public.is_admin(uuid), public.is_member_path(text),
  public.can_access_message(uuid), public.can_message(uuid), public.get_or_create_direct(uuid),
  public.delete_my_account() to authenticated;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- ---------- STORAGE ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif']),
  ('chat-media', 'chat-media', false, 52428800, null)
on conflict (id) do nothing;

create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy chat_media_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and public.is_member_path((storage.foldername(name))[1]));
create policy chat_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and public.is_member_path((storage.foldername(name))[1]));

-- ---------- REALTIME ----------
alter table public.message_reactions replica identity full;
alter table public.conversation_members replica identity full;
alter publication supabase_realtime add table
  public.messages, public.message_reactions, public.conversation_members, public.conversations;
