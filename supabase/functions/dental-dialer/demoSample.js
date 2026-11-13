export const DEMO_SAMPLE_FILENAME = 'demostracion-simulada-dos-voces.mp3';
export const DEMO_SAMPLE_LABEL = 'Demostración simulada de dos voces — no es una llamada real';
export const DEMO_SAMPLE_MODEL = 'eleven_v3';
export const DEMO_SAMPLE_OUTPUT_FORMAT = 'mp3_44100_128';

export const DEMO_SAMPLE_LINES = [
  { speaker: 'ana', text: 'Imagínese que la clínica ya cerró y entra esta llamada.' },
  {
    speaker: 'patient',
    text: 'Hi, I have a toothache. Could I request an appointment for tomorrow? I don’t speak Spanish.',
  },
  {
    speaker: 'ana',
    text: 'Of course. I can take your details and your preferred time, then ask the clinic to confirm your appointment.',
  },
  {
    speaker: 'ana',
    text: 'Y usted recibe la solicitud organizada en español: paciente de habla inglesa, dolor de muela y solicitud de cita para mañana, pendiente de confirmar. Yo soy el ejemplo: soy una asistente de inteligencia artificial. ¿Le serviría llegar por la mañana y encontrar estas solicitudes organizadas?',
  },
];

const ELEVENLABS_API = 'https://api.elevenlabs.io';
const MAX_VOICE_PAGES = 5;
const VOICE_PAGE_SIZE = 100;
const CHILD_AGES = ['child', 'young child', 'teen'];
const DIAGNOSTIC_SAMPLE_SIZE = 8;

export class DemoSampleError extends Error {
  constructor(status, message, diagnostics = null) {
    super(message);
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

export function voicePageRequest(apiKey, pageToken) {
  const params = new URLSearchParams({
    page_size: String(VOICE_PAGE_SIZE),
    include_total_count: 'false',
  });
  if (pageToken) params.set('next_page_token', pageToken);
  return providerGet(apiKey, `/v2/voices?${params}`);
}

export function dialogueRequest(apiKey, inputs) {
  return {
    url: `${ELEVENLABS_API}/v1/text-to-dialogue?output_format=${DEMO_SAMPLE_OUTPUT_FORMAT}`,
    init: {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ inputs, model_id: DEMO_SAMPLE_MODEL }),
    },
  };
}

export function dialogueInputs(anaVoiceId, patientVoiceId) {
  return DEMO_SAMPLE_LINES.map((line) => ({
    text: line.text,
    voice_id: line.speaker === 'ana' ? anaVoiceId : patientVoiceId,
  }));
}

function isEnglishCode(code) {
  return typeof code === 'string' && /^en([-_]|$)/i.test(code.trim());
}

export function englishEvidence(voice) {
  const verified = Array.isArray(voice?.verified_languages) ? voice.verified_languages : [];
  if (verified.some((item) => isEnglishCode(item?.language) || isEnglishCode(item?.locale))) {
    return 'english_verified';
  }
  if (isEnglishCode(voice?.labels?.language)) return 'english_label';
  return null;
}

function genderFit(voice, anaGender) {
  const gender = voice.labels?.gender;
  if (!gender) return 1;
  if (anaGender && gender !== anaGender) return 2;
  return anaGender ? 0 : 1;
}

function isEligiblePatient(voice, ana) {
  if (!voice?.voice_id || voice.voice_id === ana.voice_id) return false;
  if (voice.name && ana.name && voice.name.toLowerCase() === ana.name.toLowerCase()) return false;
  return !CHILD_AGES.includes(voice.labels?.age);
}

const LANGUAGE_RANK = { english_verified: 2, english_label: 1 };

