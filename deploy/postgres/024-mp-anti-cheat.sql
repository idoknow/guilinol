-- 联机反外挂：持久封禁（uid + 设备指纹）、作弊事件、设备映射
create table if not exists mp_bans (
  id          bigserial primary key,
  kind        text not null check (kind in ('uid','fp')),
  value       text not null,
  until_ms    bigint,                       -- null = 永久
  reason      text,
  actor       text,
  level       int  not null default 0,
  created_at  bigint not null
);
create unique index if not exists mp_bans_key on mp_bans(kind, value);
create index if not exists mp_bans_until on mp_bans(until_ms);

create table if not exists mp_cheat_events (
  id      bigserial primary key,
  uid     bigint,
  fp      text,
  kind    text,
  detail  jsonb,
  at      bigint not null
);
create index if not exists mp_cheat_events_uid on mp_cheat_events(uid, at desc);
create index if not exists mp_cheat_events_at on mp_cheat_events(at desc);

create table if not exists mp_devices (
  uid     bigint not null,
  fp      text   not null,
  first   bigint,
  last    bigint,
  ua      text,     -- 原始 UA（截断）
  model   text,     -- 设备型号（UA-CH / UA 解析）
  browser text,     -- 浏览器 + 主版本
  screen  text,     -- 屏幕分辨率 @ 像素比
  ip24    text,     -- 网段（/24），移动网络会变，仅作辅助
  isp     text,     -- 运营商
  city    text,     -- 城市
  primary key (uid, fp)
);
create index if not exists mp_devices_last on mp_devices(last desc);
create index if not exists mp_devices_fp on mp_devices(fp);
