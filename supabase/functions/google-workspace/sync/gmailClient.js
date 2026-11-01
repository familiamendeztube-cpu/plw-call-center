import { GoogleApiError } from '../googleApi.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 2000, 4000];

export function createGmailClient({ fetchImpl, accessToken, sleep = defaultSleep }) {
  async function request(path, params = {}) {
    const url = new URL(`${GMAIL_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
      else url.searchParams.set(key, String(value));
    }

    for (let attempt = 1; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        if (attempt >= MAX_ATTEMPTS) throw new GoogleApiError('network', 0);
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
      if (response.ok) return response.json();
      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
      const body = await response.json().catch(() => null);
      throw new GoogleApiError(body?.error?.status ?? 'gmail_failed', response.status);
    }
  }

  return {
    async profileHistoryId() {
      const data = await request('/profile');
      if (typeof data?.historyId !== 'string') throw new GoogleApiError('profile_failed', 0);
      return data.historyId;
    },

    listMessages({ query, pageToken }) {
      return request('/messages', {
        q: query,
        labelIds: ['INBOX'],
        maxResults: 50,
        pageToken,
      }).then((data) => ({
        ids: (data.messages ?? []).map((item) => item.id),
        nextPageToken: data.nextPageToken ?? null,
      }));
    },

    listHistory({ startHistoryId, pageToken }) {
      return request('/history', {
        startHistoryId,
        historyTypes: 'messageAdded',
        labelId: 'INBOX',
        pageToken,
      }).then((data) => ({
        ids: (data.history ?? []).flatMap((entry) =>
          (entry.messagesAdded ?? []).map((item) => item.message?.id).filter(Boolean),
        ),
        nextPageToken: data.nextPageToken ?? null,
        historyId: typeof data.historyId === 'string' ? data.historyId : null,
      }));
    },

    getMessage(id) {
      return request(`/messages/${encodeURIComponent(id)}`, { format: 'full' });
    },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
