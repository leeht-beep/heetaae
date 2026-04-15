interface MemoryCacheEntry<T> {
  expiresAt: number;
  value: T;
}

const memoryCache = new Map<string, MemoryCacheEntry<unknown>>();

export async function withMemoryCache<T>(
  key: string,
  ttlMs: number,
  task: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean }> {
  const now = Date.now();
  const cached = memoryCache.get(key) as MemoryCacheEntry<T> | undefined;

  if (cached && cached.expiresAt > now) {
    return {
      value: cached.value,
      cacheHit: true,
    };
  }

  const value = await task();
  memoryCache.set(key, {
    value,
    expiresAt: now + ttlMs,
  });

  return {
    value,
    cacheHit: false,
  };
}

export async function retryTask<T>(
  task: () => Promise<T>,
  options: {
    retries: number;
    delayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  },
): Promise<{ value: T; retryCount: number }> {
  let retryCount = 0;

  while (true) {
    try {
      return {
        value: await task(),
        retryCount,
      };
    } catch (error) {
      const shouldRetry = options.shouldRetry ? options.shouldRetry(error) : true;

      if (!shouldRetry || retryCount >= options.retries) {
        throw error;
      }

      retryCount += 1;

      if (options.delayMs && options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
    }
  }
}

export function dedupeByKey<T>(
  items: T[],
  getKey: (item: T) => string | undefined,
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  items.forEach((item) => {
    const key = getKey(item);

    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    deduped.push(item);
  });

  return deduped;
}
