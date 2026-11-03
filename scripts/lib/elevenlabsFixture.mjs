import { createHmac } from 'node:crypto';

// Shaped after the post_call_transcription example and the GetConversation schema in
// the ElevenLabs docs. The phone number cannot be dialed (Costa Rica numbers start 2-8).
export function postCallEvent(overrides = {}) {
  return {
    type: 'post_call_transcription',
    event_timestamp: 1793750460,
    data: {
      agent_id: 'agent_8601m6hbjwamevz887627c1qp0sq',
      conversation_id: 'conv_plwfixture0001',
      status: 'done',
      transcript: [
        { role: 'agent', message: 'Hola, gracias por llamar a PLW.', time_in_call_secs: 0 },
        { role: 'user', message: 'Quiero que me llamen mañana.', time_in_call_secs: 4 },
      ],
      metadata: {
        start_time_unix_secs: 1793750400,
        call_duration_secs: 58,
        phone_call: {
          type: 'sip_trunking',
          direction: 'inbound',
          external_number: '+50600000000',
          agent_number: '+50640106199',
          phone_number_id: 'phnum_1401m6hdtxwce4cad1662hmmb8jt',
          call_sid: 'fixture-call-sid',
        },
      },
      analysis: {
        call_successful: 'success',
        transcript_summary: 'Prueba de PLW: la clienta pide que la llamen mañana.',
        data_collection_results: {
          customer_name: { data_collection_id: 'customer_name', value: 'Prueba PLW', rationale: '' },
          business_name: { data_collection_id: 'business_name', value: null, rationale: '' },
          call_reason: { data_collection_id: 'call_reason', value: 'Prueba del webhook', rationale: '' },
          preferred_contact: { data_collection_id: 'preferred_contact', value: 'WhatsApp', rationale: '' },
          callback_time: { data_collection_id: 'callback_time', value: 'mañana 10 am', rationale: '' },
          callback_consent: { data_collection_id: 'callback_consent', value: true, rationale: '' },
        },
      },
      conversation_initiation_client_data: {
        dynamic_variables: { system__caller_id: '+50600000000' },
      },
    },
    ...overrides,
  };
}

// Same algorithm as the official SDKs: hex HMAC-SHA256 of "<t>.<raw body>".
export function signatureHeader(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v0=${digest}`;
}
