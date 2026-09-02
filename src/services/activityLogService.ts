/* eslint-disable @typescript-eslint/no-explicit-any */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';
import { withTimeout } from '../utils/withTimeout';

export type ActivityCategory =
  | 'auth'
  | 'vault'
  | 'security'
  | 'share'
  | 'folder'
  | 'profile';

export interface ActivityLogItem {
  id: string;
  userId?: string;
  email?: string;
  title: string;
  message: string;
  category: ActivityCategory;
  mode?: 'personal' | 'organization';
  timestamp: string; // ISO string
  isRead?: boolean;
}

const STORAGE_PREFIX = 'clickrypt_activity_logs_';

/**
 * Fetch all activity logs for a user ID
 */
export const getActivityLogs = async (
  userId?: string,
  email?: string
): Promise<ActivityLogItem[]> => {
  const identifier = userId || (email ? email.trim().toLowerCase() : 'default');
  const key = `${STORAGE_PREFIX}${identifier}`;
  try {
    // 1. Try fetching from cached edge function
    const { data: sessionData } = await withTimeout(
      supabase.auth.getSession(),
      10000,
      'getActivityLogs getSession'
    );
    if (sessionData.session?.user) {
      const { data, error } = await withTimeout(
        supabase.functions.invoke('activity-log-cache', {
          body: {},
        }),
        10000,
        'getActivityLogs activity-log-cache'
      );
      if (!error && data?.logs) {
        const logs = data.logs as ActivityLogItem[];
        await AsyncStorage.setItem(key, JSON.stringify(logs));
        return logs;
      }
    }

    // 2. Try fetching from Supabase directly
    if (userId) {
      const { data: dbLogs } = await withTimeout(
        supabase
          .from('activity_logs')
          .select('*')
          .eq('user_id', userId)
          .order('timestamp', { ascending: false })
          .limit(50),
        10000,
        'getActivityLogs direct query'
      );

      if (dbLogs && dbLogs.length > 0) {
        const formatted: ActivityLogItem[] = dbLogs.map((l: any) => ({
          id: l.id,
          userId: l.user_id,
          email: l.email_snapshot,
          title: l.title,
          message: l.message,
          category: l.category as ActivityCategory,
          mode: l.mode as 'personal' | 'organization',
          timestamp: l.timestamp,
          isRead: true,
        }));
        await AsyncStorage.setItem(key, JSON.stringify(formatted));
        return formatted;
      }
    }

    // 3. Try fetching from local cache
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed: ActivityLogItem[] = JSON.parse(raw);
      return parsed.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    }
    return [];
  } catch {
    return [];
  }
};

/**
 * Log a new activity notification
 */
export const logActivity = async (
  userId: string | undefined,
  email: string | undefined,
  title: string,
  message: string,
  category: ActivityCategory,
  mode: 'personal' | 'organization' = 'personal'
): Promise<ActivityLogItem> => {
  const identifier = userId || (email ? email.trim().toLowerCase() : 'default');
  const key = `${STORAGE_PREFIX}${identifier}`;
  const newItem: ActivityLogItem = {
    id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId,
    email,
    title,
    message,
    category,
    mode,
    timestamp: new Date().toISOString(),
    isRead: false,
  };

  try {
    const raw = await AsyncStorage.getItem(key);
    const current: ActivityLogItem[] = raw ? JSON.parse(raw) : [];
    const updated = [newItem, ...current].slice(0, 100);
    await AsyncStorage.setItem(key, JSON.stringify(updated));

    // Background sync to Supabase activity_logs table
    if (userId) {
      Promise.resolve(
        supabase.from('activity_logs').insert({
          id: newItem.id,
          user_id: userId,
          email_snapshot: email,
          title,
          message,
          category,
          mode,
          timestamp: newItem.timestamp,
        })
      ).catch(() => {});
    }
  } catch {
    // ignore
  }

  return newItem;
};

/**
 * Clear all activity logs
 */
export const clearActivityLogs = async (userId?: string, email?: string): Promise<void> => {
  const identifier = userId || (email ? email.trim().toLowerCase() : 'default');
  const key = `${STORAGE_PREFIX}${identifier}`;
  try {
    await AsyncStorage.setItem(key, JSON.stringify([]));
    if (userId) {
      await supabase.from('activity_logs').delete().eq('user_id', userId);
      await supabase.functions
        .invoke('activity-log-cache-invalidate', { body: {} })
        .catch(() => {});
    }
  } catch {
    // ignore
  }
};

/**
 * Mark all activities as read
 */
export const markAllAsRead = async (userId?: string, email?: string): Promise<void> => {
  const identifier = userId || (email ? email.trim().toLowerCase() : 'default');
  const key = `${STORAGE_PREFIX}${identifier}`;
  try {
    const current = await getActivityLogs(userId, email);
    const updated = current.map((item) => ({ ...item, isRead: true }));
    await AsyncStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // ignore
  }
};

/**
 * Get unread notifications count
 */
export const getUnreadCount = async (userId?: string, email?: string): Promise<number> => {
  try {
    const logs = await getActivityLogs(userId, email);
    return logs.filter((l) => !l.isRead).length;
  } catch {
    return 0;
  }
};

/**
 * Subscribe to realtime activity logs changes
 */
export const subscribeToActivityLogs = (
  userId: string | undefined,
  onUpdate: () => void
): (() => void) => {
  const channelName = `activity_logs_realtime_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'activity_logs',
        ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
      },
      () => {
        onUpdate();
      }
    )
    .subscribe();

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      // ignore
    }
  };
};

