# PLW · Alejandro · Primeros 20 intentos

Preparado sobre `e6042b3bdb2fd0ee5afb593bd686f22b3aab8fef` (Fix dental dialer deploy bundling).
Backend exclusivo: `meagbbmittuhdgwnhvxa`. Fecha: 10 de noviembre de 2026.

## Resultado de esta actualización

- Alejandro (`agent-2`): máximo 20 intentos nuevos, dos simultáneos, pausa automática al alcanzar el límite. Las llamadas ya iniciadas pueden terminar.
- Valeska (`agent-3`): el mismo piloto de 20 intentos, dos simultáneos por agente, cuatro en total, pausa automática y sin remarcado automático. Su transferencia sigue NO comprobada hasta que ella confirme una llamada real.
- Reservas, rechazos del proveedor y resultados inciertos consumen el límite. Una prueba al teléfono del administrador no lo consume. No se repiten automáticamente contactos intentados.
- Un piloto limitado puede empezar sin una transferencia previa confirmada. Esa transferencia sigue claramente marcada como NO comprobada hasta que el agente receptor la confirme con su propia sesión.
- Sigue siendo obligatorio verificar la configuración real de Ana y recibir una señal reciente del servidor. No se inventan marcas de verificación.
- La pantalla muestra el avance del piloto y los mensajes reales de error. Al alcanzar el límite, deshabilita continuar. El servidor también impide un intento adicional.
- La migración prepara únicamente a Alejandro, detenido. No activa llamadas ni modifica la configuración de Valeska, el marcador general, WhatsApp, Gmail ni el agente compartido de llamadas entrantes.

## Instalar y publicar en Bolt

1. Guardar el archivo adjunto como `PLW-Alejandro-20-Calls.cjs` en la raíz del proyecto y ejecutar `node PLW-Alejandro-20-Calls.cjs`. El instalador contiene los ocho archivos; no descarga código ni necesita otro paquete. Verifica todos los archivos antes de escribir, conserva cambios más recientes y respalda los archivos reemplazados. Si encuentra un conflicto, comparar y fusionar ese archivo antes de continuar; no desactivar la comprobación.
2. Confirmar que el backend conectado es exactamente `meagbbmittuhdgwnhvxa` y que están aplicadas las migraciones dentales `20261110090000` y `20261110091000`. La primera carga de dentistas es `20261110080000`.
3. Revisar y aplicar **una sola vez, en una transacción**, `supabase/migrations/20261110151741_dental_alejandro_twenty_call_pilot.sql` con la herramienta de migraciones del proyecto, conservando su historial. No volver a aplicarla para reiniciar el contador ni cambiar verificaciones manualmente.
4. Ejecutar `npm test`, `npm run typecheck`, `npm run lint` y `npm run build`. Publicar el frontend después de la migración. Este paquete no cambia la función dental ya desplegada; no requiere desplegar otra función si la versión de `e6042b3` está activa.
5. Mantener Valeska detenida durante este piloto. Verificar el estado real antes de iniciar; este instalador no detiene por sí mismo un marcador que alguien haya activado después del último reporte.

## Activar en la aplicación

1. Alejandro inicia sesión, selecciona **Activo** y comprueba **Línea registrada** en su teléfono. Debe mantener el teléfono conectado y poder recibir transferencias. No suplantar su sesión ni marcar su disponibilidad directamente en la base de datos.
2. El administrador abre **Marcador dental**, selecciona **Alejandro** y pulsa **Configurar Ana** una vez. Esta acción usa el secreto existente de ElevenLabs, verifica el agente dental separado de Alejandro con el guion actualizado y habilita el servidor automático. Si el agente existente tiene diferencias, el servidor lo actualiza una sola vez; nunca crea un segundo agente ni toca el agente de llamadas entrantes.
3. Si la verificación falla, la pantalla muestra solo los nombres técnicos de las comprobaciones que no pasaron (por ejemplo `workflow` o `extra_tools_or_knowledge`). Corregir esa causa y volver a pulsar **Configurar Ana**. No guardar `config_verified_at`, `transfer_verified_at` o un heartbeat inventado para forzar el botón. Si la creación del proveedor quedó incierta, comprobar ElevenLabs antes de intentar crear otro agente.
4. Esperar una **Última señal del servidor** reciente. Pulsar **Activar piloto de 20**. Se marcan hasta dos contactos simultáneos solo cuando Alejandro está disponible, de lunes a viernes de 9:00 a 17:00, hora de Costa Rica. No es necesario llenar el teléfono de prueba para este piloto limitado; la prueba controlada sigue siendo opcional.
5. Cuando una persona interesada acepte la transferencia y Alejandro realmente la reciba, él pulsa **Recibí esta transferencia** en su historial. Una transferencia solicitada, una frase de Ana o la alerta de llamada entrante no cuentan como recepción confirmada.
6. El piloto se pausa al alcanzar 20 intentos. Permitir que finalicen las llamadas iniciadas y que se sincronicen sus conversaciones antes de revisar resultados. No eliminar el límite ni preparar otra tanda antes de analizar esta.

