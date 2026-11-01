import { PresenceProvider } from '@/features/presence/context/PresenceProvider';
import { useAgentSession } from '@/features/auth/hooks/useAgentSession';
import { useAppServices } from '@/app/ServicesContext';
import { WorkspaceLayout } from '@/app/shell/WorkspaceLayout';

export function AgentWorkspace() {
  const { agentId } = useAgentSession();
  const { presence } = useAppServices();

  return (
    <PresenceProvider agentId={agentId} service={presence}>
      <WorkspaceLayout />
    </PresenceProvider>
  );
}
