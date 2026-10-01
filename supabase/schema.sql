-- Run in Supabase Dashboard > SQL Editor
create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  defaults jsonb not null default '["Task 1","Task 2","Task 3"]',
  remind_time text not null default '20:00',      -- 'HH:MM' in the user's timezone
  timezone text not null default 'Asia/Kolkata',
  whatsapp_phone text,                             -- digits with country code, e.g. 919876543210
  whatsapp_enabled boolean not null default false,
  last_sent_date text                              -- local date of last reminder = duplicate guard
);
create table days (
  user_id uuid references auth.users on delete cascade,
  date text,                                       -- 'YYYY-MM-DD' (user's local date)
  tasks jsonb not null,                            -- [{name, done} x3]
  primary key (user_id, date)
);
alter table profiles enable row level security;
alter table days enable row level security;
create policy own_profile on profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_days on days for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Telegram support (if you already ran the schema above, run just these two lines):
alter table profiles add column if not exists telegram_chat_id text;
alter table profiles add column if not exists telegram_enabled boolean not null default false;

-- ntfy support (if you already ran the schema above, run just these two lines):
alter table profiles add column if not exists ntfy_topic text;
alter table profiles add column if not exists ntfy_enabled boolean not null default false;

-- Follow-up reminders (run these two lines if the tables already exist):
alter table profiles add column if not exists sent_count int not null default 0;
alter table profiles add column if not exists last_sent_at timestamptz;