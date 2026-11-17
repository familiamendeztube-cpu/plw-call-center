import { useEffect } from 'react';
import { PresenceProvider } from '@/features/presence/context/PresenceProvider';
import { useAgentAlerts } from '@/features/presence/hooks/useAgentAlerts';
import { useAgentSession } from '@/features/auth/hooks/useAgentSession';
import { AgentProspectsProvider } from '@/features/leads/context/AgentProspectsProvider';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { isCallLive } from '@/features/telephony/models/call';
import { useAppServices } from '@/app/ServicesContext';
import { WorkspaceLayout } from '@/app/shell/WorkspaceLayout';

export function AgentWorkspace() {
  const { agentId } = useAgentSession();
  const { presence } = useAppServices();
  useAgentAlerts(agentId);

  return (
    <PresenceProvider agentId={agentId} service={presence}>
      <AgentProspectsProvider agentId={agentId}>
        <CallStateReporter />
        <WorkspaceLayout />
      </AgentProspectsProvider>
    </PresenceProvider>
  );
}

/**
 * Tells the server while the agent is on a call: the administrator sees "En llamada" and Anna's
 * dialer skips a busy agent. The first report (no call) also clears a call left over from a tab
 * that closed mid-call. Its own component, so a call change doesn't re-render every page.
 */
function CallStateReporter() {
  const { presence } = useAppServices();
  const { call } = useTelephony();
  const inCall = call !== null && isCallLive(call.state);

  useEffect(() => {
    presence.setInCall(inCall).catch(() => undefined);
  }, [presence, inCall]);

  return null;
}