## Alerta de llamada entrante

Cuando entra una llamada dental al agente activo, aparece una alerta grande con el nombre del dentista, su teléfono, el agente asignado, la ubicación y el resumen de Ana si ya existe. Los botones Contestar y Rechazar usan el teléfono existente. La alerta solo aparece si la llamada trae el identificador `X-PLW-Dental-Call` válido; si falta, está mal formado, pertenece a otro agente o la búsqueda falla, se muestra un estado honesto y nunca se adivina el dentista. Que el sistema telefónico reenvíe ese encabezado al navegador todavía no está comprobado de extremo a extremo.

## Ana Chacón Méndez

El código de la función dental de `e6042b3` contiene `ana-2026-11-10-dental`: Ana Chacón Méndez, presentación como Ana Chacón, pregunta sobre llamadas mientras el doctor atiende o fuera de horario, recepción 24/7, ejemplo en inglés y francés, formularios antes de las citas, creación de sitio web incluida, oficina en Pinares de Curridabat, San José, y trece años de experiencia en Estados Unidos.

`Configurar Ana` debe verificar ese guion, el modelo de voz `eleven_v3_conversational` y el destino fijo de Alejandro en el proveedor real. La presencia del guion en el código no demuestra que ya esté activo en ElevenLabs. La voz debe escucharse en llamadas reales para evaluar naturalidad y pronunciación. El guion responde con claridad que es una asistente virtual si le preguntan; no promete exclusividad nacional, capacidades ilimitadas ni funciones que no estén configuradas.

## Verificación y análisis de las primeras 20

Estado: código preparado; este paquete por sí mismo NO implica publicación, configuración del proveedor, activación ni llamadas realizadas.

Comprobaciones locales de la última sesión: 96 pruebas aprobadas (Vitest y node:test), typecheck, lint y build aprobados. Vite mantiene un aviso de tamaño del bundle principal; no impide el build. No se volvió a ejecutar `deno check` en esta sesión. No se ha comprobado desde esta sesión la entrega de audio, la transferencia por SIP ni la disponibilidad del proveedor en producción.

Después de la tanda, revisar en el historial de Alejandro las 20 filas nuevas, su estado final, errores, conversaciones y transcripciones. Separar intentos, conversaciones con respuesta, interesados, transferencias solicitadas y transferencias confirmadas por Alejandro. Revisar: saludo y pronunciación; pregunta y pausa para escuchar; explicación comercial proactiva; respuesta a objeciones; consentimiento antes de transferir; ausencia de datos de otra campaña; opt-out respetado; correspondencia exacta llamada/agente/transcripción. Una transcripción vacía no demuestra que haya sido buzón; registrar la limitación.

Si hay rechazo repetido, resultado incierto sin resolver, audio incorrecto o una transferencia fallida, pausar antes de consumir el resto. No reintentar automáticamente una llamada cuyo resultado sea incierto. Documentar el error real, los identificadores internos de las llamadas y el estado confirmado por el proveedor.

Consulta de control de solo lectura (sin secretos):

```sql
SELECT d.staff_id, d.state, d.pilot_call_limit, d.pilot_baseline_count,
       count(c.id) FILTER (WHERE NOT c.is_test) AS total_intentos,
       greatest(0, count(c.id) FILTER (WHERE NOT c.is_test) - d.pilot_baseline_count) AS intentos_piloto,
       d.provider_agent_id IS NOT NULL AS tiene_agente_ana,
       d.config_verified_at, d.transfer_verified_at, d.last_error
FROM public.dental_agent_dialers d
LEFT JOIN public.dental_calls c ON c.staff_id = d.staff_id
WHERE d.staff_id IN ('agent-2', 'agent-3')
GROUP BY d.staff_id;
SELECT scheduler_ready, last_tick_at, last_error FROM public.dental_dialer_runtime WHERE id = 1;
```

La agrupación incluye el historial completo; el contador del piloto descuenta la línea de base guardada al aplicar la migración. No hay que consultar ni mostrar secretos de telefonía.

## Detener o revertir

Usar **Congelar / Pausar** o **Detener** para impedir nuevas reservas; las llamadas iniciadas pueden finalizar. Si hace falta revertir la interfaz, conservar la migración y su línea de base, detener primero a Alejandro y restaurar los archivos desde el respaldo del instalador. No borrar llamadas, transcripciones o la línea de base. No retirar el límite mientras el marcador esté activo.
