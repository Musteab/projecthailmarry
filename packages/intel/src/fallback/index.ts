/** One total deadline covers retries, cache reads and provider calls. The provider is aborted. */
export async function withFallback<T>(
  work: (signal: AbortSignal) => Promise<T>,
  fallback: () => T,
  timeoutMs = 3500,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fallbackValue = () => fallback();
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => work(controller.signal))
        .catch(fallbackValue),
      new Promise<T>((resolve) => {
        timer = setTimeout(
          () => {
            controller.abort();
            resolve(fallbackValue());
          },
          Math.max(1, Math.min(3500, timeoutMs)),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
