// US campaign ElevenLabs agent config. Copies the verified tourism agent shape (no shared
// imports between edge functions) with the bilingual US prompt, US timezone and a distinct
// transfer SIP header, so tourism/dental alerts and stats never fire for US calls.
import {
  US_FIRST_MESSAGE,
  US_VOICE_MODEL,
  US_LLM,
  US_VOICE_ES,
  US_VOICE_EN,
  US_SCRIPT_VERSION,
  usPrompt,
} from './usScript.js';

const ELEVENLABS_ROOT = 'https://api.elevenlabs.io/v1/convai';

export async function providerRequest(
  apiKey,
  path,
  body,
  fetchImpl = fetch,
  method = body ? 'POST' : 'GET',
  timeoutMs = 18000
) {
  const response = await fetchImpl(ELEVENLABS_ROOT + path, {
    method,
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => null),
  };
}

export function sanitizeProviderError(data) {
  const detail = data?.detail;
  if (typeof detail === 'string') return [{ field: '', type: '', message: detail.slice(0, 160) }];
  if (detail && typeof detail === 'object' && !Array.isArray(detail))
    return [
      {
        field: '',
        type: String(detail.status ?? '').slice(0, 80),
        message: String(detail.message ?? JSON.stringify(detail)).slice(0, 300),
      },
    ];
  if (!detail && typeof data?.message === 'string')
    return [{ field: '', type: '', message: data.message.slice(0, 300) }];
  if (!Array.isArray(detail)) return [];
  return detail.slice(0, 8).map((item) => ({
    field: (Array.isArray(item?.loc) ? item.loc : [])
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .slice(0, 6)
      .map(String)
      .join('.')
      .slice(0, 160),
    type: String(item?.type ?? '').slice(0, 80),
    message: String(item?.msg ?? '').slice(0, 160),
  }));
}

// Full NANP normalization for the US campaign: optional 1 country code, exactly 10 valid
// digits, area and exchange not starting with 0/1. Returns E.164 or null.
export function normalizeUsPhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
}

// The ElevenLabs id of an imported number. ElevenLabs keeps the number as typed at import
// ("+1 213 555 0100", "12135550100"...), so both sides are normalized before comparing.
export function findPhoneNumberId(list, e164) {
  const wanted = normalizeUsPhone(e164);
  const match = wanted && (Array.isArray(list) ? list : []).find((n) => normalizeUsPhone(n?.phone_number) === wanted);
  return typeof match?.phone_number_id === 'string' ? match.phone_number_id : null;
}

// True when the raw digits already carry the US country code exactly once (11 digits).
export function looksLikeUsWithCountryCode(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') && /^[2-9]/.test(digits.slice(1));
}

export function isSip403Error(message) {
  return typeof message === 'string' && /SIP 403|403 Forbidden/i.test(message);
}

export function providerReason(result, timeoutSeconds) {
  if (!result?.status) return ` (sin respuesta del proveedor en ${timeoutSeconds} s)`;
  const message =
    typeof result.data?.message === 'string'
      ? result.data.message
      : sanitizeProviderError(result.data)
          .map((item) => [item.field, item.message].filter(Boolean).join(': '))
          .join('; ');
  const text = message.replace(/\s+/g, ' ').trim().slice(0, 200);
  return ` (HTTP ${result.status}${text ? `: ${text}` : ''})`;
}


const LANGUAGE_TOOL = {
  type: 'system',
  name: 'language_detection',
  description:
    'Cambia el idioma solo cuando la persona hable otro idioma o pida cambiar, y vuelve al español cuando hable español. Nunca cambies por el menú automático ni por una sola palabra.',
  params: { system_tool_type: 'language_detection' },
};

const SKIP_TURN_TOOL = {
  type: 'system',
  name: 'skip_turn',
  description:
    'Quédate en silencio sin decir nada: esperas, música de espera, grabaciones o menús automáticos, y mientras te dictan un correo o un número que aún no termina.',
  params: { system_tool_type: 'skip_turn' },
};
const KEYPAD_TOOL = {
  type: 'system',
  name: 'play_keypad_touch_tone',
  description:
    'Marca una opción de un menú automático en inglés o español: ventas, reservaciones, operadora o recepción, según lo que pida el menú.',
  params: { system_tool_type: 'play_keypad_touch_tone' },
};
const BUILT_IN_TOOLS = ['end_call', 'transfer_to_number', 'voicemail_detection', 'language_detection', 'skip_turn', 'play_keypad_touch_tone'];

