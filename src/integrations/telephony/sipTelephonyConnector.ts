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
const RING_CYCLE_MS = 6000;
const RING_SECONDS = 2;
const RING_VOLUME = 0.1;
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

// The browser can refuse to start this until the agent has clicked on the page.
// The phone panel still shows the incoming call.
function startRingtone(): () => void {
  const context = new AudioContext();
  const volume = context.createGain();
  volume.gain.value = 0;
  volume.connect(context.destination);
  for (const frequency of [440, 480]) {
    const tone = context.createOscillator();
    tone.frequency.value = frequency;
    tone.connect(volume);
    tone.start();
  }

  const ring = () => {
    volume.gain.setValueAtTime(RING_VOLUME, context.currentTime);
    volume.gain.setValueAtTime(0, context.currentTime + RING_SECONDS);
  };
  ring();
  const timer = window.setInterval(ring, RING_CYCLE_MS);
  return () => {
    window.clearInterval(timer);
    void context.close();
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
    publishCall({
      id: next.id,
      state: inbound ? 'ringing' : 'dialing',
      direction: inbound ? 'inbound' : 'outbound',
      remoteNumber: next.remote_identity.uri.user ?? '',
      startedAt: null,
      muted: false,
    });
    if (inbound) stopRingtone = startRingtone();

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
    agent.on('registered', () => setStatus('registered'));
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

    setOnHold: async () => fail(NOT_AVAILABLE),
    transfer: async () => fail(NOT_AVAILABLE),
  };
}
