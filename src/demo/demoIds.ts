let sequence = 0;

export function createDemoId(prefix: string): string {
  sequence += 1;
  return `${prefix}-demo-${Date.now().toString(36)}-${sequence}`;
}

export function simulateLatency(milliseconds = 180): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
