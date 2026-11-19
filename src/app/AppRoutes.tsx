import { Navigate, Route, Routes } from 'react-router-dom';
import { AgentWorkspace } from '@/app/shell/AgentWorkspace';
import { RequireRole } from '@/app/shell/RequireRole';
import { WorkspaceLayout } from '@/app/shell/WorkspaceLayout';
import { AdminLoginPage } from '@/features/auth/pages/AdminLoginPage';
import { OwnerSetupPage } from '@/features/auth/pages/OwnerSetupPage';
import { AgentLoginPage } from '@/features/auth/pages/AgentLoginPage';
import { ActivityPage } from '@/features/presence/pages/ActivityPage';
import { CustomersPage } from '@/features/customers/pages/CustomersPage';
import { TodayPage } from '@/features/today/pages/TodayPage';
import { FollowupsPage } from '@/features/followups/pages/FollowupsPage';
import { MaterialsPage } from '@/features/sales-materials/pages/MaterialsPage';
import { AdminOverviewPage } from '@/features/admin/pages/AdminOverviewPage';
import { AdminCustomersPage } from '@/features/admin/pages/AdminCustomersPage';
import { AdminAgentsPage } from '@/features/admin/pages/AdminAgentsPage';
import { AdminProspectsPage } from '@/features/admin/pages/AdminProspectsPage';
import { AssignmentPage } from '@/features/assignment/pages/AssignmentPage';
import { AdminFollowupsPage } from '@/features/admin/pages/AdminFollowupsPage';
import { AdminIntegrationsPage } from '@/features/admin/pages/AdminIntegrationsPage';
import { AdminSettingsPage } from '@/features/admin/pages/AdminSettingsPage';
import { AdminAuditPage } from '@/features/admin/pages/AdminAuditPage';
import { AdminAiCallsPage } from '@/features/ai-calls/pages/AdminAiCallsPage';
import { AdminAiOutboundPage } from '@/features/ai-outbound/pages/AdminAiOutboundPage';
import { DentalLeadsPage } from '@/features/dental-leads/pages/DentalLeadsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<AgentLoginPage />} />
      <Route path="/acceso-administrador" element={<AdminLoginPage />} />
      <Route path="/configuracion-inicial" element={<OwnerSetupPage />} />
      <Route
        element={
          <RequireRole role="agent">
            <AgentWorkspace />
          </RequireRole>
        }
      >
        <Route path="/hoy" element={<TodayPage />} />
        <Route path="/clientes" element={<CustomersPage />} />
        <Route path="/dentistas" element={<DentalLeadsPage />} />
        {/* Dental campaign retired: old dialer links go to the current general dialer. */}
        <Route path="/llamadas-dentales" element={<Navigate to="/admin/marcador-general" replace />} />
        <Route path="/bandeja" element={<Navigate to="/clientes" replace />} />
        <Route path="/prospectos" element={<Navigate to="/clientes" replace />} />
        <Route path="/seguimientos" element={<FollowupsPage />} />
        <Route path="/material-comercial" element={<MaterialsPage />} />
        <Route path="/mi-actividad" element={<ActivityPage />} />
      </Route>
      <Route
        element={
          <RequireRole role="admin">
            <WorkspaceLayout />
          </RequireRole>
        }
      >
        <Route path="/admin/resumen" element={<AdminOverviewPage />} />
        <Route path="/admin/clientes" element={<AdminCustomersPage />} />
        <Route path="/admin/agentes" element={<AdminAgentsPage />} />
        <Route path="/admin/prospectos" element={<AdminProspectsPage />} />
        <Route path="/admin/asignaciones" element={<AssignmentPage />} />
        <Route path="/admin/solicitudes-ia" element={<AdminAiCallsPage />} />
        <Route path="/admin/marcador-general" element={<AdminAiOutboundPage />} />
        {/* Dental campaign retired: old dialer/test links redirect to the current dialer. */}
        <Route path="/admin/marcador-ia" element={<Navigate to="/admin/marcador-general" replace />} />
        <Route path="/admin/test" element={<Navigate to="/admin/marcador-general" replace />} />
        <Route path="/admin/dentistas" element={<DentalLeadsPage />} />
        <Route path="/admin/seguimientos" element={<AdminFollowupsPage />} />
        <Route path="/admin/material-comercial" element={<MaterialsPage />} />
        <Route path="/admin/integraciones" element={<AdminIntegrationsPage />} />
        <Route path="/admin/registro" element={<AdminAuditPage />} />
        <Route path="/admin/configuracion" element={<AdminSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
