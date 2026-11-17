import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { requestCallAudioDownloadUrl, type CallAudioTarget } from '../hooks/useAiCalls';

/** Administrator's link to the full original recording: a short-lived signed URL that the
 *  browser's own download menu can fetch (unlike the blob: URL of the in-page player). */
export function CallAudioDownload({ target }: { target: CallAudioTarget }) {
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'busy' } | { status: 'ready'; url: string } | { status: 'error'; message: string }
  >({ status: 'idle' });

  async function request() {
    setState({ status: 'busy' });
    try {
      setState({ status: 'ready', url: await requestCallAudioDownloadUrl(target) });
    } catch (cause) {
      setState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo preparar la descarga.',
      });
    }
  }

  if (state.status === 'ready') {
    return (
      <a
        href={state.url}
        download
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-plw-ink hover:bg-neutral-50"
      >
        <Download size={14} aria-hidden="true" />
        Descargar audio original (enlace válido 10 min)
      </a>
    );
  }
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={state.status === 'busy'}
        onClick={() => void request()}
      >
        <Download size={14} aria-hidden="true" />
        {state.status === 'busy' ? 'Preparando descarga…' : 'Descargar audio original'}
      </Button>
      {state.status === 'error' ? (
        <p role="alert" className="w-full text-sm text-danger-700">
          {state.message}
        </p>
      ) : null}
    </>
  );
}
