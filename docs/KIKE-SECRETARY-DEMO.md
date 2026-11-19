# Kike Sites: Secretaria IA page changes

Paste the section below into the **Kike Sites** Bolt project (the app that serves
`/preview/plw-<token>/secretaria`). The server side lives in this repo
(`supabase/functions/plw-secretary-converse`) and is already done.

Before this works live: run migration `20261119210000_secretary_demo_conversations.sql`
and publish PLW Call Center through Bolt, so `plw-secretary-converse` has the new actions.

---

## Prompt for Bolt (Kike Sites)

Update the Secretaria IA demo page (`/preview/plw-<token>/secretaria`). Keep the existing
design. Three changes:

### 1. Stop overlapping audio

Right now each "listen" button starts a new audio clip while the previous one keeps
playing. Use **one shared audio player** for the whole page:

- Keep a single `HTMLAudioElement` (and an `AbortController` for the request that fetches
  the clip) in a ref.
- When any button is pressed: abort the in-flight request, `pause()` the current audio,
  reset `currentTime = 0`, revoke the old object URL, then fetch and play the new clip.
- Stop that audio too when a live conversation (below) starts, and when the page unmounts.

### 2. Live conversation with the AI secretary (replaces the fixed-answer buttons as the main action)

Install `@elevenlabs/client`. The page already calls the Supabase function
`plw-secretary-converse` for the demo; call the same URL with JSON bodies:

- On load: `POST { "action": "status", "token": "<preview token>" }` returns
  `{ notice, closing, remaining, limits: { conversations, questions, minutes } }`.
  Show `notice` as a visible label above the start button, plus
  "Le quedan {remaining} de {limits.conversations} conversaciones."
- Button **"Hablar con la secretaria"** (disabled when `remaining` is 0, or while a
  conversation is running):
  1. Ask for the microphone: `navigator.mediaDevices.getUserMedia({ audio: true })`.
  2. `POST { "action": "start", "token": "<preview token>" }`.
  3. If the answer has `allowed: false`, show its `message` (it already includes the
     contact number) and stop.
  4. Otherwise start the call:
     ```js
     import { Conversation } from '@elevenlabs/client';
     const conversation = await Conversation.startSession({
       conversationToken: data.conversationToken,
       connectionType: 'webrtc',
       dynamicVariables: data.dynamicVariables,
       onDisconnect: () => showClosing(),
       onModeChange: ({ mode }) => setSpeaking(mode === 'speaking'),
     });
     ```
     Do not change or add keys in `dynamicVariables`; pass them exactly as received.
- While connected: a pulsing "La secretaria está escuchando / hablando" indicator and a
  **"Terminar"** button that calls `conversation.endSession()`.
- `showClosing()`: show a card with the server's `closing` text (it says to contact PLW
  at 4010-6198 for the full service) and a **Llamar a PLW** button
  (`tel:+50640106198`). Then refresh the `status` call so the remaining count updates.
- Only one conversation at a time. If `start` returns HTTP 429 or 503, show its `error`
  text.

### 3. Limits copy

The limits are enforced on the server (3 conversations per customer, each ending after
10 questions or 5 minutes). Use the `notice`, `closing` and `message` texts from the
server instead of hard-coding numbers, so they stay correct if the limits change.
