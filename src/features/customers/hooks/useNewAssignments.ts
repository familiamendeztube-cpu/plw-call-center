import { useEffect, useRef, useState } from 'react';

export function useNewAssignments(assignedIds: string[] | null) {
  const seenIds = useRef<Set<string> | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!assignedIds) return;
    if (seenIds.current === null) {
      seenIds.current = new Set(assignedIds);
      return;
    }
    const added = assignedIds.filter((id) => !seenIds.current?.has(id));
    if (added.length === 0) return;
    added.forEach((id) => seenIds.current?.add(id));
    setCount((current) => current + added.length);
  }, [assignedIds]);

  return { count, dismiss: () => setCount(0) };
}
