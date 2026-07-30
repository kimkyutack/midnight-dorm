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

