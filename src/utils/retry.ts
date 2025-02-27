const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_RETRY_SLEEP_MS = 10000;
const DEFAULT_MAX_RETRY_ATTEMPTS = 3;

// calls processor function on each item of items, in parallel, up to batchSize items at a time
export async function processQueue<T, S>(
  items: T[],
  processor: (item: T) => Promise<S>,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<S[]> {
  console.log(`Processing queue with ${items.length} items`);
  const queue = [...items];
  const inProgress = new Map<Promise<S>, number>();
  const results: S[] = new Array(items.length);
  let nextIndex = 0;

  while (queue.length > 0 || inProgress.size > 0) {
    while (inProgress.size < batchSize && queue.length > 0) {
      const item = queue.shift()!;
      const index = nextIndex++;
      const promise = processor(item).then((result) => {
        results[index] = result;
        inProgress.delete(promise);
        return result;
      });
      inProgress.set(promise, index);
    }
    if (inProgress.size > 0) {
      await Promise.race(inProgress.keys());
    }
  }

  return results;
}

// Helper function to implement retry logic
export async function withRetry<T>(
  operation: () => Promise<T>,
  caption: string = "operation",
  maxAttempts: number = DEFAULT_MAX_RETRY_ATTEMPTS,
  delayMs: number = DEFAULT_RETRY_SLEEP_MS,
  jitter: number = 0,
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Trying ${caption} ... (attempt ${attempt}/${maxAttempts})`);
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const jitterOffset = jitter * (Math.random() * 2 - 1); // Value between -jitter and +jitter
        const actualDelay = Math.floor(delayMs * (1 + jitterOffset));

        console.log(`${caption} failed, retrying in ${actualDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, actualDelay));
      }
    }
  }
  throw lastError;
}
