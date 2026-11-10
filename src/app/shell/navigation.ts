export interface NavItem {
  to: string;
  label: string;
}

export const AGENT_HOME = '/clientes';
export const ADMIN_HOME = '/admin/resumen';

export const AGENT_NAV_ITEMS: NavItem[] = [
  { to: '/clientes', label: 'Clientes' },
  { to: '/seguimientos', label: 'Seguimientos' },
  { to: '/material-comercial', label: 'Material' },
];

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { to: '/admin/resumen', label: 'Resumen' },
  { to: '/admin/agentes', label: 'Agentes' },
  { to: '/admin/prospectos', label: 'Prospectos' },
  { to: '/admin/asignaciones', label: 'Asignaciones' },
  { to: '/admin/solicitudes-ia', label: 'Solicitudes IA' },
  { to: '/admin/marcador-ia', label: 'Marcador IA' },
  { to: '/admin/seguimientos', label: 'Seguimientos' },
  { to: '/admin/material-comercial', label: 'Material comercial' },
  { to: '/admin/integraciones', label: 'Integraciones' },
  { to: '/admin/configuracion', label: 'Configuración' },
];
