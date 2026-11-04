import { expect, test } from 'vitest';
import { toAssignmentHistoryEntry } from '@/production/adapters/productionMappers';

// assignment_history.id is a bigint; PostgREST sends it as a number. This used to
// throw "el campo id no es texto" and blank the whole Asignaciones page.
test('reads an assignment history row whose id arrives as a number', () => {
  const entry = toAssignmentHistoryEntry({
    id: 7,
    prospect_id: 'p-1',
    from_owner_id: null,
    to_owner_id: 'agent-1',
    mechanism: 'round_robin',
    reason: '',
    created_at: '2026-11-04T15:00:00Z',
  });
  expect(entry.id).toBe('7');
  expect(() => toAssignmentHistoryEntry({ id: null })).toThrow();
});
