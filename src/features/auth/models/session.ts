import type { AgentId } from '@/features/auth/models/agent';

export type SessionSource = 'demo' | 'production';

export type Session =
  | {
      role: 'agent';
      source: SessionSource;
      agentId: AgentId;
      displayName: string;
    }
  | {
      role: 'admin';
      source: SessionSource;
      displayName: string;
    };
