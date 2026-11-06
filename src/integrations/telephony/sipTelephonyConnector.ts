import { UA, WebSocketInterface } from 'jssip';
import type { RTCSession } from 'jssip/lib/RTCSession';
import type { IncomingRTCSessionEvent, OutgoingRTCSessionEvent } from 'jssip/lib/UA';
import { toCostaRicaNumber, type CallSnapshot } from '@/features/telephony/models/call';
import type { ConnectorResult } from '@/integrations/connectorResult';
import {
  callStaffFunction,
  INVALID_RESPONSE,
  isRecord,
} from '@/integrations/supabase/callStaffFunction';
import type {
  TelephonyConnector,
  TelephonyConnectorEvent,
  TelephonyConnectorStatus,
} from '@/integrations/telephony/telephonyContract';

interface SipAccount {
  wssUrl: string;
  sipDomain: string;
  username: string;
  password: string;
}

const ENDED_DISPLAY_MS = 5000;
const MEDIA_TIMEOUT_MS = 10000;
// Ring, ring, then a pause: 0.4 s on, 0.2 s off, 0.4 s on, 2 s off.
const RING_BURSTS: [number, number][] = [
  [0, 0.4],
  [0.6, 1],
];
const RING_CYCLE_SECONDS = 3;
// Two pitches trading places 25 times a second: the trill of a desk phone.
const RING_PITCHES = [950, 1400];
const RING_TRILL_HZ = 25;
// ponytail: one loudness for every agent; add a volume setting if some find it too loud.
const RING_VOLUME = 0.5;
const AUTHENTICATION_ERROR = 'Authentication Error';
const AUDIO_LOST_CAUSE = 'RTP Timeout';
const LOCAL_CANCEL_CAUSE = 'Canceled';

const OK: ConnectorResult = { ok: true, message: '' };
const NO_CALL = 'No hay ninguna llamada en curso.';
const CALL_GONE = 'La llamada ya terminó.';
const CALL_IN_PROGRESS = 'Ya hay una llamada en curso.';
const NOT_REGISTERED = 'La línea no está registrada todavía.';
const ONLY_COSTA_RICA = 'Por ahora solo se puede llamar a números de Costa Rica de 8 dígitos.';
const NOT_AVAILABLE = 'Esta función todavía no está disponible.';
const CONNECTION_LOST = 'No se pudo conectar con el servidor telefónico. Reintentando...';
const LOGIN_REJECTED = 'El servidor rechazó la cuenta de teléfono. Contacta al administrador.';
const REGISTRATION_FAILED = 'No se pudo registrar la línea. Reintentando...';
const ACCOUNT_FAILED = 'No se pudo cargar la cuenta de teléfono.';
const AUDIO_BLOCKED = 'El navegador bloqueó el audio de la llamada. Haz clic en la página.';
const RING_LOCKED =
  'Haz clic una vez en cualquier parte de la página para que suene el timbre cuando entre una llamada.';
const CALL_FAILED = 'No se pudo completar la llamada.';

const FAILURE_MESSAGES: Record<string, string> = {
  Busy: 'El número está ocupado.',
  Rejected: 'La llamada fue rechazada.',
  'Not Found': 'El número no existe o no está permitido.',
  'Address Incomplete': 'El número no existe o no está permitido.',
  Unavailable: 'El número no está disponible.',
  'No Answer': 'No hubo respuesta.',
  [AUDIO_LOST_CAUSE]: 'La llamada se cortó porque no hubo conexión de audio. Revisa la red.',
};

function fail(message: string): ConnectorResult {
  return { ok: false, message };
}

function errorName(error: unknown): string {
  return error instanceof DOMException ? error.name : '';
}

function microphoneMessage(error: unknown): string {
  switch (errorName(error)) {
    case 'NotAllowedError':
      return 'Permite el micrófono en el navegador e intenta de nuevo.';
    case 'NotFoundError':
      return 'Este equipo no tiene un micrófono disponible.';
    case 'NotReadableError':
      return 'Otra aplicación está usando el micrófono.';
    default:
      return 'No se pudo abrir el micrófono.';
  }
}

function failureMessage(cause: string, direction: CallSnapshot['direction']): string | undefined {
  if (cause === AUDIO_LOST_CAUSE) return FAILURE_MESSAGES[cause];
  if (direction === 'inbound' || cause === LOCAL_CANCEL_CAUSE) return undefined;
  return FAILURE_MESSAGES[cause] ?? CALL_FAILED;
}

