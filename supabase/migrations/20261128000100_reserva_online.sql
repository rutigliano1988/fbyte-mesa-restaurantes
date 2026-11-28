-- Mesa · Hito 4B · reserva online: ajustes nuevos, aviso al cliente, cola de emails, límite de intentos y las reglas
-- que deciden qué emails salen con cada alta o cambio de una reserva (trigger).

-- Ajustes: reserva online, avisos al restaurante y su email (vacío = el del local) --------------------------------
alter table public.booking_settings
  add column online_enabled boolean not null default true,
  add column notify_restaurant boolean not null default true,
  add column notification_email text
    constraint booking_settings_notification_email_check
    check (notification_email = lower(notification_email) and length(notification_email) <= 254
           and notification_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
grant update (online_enabled, notify_restaurant, notification_email) on public.booking_settings to authenticated;

-- Reservas: si el cliente recibe emails (online siempre; teléfono según la casilla; walk-in nunca) --------------------
alter table public.reservations
  add column notify_customer boolean not null default false,
  add constraint reservations_manage_token_hash_check check (manage_token_hash ~ '^[0-9a-f]{64}$'),
  add constraint reservations_notify_check check (not notify_customer or manage_token_hash is not null);

-- Cola de emails ------------------------------------------------------------------------------------------------
create type public.email_kind as enum (
  'customer_pending', 'customer_confirmed', 'customer_modified', 'customer_cancelled', 'customer_rejected',
  'customer_reminder', 'restaurant_new', 'restaurant_request', 'restaurant_modified', 'restaurant_cancelled'
);
create type public.email_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped');

-- El destinatario no se guarda: se resuelve al enviar (email actual del cliente o email de avisos).
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  reservation_id uuid not null,
  kind public.email_kind not null,
  status public.email_status not null default 'pending',
  attempts smallint not null default 0 constraint email_outbox_attempts_check check (attempts between 0 and 3),
  -- Código corto del fallo, sin datos personales.
  last_error text constraint email_outbox_last_error_check check (length(last_error) <= 200),
  provider_id text constraint email_outbox_provider_id_check check (length(provider_id) <= 200),
  -- Cuándo se puede intentar (o, si está «sending», cuándo se da por perdido y se reintenta).
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (reservation_id, restaurant_id) references public.reservations (id, restaurant_id) on delete cascade
);
create index email_outbox_reservation_idx on public.email_outbox (reservation_id, created_at);
create index email_outbox_restaurant_idx on public.email_outbox (restaurant_id);
create index email_outbox_queue_idx on public.email_outbox (next_attempt_at) where status in ('pending', 'sending');
-- Un único recordatorio por reserva.
create unique index email_outbox_reminder_key on public.email_outbox (reservation_id) where kind = 'customer_reminder';

