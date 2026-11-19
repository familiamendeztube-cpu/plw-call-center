# Kike Sites: Secretaria IA page changes

Paste the section below into the **Kike Sites** Bolt project (the app that serves
`/preview/plw-<token>/secretaria`). The server side lives in this repo
(`supabase/functions/plw-secretary-converse`).

Before this works live:
1. Run migration `20261119210000_secretary_demo_conversations.sql` in the SQL Editor.
2. Deploy `plw-secretary-converse` (Bolt publish of PLW Call Center, or `npx supabase
   functions deploy plw-secretary-converse --project-ref meagbbmittuhdgwnhvxa --use-api`).

---

## Prompt for Bolt (Kike Sites)

Rework the Secretaria IA demo page (`/preview/plw-<token>/secretaria`). Keep the existing
visual design (header card, colors, fonts). All visible text in Spanish.

### 1. Remove
- The **"Ver transcripción"** link and whatever it opens.
- The current recording flow behind **"Hablar con la secretaria"** (record a voice
  fragment, send it, play back an answer), the text **"Al grabar, se envía un fragmento
  de su voz…"**, and the **typed question box** with **"Enviar pregunta"**.
- The English message "The microphone couldn't be used…".

### 2. Limits label (always visible, right under the header, above the button)
On page load call the Supabase function `plw-secretary-converse` (same URL the page
already uses) with JSON `{ "action": "status", "token": "<preview token>" }`. It returns
`{ notice, closing, remaining, limits: { conversations, questions, minutes } }`.
Show:
- `notice` (e.g. "Demostración de la secretaria: 3 conversaciones de hasta 10 preguntas
  (máximo 5 minutos cada una).")
- "Le quedan {remaining} de {limits.conversations} conversaciones."
Use these server texts; do not hard-code the numbers.

### 3. "Hablar con la secretaria" = live ElevenLabs conversation
Install `@elevenlabs/client`. On click (disabled while connected or when `remaining` is 0):
1. Ask for the microphone with `navigator.mediaDevices.getUserMedia({ audio: true })`.
   If it fails, show: "No se pudo usar el micrófono. Permita el micrófono en su navegador
   (ícono del candado en la barra de direcciones) y vuelva a intentar."
2. `POST { "action": "start", "token": "<preview token>" }` to `plw-secretary-converse`.
   - `allowed: false` → show its `message` (already includes the PLW contact) and stop.
   - HTTP 429/503/502 → show its `error` text.
3. Start the call:
   ```js
   import { Conversation } from '@elevenlabs/client';
   const conversation = await Conversation.startSession({
     conversationToken: data.conversationToken,
     connectionType: 'webrtc',
     dynamicVariables: data.dynamicVariables,
     onDisconnect: () => showClosing(),
     onModeChange: ({ mode }) => setSpeaking(mode === 'speaking'),
     onError: () => showError('La conversación se interrumpió. Intente de nuevo.'),
   });
   ```
   Pass `dynamicVariables` exactly as received.
4. While connected: replace the button with a pulsing indicator ("La secretaria está
   escuchando" / "La secretaria está hablando") and a **"Terminar"** button that calls
   `conversation.endSession()`.
5. `showClosing()`: a card with the server's `closing` text (contact PLW at 4010-6198 for
   the full service) and a **"Llamar a PLW"** button (`tel:+50640106198`). Then call
   `status` again so "Le quedan…" updates.

### 4. Sample buttons ("Escuchar bienvenida" and the cards)
Keep them, but use **one shared audio player** so clips never play over each other: keep
a single `HTMLAudioElement` and `AbortController` in a ref; on every click abort the
pending request, `pause()` the current clip and reset `currentTime = 0` before playing the
new one. Stop any clip when a live conversation starts and when the page unmounts.
