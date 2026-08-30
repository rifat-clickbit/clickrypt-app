import * as ScreenCapture from 'expo-screen-capture';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'clickrypt_screen_capture_protection';

export async function setScreenProtection(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    if (enabled) {
      await ScreenCapture.preventScreenCaptureAsync();
    } else {
      await ScreenCapture.allowScreenCaptureAsync();
    }
  } catch {
    // ignore
  }
}

export async function getScreenProtectionState(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY);
    return val === null ? true : val === 'true'; // Enabled by default for max security
  } catch {
    return true;
  }
}

export async function initScreenProtection(): Promise<void> {
  const isEnabled = await getScreenProtectionState();
  if (isEnabled) {
    await ScreenCapture.preventScreenCaptureAsync().catch(() => {});
  }
}
