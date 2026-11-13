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
const ENGLISH_PATIENT_AGES = ['young adult', 'middle aged'];

export class DemoSampleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function voicesLookupRequest(apiKey, voiceId) {
  return providerGet(apiKey, `/v2/voices?voice_ids=${encodeURIComponent(voiceId)}&page_size=1`);
}

export function englishVoicesRequest(apiKey) {
  return providerGet(apiKey, '/v2/voices?language=en&page_size=100');
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

export function selectPatientVoice(candidates, ana) {
  const anaGender = ana.labels?.gender;
  if (!anaGender) throw new DemoSampleError(502, 'No se pudo verificar el género de la voz de Ana.');
  const eligible = candidates
    .filter(
      (voice) =>
        voice.voice_id !== ana.voice_id &&
        voice.labels?.gender &&
        voice.labels.gender !== anaGender &&
        ENGLISH_PATIENT_AGES.includes(voice.labels?.age)
    )
    .sort(
      (a, b) =>
        Number(b.category === 'premade') - Number(a.category === 'premade') ||
        a.name.localeCompare(b.name)
    );
  const [patient] = eligible;
  if (!patient)
    throw new DemoSampleError(502, 'No hay una voz de paciente en inglés disponible en la cuenta.');
  return { voice_id: patient.voice_id, name: patient.name };
}

export async function buildDemoSample({ apiKey, anaVoiceId, fetchImpl = fetch }) {
  const ana = await fetchVoiceList(fetchImpl, voicesLookupRequest(apiKey, anaVoiceId), (voices) =>
    voices.find((voice) => voice.voice_id === anaVoiceId)
  );
  if (!ana) throw new DemoSampleError(502, 'La voz de Ana no está disponible en ElevenLabs.');
  const candidates = await fetchVoiceList(fetchImpl, englishVoicesRequest(apiKey), (voices) => voices);
  const patient = selectPatientVoice(candidates, ana);
  const request = dialogueRequest(apiKey, dialogueInputs(anaVoiceId, patient.voice_id));
  const response = await send(fetchImpl, request.url, request.init);
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!response.ok || !response.body || !contentType.startsWith('audio/')) {
    throw new DemoSampleError(502, 'ElevenLabs no generó la muestra. Intente de nuevo.');
  }
  return {
    audio: response.body,
    voices: [
      { role: 'ana', name: ana.name, voice_id: ana.voice_id },
      { role: 'patient', name: patient.name, voice_id: patient.voice_id },
    ],
  };
}

function providerGet(apiKey, path) {
  return {
    url: `${ELEVENLABS_API}${path}`,
    init: { method: 'GET', headers: { 'xi-api-key': apiKey, Accept: 'application/json' } },
  };
}

async function fetchVoiceList(fetchImpl, request, pick) {
  const response = await send(fetchImpl, request.url, request.init);
  if (!response.ok) throw new DemoSampleError(502, 'ElevenLabs no devolvió las voces disponibles.');
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body?.voices)) {
    throw new DemoSampleError(502, 'ElevenLabs devolvió una lista de voces no válida.');
  }
  return pick(body.voices);
}

async function send(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new DemoSampleError(502, 'No se pudo conectar con ElevenLabs. Intente de nuevo.');
  }
}
