import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Dialog } from '@/components/ui/Dialog';

// Same shape as the "Crear muestra web" form: parent state per keystroke and an inline
// onClose, which is a new function on every render.
function Form({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Dialog open title="Crear muestra web" onClose={() => onClose()}>
      <label>
        Nombre del negocio
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
    </Dialog>
  );
}

test('typing a whole word keeps focus in the field; Escape still closes', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Form onClose={onClose} />);
  const field = screen.getByLabelText<HTMLInputElement>('Nombre del negocio');

  await user.click(field);
  await user.keyboard('Taller M y M');

  expect(field.value).toBe('Taller M y M');
  expect(document.activeElement).toBe(field);
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
});
