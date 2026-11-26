-- Owner-authorized offboarding of Valeska (agent-3) and reassignment to Alejandro (agent-2).
-- History is preserved: historical dental_calls.staff_id, asterisk_calls, activity and audit
-- rows keep their original attribution. Only future work moves.

-- 1. Disable the account; the sign-in and claim gates read is_enabled.
UPDATE staff_profiles SET is_enabled = false, updated_at = now() WHERE id = 'agent-3';

-- 2. Revoke existing sessions (normal supported mechanism used by session-revocation flows).
UPDATE staff_profiles SET sessions_revoked_at = now() WHERE id = 'agent-3';

-- 3. Presence: flip to paused so no gate can treat her as active (no fabricated heartbeat).
UPDATE staff_presence SET availability = 'paused', last_heartbeat_at = NULL, updated_at = now() WHERE staff_id = 'agent-3';

-- 4. Dental leads: move all of Valeska's leads (including do-not-call history) to Alejandro.
--    Per-number attempt counts, callback dates and exclusions live on dental_calls and are not touched.
UPDATE dental_leads SET owner_staff_id = 'agent-2', updated_at = now() WHERE owner_staff_id = 'agent-3';

-- 5. Prospects and the general assignment queue.
UPDATE prospects SET owner_id = 'agent-2', updated_at = now() WHERE owner_id = 'agent-3';
UPDATE assignment_queue SET assigned_to = 'agent-2' WHERE assigned_to = 'agent-3' AND status = 'assigned';

-- 6. Future follow-ups (open ones) move; completed ones keep their history.
UPDATE followups SET agent_id = 'agent-2' WHERE agent_id = 'agent-3' AND completed = false;

-- 7. Future transfers must never reach Valeska's route: stop it. Her provider agent and route
--    row remain intact for history; the runner only dispatches from running dialers, and the
--    claim gate reads is_enabled on the staff profile, so no future claim can use her.
UPDATE dental_agent_dialers
SET state = 'stopped',
    last_error = 'Fuera de servicio: llamadas y transferencias futuras van a Alejandro.',
    updated_at = now()
WHERE staff_id = 'agent-3';

-- 8. Round-robin cursor points at Alejandro so the next assignment continues from him.
UPDATE assignment_cursor SET last_staff_id = 'agent-2' WHERE id = 1;

-- 9. Audit trail of this offboarding.
INSERT INTO admin_audit_events(actor_id, action, target_id, detail)
VALUES ('admin-1', 'offboard_reassign', 'agent-3',
  '{"summary":"Valeska offboarded: account disabled, sessions revoked, presence paused, dialer stopped. Leads, prospects, queue and open follow-ups reassigned to agent-2. History preserved."}'::jsonb);
