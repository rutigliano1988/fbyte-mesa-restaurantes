-- Mesa · Hito 3 · fotos de platos: la carpeta {restaurante}/dishes/ la gestionan Administrador y Encargado.
-- El resto del bucket (logo, portada y galería) sigue siendo solo del Administrador, como en 20261125000100_local.sql.
-- Las políticas restaurant_media_* ya llaman a esta función: basta con sustituirla.
create or replace function public.can_manage_media(p_bucket_id text, p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_folder constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';
begin
  if p_bucket_id is distinct from 'restaurant-media' or p_name is null then
    return false;
  end if;
  if p_name ~ (v_folder || 'dishes/[a-z0-9-]+\.(webp|jpg)$') then
    return public.has_role(((storage.foldername(p_name))[1])::uuid, '{admin,manager}');
  end if;
  if p_name ~ (v_folder || '(logo-[a-z0-9-]+|cover-[a-z0-9-]+|gallery/[a-z0-9-]+)\.(webp|jpg)$') then
    return public.has_role(((storage.foldername(p_name))[1])::uuid, '{admin}');
  end if;
  return false;
end $$;

-- create or replace conserva los permisos; se repiten para que la migración se entienda sola.
revoke execute on function public.can_manage_media(text, text) from public, anon;
grant execute on function public.can_manage_media(text, text) to authenticated;
