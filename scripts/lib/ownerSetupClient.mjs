import { createClient } from '@supabase/supabase-js';

export const ENROLLMENT_MINUTES = 15;
export const DEVICE_LABEL = 'Equipo del administrador';

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Configúrala solo en esta terminal.`);
  }
  return value;
}

export function createOwnerSetupClient() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function printEnrollmentCode(display, expiresAt) {
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    throw new Error('El servidor no devolvió una vigencia válida. No use este código.');
  }
  console.log(`Código de registro del equipo: ${display}`);
  console.log(
    `Vence a las ${expiry.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} ` +
      `(${ENROLLMENT_MINUTES} minutos desde su emisión). Solo puede usarse una vez.`
  );
  console.log('Guárdelo ahora. No se volverá a mostrar.');
}
