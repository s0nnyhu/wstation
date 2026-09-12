const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithBackoff(
  url: string,
  init: RequestInit = {},
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Upstream request failed");
}

/**
 * Hard budget for a whole source (all retries included). Resolves with
 * `fallback(error)` when the budget is exceeded so one slow upstream cannot
 * hold the page render hostage.
 */
export async function withBudget<T>(
  promise: Promise<T>,
  budgetMs: number,
  fallback: (error: Error) => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(
      () => resolve(fallback(new Error(`Timed out after ${budgetMs} ms`))),
      budgetMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
