/**
 * Creates the client on first use and retries on the next call if that failed, so an expired
 * credential is reported as a failed cycle instead of taking the service down.
 */
export function lazy<T>(create: () => Promise<T>): () => Promise<T> {
  let client: Promise<T> | undefined;
  return () => {
    client ??= create().catch((error: unknown) => {
      client = undefined;
      throw error;
    });
    return client;
  };
}