const BASIC_TURN = { turn_eagerness: 'patient' };
const IGNORED_REPLIES = [
  'sí', 'si', 'ajá', 'aja', 'mhm', 'ujum', 'ok', 'okey', 'ya', 'bueno', 'claro', 'listo',
  'perfecto', 'gracias', 'muchas gracias', 'yes', 'yeah', 'sure', 'uh-huh',
];
const TURN = { ...BASIC_TURN, turn_timeout: 10, interruption_ignore_terms: IGNORED_REPLIES };

const isTrue = (value) => value === true || String(value).trim().toLowerCase() === 'true';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const detail = (description) => ({
  type: 'string',
  description: `${description} Write it in the language the person used. Leave empty if it was not said in the call; never guess.`,
});
const DETAIL_FIELDS = {
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
  plw_language: detail("Language the conversation settled on: 'es' for Spanish, 'en' for English, empty if unclear."),
  plw_callback_date: {
    type: 'string',
    description: 'Callback day as YYYY-MM-DD, only if the person confirmed that exact day for an authorized business callback. Anna repeats the weekday, day and month when confirming: use that day and month. Empty if only suggested or unknown.',
  },
  plw_callback_clock: {
    type: 'string',
    description: 'Callback time as HH:MM (24 hours, business local time), only if confirmed in this call. Empty if only suggested or unknown.',
  },
  plw_callback_confirmed: {
    type: 'string',
    description: "'true' only if both day and time were confirmed by the person; 'false' otherwise.",
  },
};
const OUTCOME_FIELD = {
  plw_outcome: {
    type: 'string',
    description:
      'Exactly one code for how the call ended: TRANSFERRED_TO_SPECIALIST, APPOINTMENT_CONFIRMED, ' +
      'INTERESTED_FOLLOW_UP, EMAIL_INFO_REQUESTED, CALLBACK_REQUESTED, DEMO_SCHEDULED, RECEPTIONIST_CONTACT, ' +
      'DECISION_MAKER_UNAVAILABLE, NOT_INTERESTED, DO_NOT_CALL, WRONG_NUMBER, NO_ANSWER, ' +
      'VOICEMAIL, IVR_NO_HUMAN, TECHNICAL_FAILURE. Use TRANSFERRED_TO_SPECIALIST when the call was ' +
      'transferred to Alejandro. Use CALLBACK_REQUESTED when a call with Alejandro was agreed for a later ' +
      'day or time. Use DEMO_SCHEDULED only when the person confirmed ' +
      'both day and time for the demo. Use DO_NOT_CALL whenever the person asked not to be called again. ' +
      'IVR_NO_HUMAN only when the call stayed inside a phone menu with no human. A recording is never NOT_INTERESTED.',
  },
};

export const US_OUTCOMES = [
  'TRANSFERRED_TO_SPECIALIST', 'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'EMAIL_INFO_REQUESTED', 'CALLBACK_REQUESTED',
  'DEMO_SCHEDULED', 'RECEPTIONIST_CONTACT', 'DECISION_MAKER_UNAVAILABLE', 'NOT_INTERESTED',
  'DO_NOT_CALL', 'WRONG_NUMBER', 'NO_ANSWER', 'VOICEMAIL', 'IVR_NO_HUMAN', 'TECHNICAL_FAILURE',
];