function readSipAccount(payload: Record<string, unknown>): SipAccount | null {
  if (payload.account === null) return null;
  const account = payload.account;
  if (
    !isRecord(account) ||
    typeof account.wssUrl !== 'string' ||
    typeof account.sipDomain !== 'string' ||
    typeof account.username !== 'string' ||
    typeof account.password !== 'string'
  ) {
    throw new Error(INVALID_RESPONSE);
  }
  return {
    wssUrl: account.wssUrl,
    sipDomain: account.sipDomain,
    username: account.username,
    password: account.password,
  };
}

/** One cycle of the ringtone, as samples to loop. */
export function ringSamples(sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.round(RING_CYCLE_SECONDS * sampleRate));
  let phase = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const seconds = index / sampleRate;
    const pitch = RING_PITCHES[Math.floor(seconds * RING_TRILL_HZ * 2) % 2];
    // The phase carries over between pitches, so the trill has no clicks.
    phase += (2 * Math.PI * pitch) / sampleRate;
    const ringing = RING_BURSTS.some(([from, to]) => seconds >= from && seconds < to);
    samples[index] = ringing ? Math.sin(phase) * RING_VOLUME : 0;
  }
  return samples;
}

// Loops on the audio clock, not a timer, so it keeps ringing in a background tab.
function startRingtone(context: AudioContext): () => void {
  void context.resume(); // In case the system paused it since the agent's click.
  const cycle = ringSamples(context.sampleRate);
  const buffer = context.createBuffer(1, cycle.length, context.sampleRate);
  buffer.copyToChannel(cycle, 0);
  const ring = context.createBufferSource();
  ring.buffer = buffer;
  ring.loop = true;
  ring.connect(context.destination);
  ring.start();
  return () => {
    ring.stop();
    ring.disconnect();
  };
}

