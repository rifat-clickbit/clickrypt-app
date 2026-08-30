import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Configure foreground notification presentation safely
try {
  if (!isExpoGo) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
} catch {
  // safe fallback
}

const NOTIFICATIONS_ENABLED_KEY = 'clickrypt_push_notifications_enabled';

export async function requestNotificationPermissions(): Promise<boolean> {
  if (isExpoGo) return false;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    const isGranted = finalStatus === 'granted';
    await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, isGranted ? 'true' : 'false');
    return isGranted;
  } catch {
    return false;
  }
}

export async function getNotificationPreference(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export async function setNotificationPreference(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, enabled ? 'true' : 'false');
    if (enabled && !isExpoGo) {
      await requestNotificationPermissions();
    }
  } catch {
    // ignore
  }
}

/**
 * Send an immediate local security alert notification
 */
export async function sendSecurityAlert({
  title,
  body,
}: {
  title: string;
  body: string;
}): Promise<void> {
  if (isExpoGo) return;
  const isEnabled = await getNotificationPreference();
  if (!isEnabled) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🛡️ ${title}`,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null,
    });
  } catch {
    // ignore
  }
}
