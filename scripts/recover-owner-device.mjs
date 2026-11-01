#!/usr/bin/env node
import { generateEnrollmentCode } from './lib/enrollmentCode.mjs';
import {
  DEVICE_LABEL,
  createOwnerSetupClient,
  printEnrollmentCode,
} from './lib/ownerSetupClient.mjs';

async function main() {
  const client = createOwnerSetupClient();
  const enrollment = generateEnrollmentCode();

  const { data, error } = await client.rpc('owner_recover_device', {
    p_code_hash: enrollment.hash,
    p_label: DEVICE_LABEL,
  });

  if (error) {
    throw new Error(`No se pudo emitir un código nuevo: ${error.message}`);
  }
  if (data?.status === 'not_configured') {
    throw new Error('Primero complete la configuración inicial desde la pantalla de configuración.');
  }
  if (data?.status !== 'ok') {
    throw new Error('Respuesta inesperada del servidor. No se confirmó el código nuevo.');
  }

  console.log('Se emitió un código nuevo. Los códigos anteriores sin usar quedaron anulados.');
  printEnrollmentCode(enrollment.display, data.expires_at);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error desconocido.');
  process.exitCode = 1;
});
