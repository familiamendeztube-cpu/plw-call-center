import type { AppServices } from '@/app/appServices';
import { createDemoState } from '@/demo/demoState';
import { createDemoAgentDirectory, createDemoAuthService } from '@/demo/adapters/demoAuthService';
import { createDemoAssignmentService } from '@/demo/adapters/demoAssignmentService';
import { createDemoPresenceService } from '@/demo/adapters/demoPresenceService';
import { createDemoInboxService } from '@/demo/adapters/demoInboxService';
import { createDemoLeadService } from '@/demo/adapters/demoLeadService';
import { createDemoFollowupService } from '@/demo/adapters/demoFollowupService';
import { createDemoMaterialService } from '@/demo/adapters/demoMaterialService';
import { createPendingEmailConnector } from '@/integrations/email/pendingEmailConnector';
import { createPendingTelephonyConnector } from '@/integrations/telephony/pendingTelephonyConnector';

export function createDemoServices(now: Date = new Date()): AppServices {
  const state = createDemoState(now);
  return {
    auth: createDemoAuthService(state),
    agents: createDemoAgentDirectory(state),
    presence: createDemoPresenceService(state),
    inbox: createDemoInboxService(state),
    leads: createDemoLeadService(state),
    followups: createDemoFollowupService(state),
    materials: createDemoMaterialService(state),
    assignments: createDemoAssignmentService(state),
    email: createPendingEmailConnector(),
    telephony: createPendingTelephonyConnector(),
  };
}
