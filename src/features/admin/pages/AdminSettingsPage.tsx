import { IS_DEMO_MODE } from '@/app/appConfig';
import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { Panel } from '@/components/ui/Panel';

const SETTINGS_ROWS = [
  { label: 'Zona horaria', value: 'America/Costa_Rica (UTC-06:00)' },
  {
    label: 'Modo de acceso',
    value: IS_DEMO_MODE ? 'Modo demostración con datos ficticios' : 'Autenticación real',
  },
  { label: 'Precios y servicios', value: 'Pendiente de configuración por el administrador' },
  { label: 'Plantillas de correo', value: 'Pendiente de aprobación' },
  { label: 'Límite de carga predeterminado', value: 'Sin configurar' },
];

export function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Configuración"
        description="Parámetros generales de PLW Call Center."
        actions={<DemoDataNote />}
      />
      <Panel as="section" className="p-6">
        <dl className="divide-y divide-neutral-200">
          {SETTINGS_ROWS.map((row) => (
            <div
              key={row.label}
              className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <dt className="text-sm font-medium text-neutral-700">{row.label}</dt>
              <dd className="text-sm text-plw-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
