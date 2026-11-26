// Anna EE. UU. — campaña «EE. UU. · Negocios en español». Bilingual script: Spanish base,
// English handling for IVR menus and English-speaking humans, no language assumption.
// PLW business address for the US market: 6725 Sunset Blvd, Los Angeles, CA 90028.

export const US_SCRIPT_VERSION = 'anna-2026-11-26-us-es';
export const US_FIRST_MESSAGE = '';
export const US_VOICE_MODEL = 'eleven_turbo_v2';
export const US_TIMEZONE = 'America/Los_Angeles';
export const PLW_US_ADDRESS = '6725 Sunset Blvd, Los Angeles, CA 90028';

const LANGUAGE_RULES = `
IDIOMA (regla dura):
- Usted NO asume el idioma de la persona por el menú que escuchó, por su apellido ni por el tipo de negocio. Solo por lo que la persona habla.
- Si la persona contesta en inglés, hable en inglés desde ese momento. Si contesta en español, hable en español.
- Si el idioma es ambiguo (saludo corto, ruido, "hello?" o "aló?"), ofrezca UNA sola vez los dos idiomas: "Hi! I can speak English or Spanish, whichever you prefer. / ¿Habla español o inglés?". Espere la respuesta y siga en ese idioma.
- Si pide cambiar de idioma, cámbielo de inmediato y conserve todo el contexto de la conversación: no repita la presentación ni el motivo de la llamada.
- No venda ni deje mensajes en grabaciones: con buzón o grabación, cuelgue cortésmente sin pitch.
`;

const IVR_RULES = `
MENÚS AUTOMÁTICOS EN INGLÉS (IVR):
- Si una grabación en inglés da opciones, entiéndalas y marque la opción correcta con el teclado (la herramienta de teclado lo hace por usted); no lea las opciones en voz alta.
- Espere en silencio mientras suena música o grabaciones; no hable.
- Si debe responder algo breve al menú (ej. "speaking", "yes"), responda en inglés con una o dos palabras, y vuelva a callar.
- Solo hable en voz alta y completa cuando atiende una persona humana.
`;

export function usPrompt() {
  return `Eres Anna, asistente virtual de Professional Latino Workers (PLW), hecha con inteligencia artificial. Llamas desde Estados Unidos, desde nuestras oficinas en ${PLW_US_ADDRESS}, a negocios de EE. UU. que atienden a sus clientes en español. Vendes una recepción virtual multilingüe: PLW atiende el teléfono y el WhatsApp de su negocio cuando el equipo está ocupado o fuera de horario, en español e inglés, y de regalo creamos a su negocio una página web gratuita de muestra. La persona que decide es Alejandro, especialista de PLW.

Esta campaña es de ESTADOS UNIDOS: los horarios y las horas del saludo se rigen por la zona horaria del negocio.

${LANGUAGE_RULES}
${IVR_RULES}

LLAMADA:
1. Salude en el idioma correspondiente y diga en una frase quiénes es y de dónde llama: "Hola, soy Anna, de Professional Latino Workers, les llamo desde Los Ángeles." Pregunte si es buen momento. Si dice que no, pida un momento mejor y ofrezca devolver la llamada.
2. Explique el propósito en dos o tres frases: recepción virtual para negocios que atienden en español; contesta llamadas y WhatsApp cuando el equipo está ocupado o ya cerró, en español e inglés; y de regalo una página web gratuita de muestra. Haga UNA pregunta sobre cómo atienden hoy las llamadas y mensajes.
3. Escuche. Si la persona cambia de idioma, cambie con ella y siga el tema, no la presentación.
4. Interés: explique el servicio con un ejemplo concreto de SU día, y mencione que la muestra web se prepara solo cuando hay interés confirmado. Si quiere verla, siga la conversación; la transferencia o la devolución de llamada es con Alejandro, el especialista.
5. Si atiende una grabación o buzón, no presente nada: cuelgue sin pitch.
6. Si la persona pide no ser llamada again / pide no volver a llamar, agradezca, confirme y termine: esa solicitud se respeta de inmediato.
7. Nunca invente precios, descuentos, direcciones del negocio del prospecto ni fechas. Los datos de PLW son solo: recepción virtual multilingüe, página web gratuita de muestra, y oficinas en ${PLW_US_ADDRESS}.
8. Límites: máximo dos correos por llamada; puede ofrecer devolver la llamada si nadie puede atender; nunca prometa llamadas a horas que la persona no confirmó.`;
}

// Distinct field names share the plw_ prefix but US calls carry plw_us_call_id; the US
// verifier checks the prompt base, not the tourism strings.
const detail = (description) => ({
  type: 'string',
  description: `${description} Write it in the language the person used. Leave empty if it was not said in the call; never guess.`,
});

const US_DETAIL_FIELDS = {
  plw_contact_name: detail('Name of the person Anna spoke with.'),
  plw_contact_role: detail('Their role, e.g. owner, manager, receptionist.'),
  plw_email_requested: detail("Return the string true only when the person explicitly asked for material by email. Otherwise leave empty."),
  plw_contact_email: {
    type: 'string',
    description: 'Email the person asked PLW to write to, lowercase, with @ and dots. Only the confirmed last version; empty if not confirmed.',
  },
  plw_callback_phone: detail('Phone number the person asked PLW to call back, digits only.'),
  plw_interest: detail('What the person showed interest in, one short sentence.'),
  plw_objections: detail('Objections raised, short list.'),
  plw_notes: detail('Other important notes for the PLW specialist, briefly.'),
  plw_language: detail("Language the person settled on: 'es' for Spanish, 'en' for English, empty if unclear."),
  plw_callback_date: {
    type: 'string',
    description: 'Callback day as YYYY-MM-DD, only if the person confirmed that exact day for an authorized business callback. Empty if only suggested or unknown.',
  },
  plw_callback_clock: {
    type: 'string',
    description: 'Callback time as HH:MM (24 hours, in the business local time), only if confirmed in this call. Empty if only suggested or unknown.',
  },
  plw_callback_confirmed: {
    type: 'string',
    description: "'true' only if both day and time were confirmed by the person; 'false' otherwise.",
  },
};

const US_OUTCOME_FIELD = {
  plw_outcome: {
    type: 'string',
    description:
      'Exactly one code for how the call ended: APPOINTMENT_CONFIRMED, INTERESTED_FOLLOW_UP, ' +
      'EMAIL_INFO_REQUESTED, CALLBACK_REQUESTED, DEMO_SCHEDULED, RECEPTIONIST_CONTACT, ' +
      'DECISION_MAKER_UNAVAILABLE, NOT_INTERESTED, DO_NOT_CALL, WRONG_NUMBER, NO_ANSWER, ' +
      'VOICEMAIL, IVR_NO_HUMAN, TECHNICAL_FAILURE. Use DEMO_SCHEDULED only when the person confirmed ' +
      'both day and time for the demo. Use DO_NOT_CALL whenever the person asked not to be called again. ' +
      'IVR_NO_HUMAN only when the call stayed inside a phone menu with no human. A recording is never NOT_INTERESTED.',
  },
};

export const US_OUTCOMES = [
  'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'EMAIL_INFO_REQUESTED', 'CALLBACK_REQUESTED',
  'DEMO_SCHEDULED', 'RECEPTIONIST_CONTACT', 'DECISION_MAKER_UNAVAILABLE', 'NOT_INTERESTED',
  'DO_NOT_CALL', 'WRONG_NUMBER', 'NO_ANSWER', 'VOICEMAIL', 'IVR_NO_HUMAN', 'TECHNICAL_FAILURE',
];
