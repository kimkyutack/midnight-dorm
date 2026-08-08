export function buildForceRefreshUrl(
  currentHref: string,
  version: string,
  nonce: string,
): string {
  const next = new URL(currentHref);
  next.searchParams.set("app-update", version);
  // A deployment-independent nonce is essential on iOS standalone PWAs:
  // reopening the same URL can reuse WebKit's HTTP response cache even after
  // Cache Storage and the Service Worker registration were removed.
  next.searchParams.set("force-refresh", nonce);
  return next.toString();
}

/**
 * Vite content-hashes lazy chunks. An already-open client can therefore ask a
 * new deployment for a chunk that no longer exists. Browsers and WebViews use
 * slightly different messages for the same failure, so keep the recognition
 * in one tested helper instead of keying recovery to one browser string.
 */
export function isStaleDynamicImportError(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === 'string'
      ? error
      : '';
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload (?:css|module)|unexpected token ['"]?</i.test(message);
}
