import { useCallback, useEffect, useState, type DependencyList } from 'react';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

const DEFAULT_ERROR = 'No se pudo cargar la información. Intenta de nuevo.';

export function replaceReadyData<T>(state: AsyncState<T>, data: T): AsyncState<T> {
  return state.status === 'ready' ? { status: 'ready', data } : state;
}

export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    load()
      .then((data) => {
        if (active) {
          setState({ status: 'ready', data });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : DEFAULT_ERROR;
          setState({ status: 'error', message });
        }
      });
    return () => {
      active = false;
    };
    // The caller owns the dependency list; `load` is intentionally recreated per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  const updateData = useCallback((updater: (data: T) => T) => {
    setState((current) =>
      current.status === 'ready' ? replaceReadyData(current, updater(current.data)) : current
    );
  }, []);

  return { state, reload, updateData };
}
