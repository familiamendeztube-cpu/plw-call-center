import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/useAuth';
import type { Session } from '@/features/auth/models/session';
import { ADMIN_HOME, AGENT_HOME } from '@/app/shell/navigation';

interface RequireRoleProps {
  role: Session['role'];
  children: ReactNode;
}

export function RequireRole({ role, children }: RequireRoleProps) {
  const { session } = useAuth();

  if (!session) {
    return <Navigate to="/login" replace />;
  }
  if (session.role !== role) {
    return <Navigate to={session.role === 'agent' ? AGENT_HOME : ADMIN_HOME} replace />;
  }
  return <>{children}</>;
}