export function describeVoices(voices) {
  const withEnglish = voices.filter((voice) => englishEvidence(voice));
  return {
    scanned: voices.length,
    english_matches: withEnglish.length,
    sample: voices.slice(0, DIAGNOSTIC_SAMPLE_SIZE).map((voice) => ({
      name: voice.name ?? null,
      voice_id: voice.voice_id ?? null,
      gender: voice.labels?.gender ?? null,
      age: voice.labels?.age ?? null,
      languages: (voice.verified_languages ?? []).map((item) => item?.language).filter(Boolean),
      language_label: voice.labels?.language ?? null,
    })),
  };
}

export function selectPatientVoice(voices, ana) {
  const anaGender = ana.labels?.gender ?? null;
  const ranked = voices
    .filter((voice) => isEligiblePatient(voice, ana))
    .map((voice) => {
      const evidence = englishEvidence(voice);
      return {
        voice,
        evidence,
        score: [LANGUAGE_RANK[evidence] ?? 0, genderFit(voice, anaGender), voice.category === 'premade' ? 1 : 0],
      };
    })
    .sort(
      (a, b) =>
        b.score[0] - a.score[0] ||
        b.score[1] - a.score[1] ||
        b.score[2] - a.score[2] ||
        String(a.voice.name).localeCompare(String(b.voice.name))
    );
  const [best] = ranked;
  if (!best) {
    throw new DemoSampleError(
      502,
      `No hay una voz de paciente disponible en la cuenta. Voces revisadas: ${voices.length}.`,
      describeVoices(voices)
    );
  }
  return {
    voice_id: best.voice.voice_id,
    name: best.voice.name,
    match: best.evidence ?? 'language_unverified',
  };
}

async function listAccessibleVoices(fetchImpl, apiKey) {
  const voices = [];
  let pageToken = null;
  for (let page = 0; page < MAX_VOICE_PAGES; page += 1) {
    const body = await getJson(fetchImpl, voicePageRequest(apiKey, pageToken));
    if (!Array.isArray(body.voices)) {
      throw new DemoSampleError(502, 'ElevenLabs devolvió una lista de voces no válida.');
    }
    voices.push(...body.voices);
    if (!body.has_more || !body.next_page_token) break;
    pageToken = body.next_page_token;
  }
  return voices;
}

export async function buildDemoSample({ apiKey, anaVoiceId, fetchImpl = fetch }) {
  const voices = await listAccessibleVoices(fetchImpl, apiKey);
  const ana = voices.find((voice) => voice.voice_id === anaVoiceId);
  if (!ana) {
    throw new DemoSampleError(
      502,
      'La voz de Ana no aparece en la cuenta de ElevenLabs.',
      describeVoices(voices)
    );
  }
  const patient = selectPatientVoice(voices, ana);
  const request = dialogueRequest(apiKey, dialogueInputs(anaVoiceId, patient.voice_id));
  const response = await send(fetchImpl, request.url, request.init);
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!response.ok || !response.body || !contentType.startsWith('audio/')) {
    throw new DemoSampleError(
      502,
      `ElevenLabs no generó la muestra (HTTP ${response.status}). Intente de nuevo.`
    );
  }
  return {
    audio: response.body,
    voices: [
      { role: 'ana', name: ana.name, voice_id: ana.voice_id },
      {
        role: 'patient',
        name: patient.name,
        voice_id: patient.voice_id,
        match: patient.match,
      },
    ],
  };
}

function providerGet(apiKey, path) {
  return {
    url: `${ELEVENLABS_API}${path}`,
    init: { method: 'GET', headers: { 'xi-api-key': apiKey, Accept: 'application/json' } },
  };
}

async function getJson(fetchImpl, request) {
  const response = await send(fetchImpl, request.url, request.init);
  if (!response.ok) {
    throw new DemoSampleError(
      502,
      `ElevenLabs no devolvió las voces disponibles (HTTP ${response.status}).`
    );
  }
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new DemoSampleError(502, 'ElevenLabs devolvió una respuesta de voces no válida.');
  }
  return body;
}

async function send(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new DemoSampleError(502, 'No se pudo conectar con ElevenLabs. Intente de nuevo.');
  }
}
