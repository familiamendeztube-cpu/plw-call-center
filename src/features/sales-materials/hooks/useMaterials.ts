import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';

export function useMaterials() {
  const { materials } = useAppServices();
  return useAsync(() => materials.listMaterials(), [materials]);
}
