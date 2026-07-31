import { initializeAdMob } from './admob';
import { initializeGoogleSignIn } from './googleAuth';
import { installNativeFetchBridge, isNativeApp } from './runtime';

export function initializeNativeRuntime(): void {
  if (!isNativeApp) return;
  installNativeFetchBridge();
  void initializeGoogleSignIn().catch((error) => console.warn('Google Sign-In initialization failed', error));
  void initializeAdMob().catch((error) => console.warn('AdMob initialization failed', error));
}

export { isNativeApp } from './runtime';