-- Límite de intentos (compartido entre instancias). La clave lleva la acción, el restaurante y la huella de la IP.
create table public.rate_limits (
  key text not null constraint rate_limits_key_check check (length(key) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);

-- RLS: la cola la leen los miembros con reservations.manage (los tres roles) y FByte en soporte; nadie escribe
-- directamente (solo las funciones). rate_limits: nadie.
alter table public.email_outbox enable row level security;
alter table public.rate_limits enable row level security;
revoke all on public.email_outbox, public.rate_limits from anon, authenticated, service_role;
grant select on public.email_outbox to authenticated;
create policy email_outbox_select on public.email_outbox for select to authenticated
  using (public.has_role(restaurant_id, '{admin,manager,staff}') or public.is_platform_admin());

-- Reglas de encolado (igual que src/lib/email/outbox-rules.ts) ---------------------------------------------------
/**
 * Qué emails tocan con un alta (p_op = 'INSERT') o un cambio de una reserva. p_moved: cambian la hora o las personas.
 * p_actor: 'customer' (funciones públicas), 'staff' (panel) o 'system' (tarea horaria). Los de restaurante, solo si
 * el cambio lo hizo el comensal. Los walk-ins nunca. Quién recibe cada uno lo decide el trigger.
 */
create or replace function public.reservation_email_kinds(
  p_op text, p_old_status public.reservation_status, p_new_status public.reservation_status, p_moved boolean,
  p_source public.reservation_source, p_actor text, p_notify_switched_on boolean
) returns public.email_kind[] language plpgsql immutable set search_path = '' as $$
declare
  v_customer boolean := p_actor = 'customer';
begin
  if p_source = 'walk_in' then
    return '{}';
  end if;
  if p_op = 'INSERT' then
    if p_new_status = 'pending' then
      return case when v_customer then '{customer_pending,restaurant_request}' else '{customer_pending}' end::public.email_kind[];
    elsif p_new_status = 'confirmed' then
      return case when v_customer and p_source = 'online' then '{customer_confirmed,restaurant_new}' else '{customer_confirmed}' end::public.email_kind[];
    end if;
    return '{}';
  end if;
  if coalesce(p_moved, false) and p_old_status in ('pending', 'confirmed') and p_new_status in ('pending', 'confirmed') then
    return case when v_customer then '{customer_modified,restaurant_modified}' else '{customer_modified}' end::public.email_kind[];
  end if;
  if p_old_status is distinct from p_new_status then
    if p_new_status = 'confirmed' and p_old_status in ('pending', 'cancelled_customer', 'cancelled_restaurant', 'rejected') then
      return '{customer_confirmed}';
    elsif p_new_status = 'rejected' then
      return '{customer_rejected}';
    elsif p_new_status = 'cancelled_restaurant' then
      return '{customer_cancelled}';
    elsif p_new_status = 'cancelled_customer' then
      return case when v_customer then '{customer_cancelled,restaurant_cancelled}' else '{customer_cancelled}' end::public.email_kind[];
    end if;
    return '{}';
  end if;
  if coalesce(p_notify_switched_on, false) then
    if p_new_status = 'pending' then
      return '{customer_pending}';
    elsif p_new_status = 'confirmed' then
      return '{customer_confirmed}';
    end if;
  end if;
  return '{}';
end $$;

/**
 * Anota los emails en la misma transacción que cambia la reserva. Los del comensal, solo si notify_customer y el
 * cliente tiene email; los del restaurante, si están activados y hay email de avisos (o el del local).
 */
create or replace function public.enqueue_reservation_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- Sin marcar (p. ej., el panel del 4A o pruebas como superusuario), cuenta como el equipo.
  v_actor text := coalesce(nullif(current_setting('mesa.actor', true), ''), 'staff');
  v_kinds public.email_kind[];
  v_customer_email text;
  v_notify_restaurant boolean;
  v_restaurant_email text;
begin
  if tg_op = 'INSERT' then
    v_kinds := public.reservation_email_kinds('INSERT', null, new.status, false, new.source, v_actor, false);
  else
    v_kinds := public.reservation_email_kinds(
      'UPDATE', old.status, new.status,
      new.starts_at is distinct from old.starts_at or new.party_size is distinct from old.party_size,
      new.source, v_actor, new.notify_customer and not old.notify_customer);
  end if;
  if cardinality(v_kinds) = 0 then
    return null;
  end if;
  select c.email into v_customer_email
    from public.customers c where c.id = new.customer_id and c.restaurant_id = new.restaurant_id;
  select coalesce(s.notify_restaurant, true), coalesce(s.notification_email, r.contact_email)
    into v_notify_restaurant, v_restaurant_email
    from public.restaurants r left join public.booking_settings s on s.restaurant_id = r.id
   where r.id = new.restaurant_id;
  insert into public.email_outbox (restaurant_id, reservation_id, kind)
  select new.restaurant_id, new.id, k
    from unnest(v_kinds) k
   where case when k::text like 'customer\_%' then new.notify_customer and v_customer_email is not null
              else v_notify_restaurant and v_restaurant_email is not null end;
  return null;
end $$;
create trigger reservations_enqueue_emails after insert or update of status, starts_at, party_size, notify_customer
  on public.reservations for each row execute function public.enqueue_reservation_emails();

revoke execute on function
  public.reservation_email_kinds(text, public.reservation_status, public.reservation_status, boolean,
    public.reservation_source, text, boolean),
  public.enqueue_reservation_emails()
  from public, anon, authenticated, service_role;