export function usAgentConfig(staffName, route, { basicTurn = false } = {}) {
  return {
    name: `PLW EE. UU. · Anna · ${staffName} · ${US_SCRIPT_VERSION}`,
    tags: ['plw-us'],
    conversation_config: {
      agent: {
        language: 'es',
        first_message: US_FIRST_MESSAGE,
        prompt: {
          prompt: usPrompt() + `\nVersión: ${US_SCRIPT_VERSION}.`,
          llm: US_LLM,
          tool_ids: [],
          mcp_server_ids: [],
          knowledge_base: [],
          timezone: 'America/Los_Angeles',
          built_in_tools: {
            end_call: { type: 'system', name: 'end_call', params: { system_tool_type: 'end_call' } },
            voicemail_detection: {
              type: 'system',
              name: 'voicemail_detection',
              params: { system_tool_type: 'voicemail_detection' },
            },
            language_detection: LANGUAGE_TOOL,
            skip_turn: SKIP_TURN_TOOL,
            play_keypad_touch_tone: KEYPAD_TOOL,
            transfer_to_number: {
              type: 'system',
              name: 'transfer_to_number',
              params: {
                system_tool_type: 'transfer_to_number',
                transfers: [
                  // The team line (+1 754-799-1065): Telnyx sends it to the phone server, which
                  // rings Alejandro and, if he can't answer, PLW USA — Recepción takes a callback.
                  // Anna's calls go straight from ElevenLabs to Telnyx, so a SIP address on our
                  // server can't be reached by a transfer; a phone number can.
                  {
                    transfer_destination: { type: 'phone', phone_number: route.transfer_uri },
                    transfer_type: 'sip_refer',
                    condition: `La persona acepta hablar ahora mismo con ${staffName}.`,
                  },
                ],
              },
            },
          },
        },
      },
      // Spanish by default (Melissa); English is the only other language, spoken by Siren.
      language_presets: {
        en: { overrides: { agent: {}, tts: { voice_id: US_VOICE_EN } } },
      },
      tts: { voice_id: US_VOICE_ES, model_id: US_VOICE_MODEL, expressive_mode: false },
      vad: { background_voice_detection: true },
      turn: basicTurn ? BASIC_TURN : TURN,
      conversation: { max_duration_seconds: 600 },
    },
    platform_settings: {
      data_collection: {
        ...OUTCOME_FIELD,
        ...DETAIL_FIELDS,
        plw_opt_out: {
          type: 'boolean',
          description:
            'True only if the person requests no more calls or removal from the calling list, in any language.',
        },
      },
      overrides: { conversation_config_override: { asr: { keywords: true } } },
    },
  };
}

// ASR boost: business name words plus common US English/Spanish email dictation terms.
const ASR_EMAIL_WORDS = [
  'arroba', 'at', 'punto com', 'dot com', 'gmail', 'hotmail', 'outlook', 'yahoo',
  'info', 'sales', 'office', 'reservas', 'ventas', 'gerencia', 'management',
];
export function usAsrKeywords(businessName) {
  const name = String(businessName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4);
  return [...new Set([name, ...words, ...ASR_EMAIL_WORDS].filter(Boolean))].slice(0, 50);
}

