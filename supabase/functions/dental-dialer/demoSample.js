export const DEMO_SAMPLE_FILENAME = 'demostracion-ana-es-en.mp3';
export const DEMO_SAMPLE_MODEL = 'eleven_multilingual_v2';
export const DEMO_SAMPLE_TEXT =
  'Hola, le saluda Anna Chacón-Méndez, de Professional Latino Workers, en Pinares. Le muestro un ejemplo breve para su clínica. Si un paciente llama en inglés: Hello, thank you for calling. Would you like to request an appointment? Y a su equipo le queda el resumen en español: paciente solicita una cita; pendiente de confirmar. Yo soy el ejemplo: soy una asistente de inteligencia artificial. Podemos apoyar a recepción con llamadas fuera de horario y solicitudes organizadas, según las herramientas de su clínica. ¿Le serviría ver una demostración con un caso de su consultorio?';

export function demoSampleRequest(apiKey, voiceId) {
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    init: {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text: DEMO_SAMPLE_TEXT, model_id: DEMO_SAMPLE_MODEL }),
    },
  };
}
