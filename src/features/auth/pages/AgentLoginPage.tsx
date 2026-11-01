import { Navigate } from 'react-router-dom';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import { useAuth } from '@/features/auth/context/useAuth';
import { LoginScreen } from '@/features/auth/components/LoginScreen';
import { StatusMessage } from '@/components/ui/StatusMessage';

export function AgentLoginPage() {
  const { agents } = useAppServices();
  const { session, notice, deviceRequired, signInAgent, enrollDevice } = useAuth();
  const { state } = useAsync(() => agents.listAgents(), [agents]);

  if (session) {
    return <Navigate to={session.role === 'agent' ? '/bandeja' : '/admin/resumen'} replace />;
  }
  if (state.status === 'loading') {
    return <StatusMessage tone="loading" title="Cargando agentes..." />;
  }
  if (state.status === 'error') {
    return (
      <StatusMessage
        tone="error"
        title="No se pudieron cargar los agentes."
        description={state.message}
      />
    );
  }

  return (
    <LoginScreen
      agents={state.data}
      notice={notice}
      deviceRequired={deviceRequired}
      onSignIn={(agentId, pin) => signInAgent({ agentId, pin })}
      onEnrollDevice={(code, label) => enrollDevice({ code, label })}
    />
  );
}