// The business's own date and time for Anna's prompt: its US zone, never UTC or the office clock.
export function businessNow(timezone, at = new Date()) {
  const format = (tz, options) => new Intl.DateTimeFormat('es-US', { timeZone: tz, ...options });
  let tz = timezone || 'America/Los_Angeles';
  try {
    format(tz, {});
  } catch {
    tz = 'America/Los_Angeles';
  }
  const zone = format(tz, { timeZoneName: 'long' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
  return `${format(tz, { dateStyle: 'full', timeStyle: 'short' }).format(at)} (${zone})`;
}

export function usCallResults(analysis, callDay) {
  const values = new Map();
  const map = analysis?.data_collection_results;
  const entries = [
    ...(map && typeof map === 'object' && !Array.isArray(map) ? Object.entries(map) : []),
    ...[map, analysis?.data_collection_results_list].flatMap((list) =>
      Array.isArray(list) ? list.map((entry) => [entry?.data_collection_id, entry]) : []
    ),
  ];
  for (const [id, entry] of entries)
    if (typeof id === 'string' && entry && typeof entry === 'object' && !values.has(id))
      values.set(id, entry.value ?? null);
  const outcomeText = String(values.get('plw_outcome') ?? '').trim().toUpperCase();
  const outcome = US_OUTCOMES.includes(outcomeText) ? outcomeText : null;
  const details = {};
  for (const id of Object.keys(DETAIL_FIELDS)) {
    const value = values.get(id);
    const clean = typeof value === 'string' || typeof value === 'number'
      ? String(value).replace(/\s+/g, ' ').trim().slice(0, 300)
      : '';
    if (clean && !/^(null|none|n\/a)$/i.test(clean)) details[id.slice(4)] = clean;
  }
  if (details.contact_email && !EMAIL_PATTERN.test(details.contact_email)) delete details.contact_email;
  // The extraction doesn't know the call's date and may guess the year: keep the month and day,
  // and take the first such date on or after the day of the call (YYYY-MM-DD).
  const monthDay = /^\d{4}-(\d{2}-\d{2})$/.exec(details.callback_date ?? '')?.[1];
  if (monthDay && /^\d{4}-\d{2}-\d{2}$/.test(callDay ?? ''))
    details.callback_date = `${Number(callDay.slice(0, 4)) + (monthDay < callDay.slice(5) ? 1 : 0)}-${monthDay}`;
  const optOut = isTrue(values.get('plw_opt_out')) || outcome === 'DO_NOT_CALL';
  // us_call_to_customer and us_prepare_sample only act on calls that reached a person.
  const endedReason = outcome ? (ENDED_REASONS[outcome] ?? 'human') : null;
  return { outcome, details, optOut, endedReason };
}

const ENDED_REASONS = {
  VOICEMAIL: 'voicemail',
  IVR_NO_HUMAN: 'ivr',
  NO_ANSWER: 'technical',
  TECHNICAL_FAILURE: 'technical',
};

const text = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim();

export function usConfigFailures(config, route) {
  if (!config || typeof config !== 'object') return ['provider_read'];
  if (config.agent_id !== route.provider_agent_id) return ['agent_identity'];
  const failures = [];
  const agent = config.conversation_config?.agent;
  const p = agent?.prompt;
  if (agent?.first_message !== US_FIRST_MESSAGE) failures.push('first_message');
  if (agent?.language !== 'es') failures.push('language');
  if (p?.timezone !== 'America/Los_Angeles') failures.push('timezone');
  if (config.conversation_config?.tts?.model_id !== US_VOICE_MODEL) failures.push('voice_model');
  if (config.conversation_config?.tts?.voice_id !== US_VOICE_ES) failures.push('voice_spanish');
  if (p?.llm !== US_LLM) failures.push('llm');
  if (config.conversation_config?.tts?.expressive_mode !== false) failures.push('expressive_mode');
  if (
    config.conversation_config?.vad?.background_voice_detection !== true ||
    config.conversation_config?.turn?.turn_eagerness !== 'patient'
  )
    failures.push('noise_settings');
  if (!text(p?.prompt).startsWith(text(usPrompt()))) failures.push('prompt_base');
  if (!text(p?.prompt).includes(US_SCRIPT_VERSION)) failures.push('script_version');
  const collected = config.platform_settings?.data_collection ?? {};
  if (!Object.keys(DETAIL_FIELDS).every((field) => field in collected)) failures.push('extraction_fields');
  if (p?.tool_ids?.length || p?.mcp_server_ids?.length || p?.knowledge_base?.length) failures.push('extra_tools_or_knowledge');
  if (!text(p?.prompt).includes('ESTADOS UNIDOS')) failures.push('prompt_us');
  const built = p?.built_in_tools ?? {};
  if (Object.entries(built).some(([name, value]) => value && !BUILT_IN_TOOLS.includes(name)))
    failures.push('extra_builtin_tool');
  if (!built.voicemail_detection) failures.push('voicemail_detection');
  if (!built.language_detection) failures.push('language_detection');
  if (!built.skip_turn) failures.push('skip_turn');
  if (!built.play_keypad_touch_tone) failures.push('keypad');
  const presets = config.conversation_config?.language_presets ?? {};
  if (
    Object.keys(presets).join() !== 'en' ||
    presets.en?.overrides?.tts?.voice_id !== US_VOICE_EN ||
    Object.values(presets).some((preset) => text(preset?.overrides?.agent?.first_message) !== '')
  )
    failures.push('language_presets');
  const t = built.transfer_to_number?.params?.transfers;
  if (!Array.isArray(t) || t.length !== 1) failures.push('transfer_count');
  else {
    if (t[0].transfer_type !== 'sip_refer') failures.push('transfer_type');
    if (t[0].transfer_destination?.phone_number !== route.transfer_uri) failures.push('transfer_destination');
  }
  return failures;
}
