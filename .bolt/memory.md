# Project memory

## Product intent & audience

- PLW (Professional Latino Workers) voice-agent product for US-based small businesses (plumbing, auto repair, painting, etc.).
- Two ElevenLabs agents: Anna (outbound dialer / sales) and a reception/inbound agent.
- Goal: answer client calls for solopreneurs while they work, capture messages, notify via SMS, and sell the service (USD 200/month, website included free).
- Spanish-first; English and Mandarin supported only with verified/pronounce-enabled voices. Never claim unsupported languages.

## Brand personality & voice

- Anna persona: bilingual (Spanish-first), warm, sales-oriented with spoken examples, listens, brief turns.
- Never impersonates a human; discloses AI identity clearly when asked and during natural closing.
- No-pressure sales; only closes when explicit interest shown.

## Visual design & UX direction

- Vite + React + Tailwind + lucide-react; `@/` alias → `src/`.
- UI has a US agent card; transfer-to-live route/status text and availability requirements removed.

## Decisions, constraints & rationale

- No live transfers: removed `transfer_to_number` tool, prompts, verifiers, UI status, and live-availability requirements.
- Callback within 24h only if explicit interest + agreement; DST-aware, no appointments without agreement, no immediate connection.
- Fixed pricing USD 200/month; website design included free (estimated value USD 2,000–5,000); no commitment. No invented fees, guarantees, results, or promos.
- Inbound prioritizes caller intent (support first), not selling. Samples (web/voice) sent via SMS only after follow-up human conversation with confirmed interest.
- Serverless functions: no cross-function imports allowed by packager — copy helpers locally (e.g. `readLimited` into chatwoot-webhook, `authorizeStaff` into us-sms).
- Preserve existing numbers, secrets, history, campaign state. No test calls/SMS to clients.

## Open questions & assumptions

- Deployment incomplete: us-sms deployed; us-dialer, chatwoot-webhook, plw-hotel-demo, plw-secretary-converse pending after cross-function import fixes (blocked by deploy attempt limit). Re-run deploy tool to finish.
- ElevenLabs configs for both agents need read-back sync/verification after deploy.
- Local verified: 463/463 tests passing, build OK.
- Assumption: no additional packages needed (Tailwind + lucide-react sufficient).