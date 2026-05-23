export type InstallPlatform =
  | "ios-safari"   // iOS + native Safari → A2HS via Share sheet
  | "ios-other"    // iOS + Chrome/Firefox/etc → must open Safari first
  | "android"      // Android (any browser)
  | "desktop"      // Desktop Chrome/Edge/etc
  | "unknown";     // SSR placeholder or unrecognised

export function detectPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;

  const isIOS =
    /iphone|ipad|ipod/i.test(ua) &&
    !(window as Window & { MSStream?: unknown }).MSStream;

  if (isIOS) {
    // Chrome on iOS: CriOS; Firefox: FxiOS; Opera: OPiOS; Edge: EdgiOS
    return /CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua) ? "ios-other" : "ios-safari";
  }

  if (/android/i.test(ua)) return "android";

  return "desktop";
}
