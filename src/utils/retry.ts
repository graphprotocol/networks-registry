const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_RETRY_SLEEP_MS = 10000;
const DEFAULT_MAX_RETRY_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

// Error carrying a server-requested wait (HTTP 429 + Retry-After). withRetry waits at
// least that long before the next attempt.
export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

// Parses a Retry-After header (delta-seconds or HTTP date) into milliseconds.
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

// Spaces out start times of requests that share a key (e.g. one rate-limited backend
// behind many hostnames), so parallel workers don't hit it in a single burst.
const nextSlot = new Map<string, number>();
export async function throttle(
  key: string,
  minIntervalMs: number,
): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(key) ?? 0);
  nextSlot.set(key, slot + minIntervalMs);
  if (slot > now) await sleep(slot - now);
}

// Pushes back every pending request for a key, e.g. after a 429 with Retry-After, so
// all workers sharing the backend wait instead of only the one that was told to.
export function holdOff(key: string, ms: number): void {
  nextSlot.set(key, Math.max(nextSlot.get(key) ?? 0, Date.now() + ms));
}

// Helper function to implement retry logic.
// Delay before attempt n+1 is delayMs * backoff^(n-1), randomised by ±jitter, and never
// shorter than a RateLimitError's retryAfterMs.
export async function withRetry<T>(
  operation: () => Promise<T>,
  caption: string = "operation",
  maxAttempts: number = DEFAULT_MAX_RETRY_ATTEMPTS,
  delayMs: number = DEFAULT_RETRY_SLEEP_MS,
  jitter: number = 0,
  backoff: number = 1,
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Trying ${caption} ... (attempt ${attempt}/${maxAttempts})`);
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const base = delayMs * Math.pow(backoff, attempt - 1);
        const jitterOffset = jitter * (Math.random() * 2 - 1); // Value between -jitter and +jitter
        let actualDelay = Math.floor(base * (1 + jitterOffset));
        if (
          error instanceof RateLimitError &&
          error.retryAfterMs !== undefined
        ) {
          actualDelay = Math.max(actualDelay, Math.ceil(error.retryAfterMs));
        }
        const reason = error instanceof Error ? error.message : String(error);
        console.log(
          `${caption} failed (${reason}), retrying in ${actualDelay}ms...`,
        );
        await sleep(actualDelay);
      }
    }
  }
  throw lastError;
}
