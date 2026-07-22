export const MOBILE_PORTRAIT_LAYOUT_WIDTH = 390;

interface ViewportCompatibilityInput {
  width: number;
  height: number;
  coarsePointer: boolean;
  maxTouchPoints: number;
}

export function mobileViewportCompatibilityScale({
  width,
  height,
  coarsePointer,
  maxTouchPoints,
}: ViewportCompatibilityInput): number | null {
  const touchDevice = coarsePointer || maxTouchPoints > 0;
  const desktopCompatibilityViewport = width > 900;
  if (!touchDevice || height <= width || !desktopCompatibilityViewport)
    return null;
  return width / MOBILE_PORTRAIT_LAYOUT_WIDTH;
}

export function setupMobileViewportCompatibility(): void {
  const root = document.documentElement;
  const portraitQuery = window.matchMedia("(orientation: portrait)");
  const coarsePointerQuery = window.matchMedia("(pointer: coarse)");

  const sync = (): void => {
    const scale = mobileViewportCompatibilityScale({
      width: window.innerWidth,
      height: portraitQuery.matches
        ? Math.max(window.innerHeight, window.innerWidth + 1)
        : window.innerHeight,
      coarsePointer: coarsePointerQuery.matches,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    root.classList.toggle("mobile-viewport-compat", scale !== null);
    if (scale === null) root.style.removeProperty("--app-viewport-zoom");
    else root.style.setProperty("--app-viewport-zoom", String(scale));
  };

  sync();
  window.addEventListener("orientationchange", () =>
    window.requestAnimationFrame(sync),
  );
  portraitQuery.addEventListener("change", sync);
}
