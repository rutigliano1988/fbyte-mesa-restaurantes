// Crea (o promueve) un superadmin de FByte.
// Uso: ADMIN_PASSWORD='una-clave-larga' pnpm admin:create persona@fbytesolutions.com
import { createClient } from '@supabase/supabase-js';

const email = process.argv[2]?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!email || !password || password.length < 12) {
  console.error("Uso: ADMIN_PASSWORD='mínimo 12 caracteres' pnpm admin:create correo@dominio.com");
  process.exit(1);
}
if (!url || !secret) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local');
  process.exit(1);
}

const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

let userId: string | undefined;
let alreadyExisted = false;
const { data: created, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: 'FByte Solutions' },
});
if (created?.user) {
  userId = created.user.id;
} else if (error && (error.code === 'email_exists' || /already|registered|exists/i.test(error.message))) {
  alreadyExisted = true;
  for (let page = 1; !userId; page++) {
    const { data, error: listError } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) throw listError;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 200) break;
  }
} else if (error) {
  throw error;
}
if (!userId) {
  console.error(`No encontré al usuario ${email}`);
  process.exit(1);
}

const { data: updated, error: updateError } = await supabase
  .from('profiles')
  .update({ is_platform_admin: true })
  .eq('user_id', userId)
  .select('user_id');
if (updateError) throw updateError;
if (updated?.length !== 1) {
  console.error(`No encontré el perfil de ${email}. ¿Están aplicadas las migraciones? No se ha cambiado nada.`);
  process.exit(1);
}
console.log(`✔ ${email} ya es superadmin de FByte`);
if (alreadyExisted) console.log('La contraseña no se ha cambiado (el usuario ya existía).');
