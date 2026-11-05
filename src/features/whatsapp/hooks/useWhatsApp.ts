import { useCallback, useEffect, useState } from 'react';
import { IS_DEMO_MODE } from '@/app/appConfig';
import { useAsync } from '@/app/useAsync';
import {
  callStaffFunction,
  INVALID_RESPONSE,
  isRecord,
} from '@/integrations/supabase/callStaffFunction';
import { getSupabaseClient } from '@/integrations/supabase/client';
import type { Message } from '@/features/inbox/models/message';
import type { WhatsAppTemplate } from '@/features/whatsapp/models/templates';

/** A reply (text, or a file with optional caption), or an approved template with its blanks filled. */
export type WhatsAppOutgoing =
  | { text: string; file?: File }
  | { template: { name: string; language: string; values: Record<string, string> } };

/** What WhatsApp accepts, for the file picker. The server checks each type's size limit. */
export const WHATSAPP_FILE_TYPES =
  '.jpg,.jpeg,.png,.mp4,.3gp,.mp3,.m4a,.aac,.amr,.ogg,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

function sendRequest(
  prospectId: string,
  outgoing: WhatsAppOutgoing
): Record<string, unknown> | FormData {
  if ('template' in outgoing) {
    return { action: 'send_template', prospectId, template: outgoing.template };
  }
  if (!outgoing.file) return { action: 'send', prospectId, text: outgoing.text };
  const form = new FormData();
  form.append('action', 'send');
  form.append('prospectId', prospectId);
  form.append('text', outgoing.text);
  form.append('file', outgoing.file);
  return form;
}

const REFRESH_MS = 15_000;

export type WhatsAppThread =
  /** The agent has not connected their own Chatwoot user yet (or its token stopped working). */
  | { connected: false }
  | {
      connected: true;
      /** The agent's Chatwoot name: replies show under it. */
      sender: string;
      /** Several customers share this number; the agent should check who is writing. */
      ambiguous: boolean;
      /** False once WhatsApp's reply window has closed: only an approved template can reopen it. */
      canReply: boolean;
      messages: Message[];
    };

// Row level security returns a chat only to the customer's agent or an admin.
async function loadChat(prospectId: string): Promise<{ unread: boolean } | null> {
  // Demo customers are not in the database.
  if (IS_DEMO_MODE) return null;
  const { data, error } = await getSupabaseClient()
    .from('whatsapp_chats')
    .select('unread')
    .eq('prospect_id', prospectId);
  if (error) throw new Error('No se pudo revisar el chat de WhatsApp.');
  return data.length > 0 ? { unread: data.some((row) => row.unread === true) } : null;
}

/**
 * Whether the customer has written on WhatsApp, read from PLW (not Chatwoot), so it is cheap enough
 * to check on every customer page. Reloads whenever the customer's last activity changes.
 */
export function useWhatsAppChat(prospectId: string, lastActivity: string | undefined) {
  const [chat, setChat] = useState<{ unread: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    loadChat(prospectId)
      .then((next) => {
        if (active) setChat(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [prospectId, lastActivity]);

  const markRead = useCallback(() => setChat((current) => current && { unread: false }), []);
  return { chat, markRead };
}

function toMessage(prospectId: string, value: unknown): Message {
  if (!isRecord(value)) throw new Error(INVALID_RESPONSE);
  return { ...(value as unknown as Message), conversationId: prospectId };
}

// The server reads Chatwoot and marks the chat read in the same call.
async function loadThread(prospectId: string): Promise<WhatsAppThread> {
  const payload = await callStaffFunction('whatsapp', { action: 'load', prospectId });
  if (payload.connected === false) return { connected: false };
  if (!Array.isArray(payload.messages)) throw new Error(INVALID_RESPONSE);
  return {
    connected: true,
    sender: typeof payload.sender === 'string' ? payload.sender : 'Chatwoot',
    ambiguous: payload.ambiguous === true,
    canReply: payload.canReply !== false,
    messages: payload.messages.map((message) => toMessage(prospectId, message)),
  };
}

/**
 * Links the signed-in agent to their own Chatwoot user. The token goes to the server once and is
 * not kept in the browser; the server checks with Chatwoot whose it is before saving it encrypted.
 */
export async function connectChatwoot(token: string): Promise<void> {
  await callStaffFunction('whatsapp', { action: 'connect', token });
}

/** Without a staffId: the signed-in agent. An administrator passes the agent to disconnect. */
export async function disconnectChatwoot(staffId?: string): Promise<void> {
  await callStaffFunction('whatsapp', { action: 'disconnect', staffId });
}

/**
 * The templates the server read from Chatwoot just now; the server checks them again on send.
 * Null when the agent has not connected their Chatwoot user yet.
 */
export async function loadWhatsAppTemplates(): Promise<WhatsAppTemplate[] | null> {
  const payload = await callStaffFunction('whatsapp', { action: 'templates' });
  if (payload.connected === false) return null;
  if (!Array.isArray(payload.templates)) throw new Error(INVALID_RESPONSE);
  return payload.templates as WhatsAppTemplate[];
}

/**
 * The number as WhatsApp writes it, or null; the server applies the same rule. Costa Rica's eight
 * digits need no 506; another country is written with + and its code.
 */
export function whatsAppNumber(typed: string): string | null {
  const compact = typed.replace(/[\s().-]/g, '');
  const local = /^(?:\+?506)?([2-8]\d{7})$/.exec(compact);
  if (local) return `+506${local[1]}`;
  return /^\+(?!506)[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

/**
 * Writes to a number with an approved template. The server joins the chat to the agent's own
 * customer with that number, or creates one, and refuses another agent's customer before sending.
 * Returns the customer.
 */
export async function startWhatsAppChat(start: {
  phone: string;
  name: string;
  template: { name: string; language: string; values: Record<string, string> };
}): Promise<string> {
  const payload = await callStaffFunction('whatsapp', { action: 'start', ...start });
  if (typeof payload.prospectId !== 'string') throw new Error(INVALID_RESPONSE);
  return payload.prospectId;
}

export function useWhatsAppThread(prospectId: string) {
  const result = useAsync(() => loadThread(prospectId), [prospectId]);
  const { updateData } = result;

  // Updates in place, so the chat stays on screen while it reloads.
  const refresh = useCallback(() => {
    loadThread(prospectId)
      .then((data) => updateData(() => data))
      .catch(() => undefined);
  }, [prospectId, updateData]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const send = useCallback(
    async (outgoing: WhatsAppOutgoing) => {
      try {
        const payload = await callStaffFunction('whatsapp', sendRequest(prospectId, outgoing));
        const message = toMessage(prospectId, payload.message);
        updateData((thread) =>
          thread.connected ? { ...thread, messages: [...thread.messages, message] } : thread
        );
      } catch (error) {
        // A timeout can hide a message that did go out: show the chat as Chatwoot has it.
        refresh();
        throw error;
      }
    },
    [prospectId, updateData, refresh]
  );

  return { ...result, send };
}