export function createSipTelephonyConnector(): TelephonyConnector {
  const listeners = new Set<(event: TelephonyConnectorEvent) => void>();
  const remoteAudio = new Audio();
  let status: TelephonyConnectorStatus = 'pending_configuration';
  let ua: UA | null = null;
  let sipDomain = '';
  let session: RTCSession | null = null;
  let call: CallSnapshot | null = null;
  let localStream: MediaStream | null = null;
  let microphonePending = false;
  let stopRingtone: (() => void) | null = null;
  let endedTimer: number | undefined;
  // Tells a slow start() that stop() ran while it was waiting for the account.
  let startCount = 0;

  function emit(event: TelephonyConnectorEvent) {
    listeners.forEach((listener) => listener(event));
  }

  function setStatus(next: TelephonyConnectorStatus, message?: string) {
    status = next;
    emit({ type: 'status', status: next, message });
  }

  // The ringtone's sound output, switched on during the agent's own click or key press: Safari
  // plays sound only from one started there, and Chrome and Edge only after the page was clicked.
  // Every call reuses it.
  let ringer: AudioContext | null = null;
  const ringerReady = () => ringer?.state === 'running';
  const switchOnRinger = () => {
    if (ringerReady()) return;
    ringer ??= new AudioContext();
    void ringer.resume().then(() => {
      if (status === 'registered') setStatus('registered'); // Drops the "click once" warning.
    });
  };
  for (const type of ['click', 'keydown']) window.addEventListener(type, switchOnRinger, true);

  function publishCall(next: CallSnapshot | null, message?: string) {
    call = next;
    emit({ type: 'call', call: next, message });
  }

  function stopMicrophone() {
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  function silenceRingtone() {
    stopRingtone?.();
    stopRingtone = null;
  }

  function playRemoteAudio(connection: RTCPeerConnection) {
    connection.addEventListener('track', (event) => {
      remoteAudio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      remoteAudio.play().catch(() => {
        if (call) publishCall(call, AUDIO_BLOCKED);
      });
    });
  }

  function finishCall(cause: string) {
    session = null;
    silenceRingtone();
    stopMicrophone();
    remoteAudio.srcObject = null;
    if (!call) return;
    publishCall({ ...call, state: 'ended' }, failureMessage(cause, call.direction));
    endedTimer = window.setTimeout(() => publishCall(null), ENDED_DISPLAY_MS);
  }

  function trackSession({
    session: next,
    originator,
  }: IncomingRTCSessionEvent | OutgoingRTCSessionEvent) {
    const inbound = (originator as string) === 'remote';
    if (session) {
      next.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      return;
    }

    session = next;
    window.clearTimeout(endedTimer);
    publishCall(
      {
        id: next.id,
        state: inbound ? 'ringing' : 'dialing',
        direction: inbound ? 'inbound' : 'outbound',
        remoteNumber: next.remote_identity.uri.user ?? '',
        startedAt: null,
        muted: false,
      },
      inbound && !ringerReady() ? RING_LOCKED : undefined
    );
    if (inbound && ringer) stopRingtone = startRingtone(ringer);

    // JsSIP creates the connection for an outgoing call before this event, and
    // for an incoming call only when it is answered.
    if (next.connection) playRemoteAudio(next.connection);
    else next.on('peerconnection', ({ peerconnection }) => playRemoteAudio(peerconnection));

    next.on('progress', () => {
      if (!inbound && call) publishCall({ ...call, state: 'ringing' });
    });
    next.on('accepted', () => {
      silenceRingtone();
      if (call) publishCall({ ...call, state: 'active', startedAt: new Date().toISOString() });
      // The call can look live while no audio can pass, for example when a firewall
      // blocks UDP. End it and say why, so nobody stays on a silent paid call.
      window.setTimeout(() => {
        if (session === next && next.connection.connectionState !== 'connected') {
          next.terminate({
            cause: AUDIO_LOST_CAUSE,
            status_code: 408,
            reason_phrase: AUDIO_LOST_CAUSE,
          });
        }
      }, MEDIA_TIMEOUT_MS);
    });
    next.on('ended', ({ cause }) => finishCall(cause));
    next.on('failed', ({ cause }) => finishCall(cause));
  }

  function connect(account: SipAccount) {
    sipDomain = account.sipDomain;
    const agent = new UA({
      sockets: [new WebSocketInterface(account.wssUrl)],
      uri: `sip:${account.username}@${account.sipDomain}`,
      password: account.password,
    });
    agent.on('connecting', () => setStatus('connecting'));
    agent.on('disconnected', () => setStatus('error', CONNECTION_LOST));
    agent.on('registered', () => setStatus('registered', ringerReady() ? undefined : RING_LOCKED));
    agent.on('unregistered', () => setStatus('connecting'));
    agent.on('registrationFailed', ({ cause }) =>
      setStatus('error', cause === AUTHENTICATION_ERROR ? LOGIN_REJECTED : REGISTRATION_FAILED)
    );
    agent.on('newRTCSession', trackSession);
    agent.start();
    ua = agent;
  }

  async function withMicrophone(
    action: (stream: MediaStream) => ConnectorResult
  ): Promise<ConnectorResult> {
    if (microphonePending) return OK;
    microphonePending = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      return fail(microphoneMessage(error));
    } finally {
      microphonePending = false;
    }

    localStream = stream;
    const result = action(stream);
    if (!result.ok) stopMicrophone();
    return result;
  }

  return {
    get status() {
      return status;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start() {
      startCount += 1;
      const thisStart = startCount;
      setStatus('connecting');
      try {
        const payload = await callStaffFunction('telephony', { action: 'get_my_account' });
        if (thisStart !== startCount) return;
        const account = readSipAccount(payload);
        if (account) connect(account);
        else setStatus('pending_configuration');
      } catch (error) {
        if (thisStart !== startCount) return;
        setStatus('error', error instanceof Error ? error.message : ACCOUNT_FAILED);
      }
    },

    stop() {
      startCount += 1;
      ua?.removeAllListeners();
      ua?.stop();
      ua = null;
      setStatus('pending_configuration');
    },

    async dial(number) {
      const target = toCostaRicaNumber(number);
      if (!target) return fail(ONLY_COSTA_RICA);
      return withMicrophone((stream) => {
        if (!ua || status !== 'registered') return fail(NOT_REGISTERED);
        // A call can arrive while the browser asks for the microphone.
        if (session) return fail(CALL_IN_PROGRESS);
        ua.call(`sip:${target}@${sipDomain}`, { mediaStream: stream });
        return OK;
      });
    },

    async answer() {
      const incoming = session;
      if (!incoming || call?.direction !== 'inbound' || call.state !== 'ringing') {
        return fail(NO_CALL);
      }
      return withMicrophone((stream) => {
        // The caller may hang up while the browser asks for the microphone.
        if (session !== incoming) return fail(CALL_GONE);
        incoming.answer({ mediaStream: stream });
        return OK;
      });
    },

    async hangup() {
      if (!session) return fail(NO_CALL);
      const rejecting = call?.direction === 'inbound' && call.state === 'ringing';
      session.terminate(rejecting ? { status_code: 486, reason_phrase: 'Busy Here' } : {});
      return OK;
    },

    async setMuted(muted) {
      if (!session || call?.state !== 'active') return fail(NO_CALL);
      if (muted) session.mute({ audio: true });
      else session.unmute({ audio: true });
      publishCall({ ...call, muted });
      return OK;
    },

    async sendDtmf(digits) {
      if (!session || call?.state !== 'active') return fail(NO_CALL);
      session.sendDTMF(digits);
      return OK;
    },

    setOnHold: async () => fail(NOT_AVAILABLE),
    transfer: async () => fail(NOT_AVAILABLE),
  };
}
