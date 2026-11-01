import { PageHeader } from '@/components/ui/PageHeader';
import { DemoDataNote } from '@/components/ui/DemoDataNote';
import { MaterialLibrary } from '@/features/sales-materials/components/MaterialLibrary';

export function MaterialsPage() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Material comercial"
        description="Presentaciones, videos, demostraciones y plantillas aprobadas para tus ventas."
        actions={<DemoDataNote />}
      />
      <MaterialLibrary />
    </div>
  );
}
