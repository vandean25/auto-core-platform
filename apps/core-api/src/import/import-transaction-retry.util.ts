export function retryableTransactionDelayMs(attempt: number): number {
  const cappedBase = Math.min(50 * 2 ** attempt, 2000);
  const jitter = Math.floor(Math.random() * cappedBase * 0.25);
  return cappedBase + jitter;
}

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
