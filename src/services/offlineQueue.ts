import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabaseClient';

export interface QueuedMutation {
  id: string;
  action: 'UPSERT_RESOURCE' | 'DELETE_RESOURCE' | 'UPSERT_FOLDER' | 'DELETE_FOLDER';
  table: string;
  recordId: string;
  data?: any;
  timestamp: number;
}

const QUEUE_KEY = 'clickrypt_offline_mutation_queue';

export async function getQueuedMutations(): Promise<QueuedMutation[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function queueMutation(mutation: Omit<QueuedMutation, 'id' | 'timestamp'>): Promise<void> {
  try {
    const queue = await getQueuedMutations();
    const item: QueuedMutation = {
      ...mutation,
      id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
    };
    queue.push(item);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

export async function processOfflineQueue(onSyncComplete?: () => void): Promise<{ processed: number; failed: number }> {
  const queue = await getQueuedMutations();
  if (queue.length === 0) return { processed: 0, failed: 0 };

  const remaining: QueuedMutation[] = [];
  let processed = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      if (item.action === 'UPSERT_RESOURCE' || item.action === 'UPSERT_FOLDER') {
        const { error } = await supabase.from(item.table).upsert({
          id: item.recordId,
          mode: item.data?.mode || 'personal',
          data: item.data,
        });
        if (error) throw error;
        processed++;
      } else if (item.action === 'DELETE_RESOURCE' || item.action === 'DELETE_FOLDER') {
        const { error } = await supabase.from(item.table).delete().eq('id', item.recordId);
        if (error) throw error;
        processed++;
      }
    } catch {
      failed++;
      remaining.push(item);
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  if (processed > 0 && onSyncComplete) {
    onSyncComplete();
  }

  return { processed, failed };
}

export function setupOfflineAutoSync(onSyncComplete?: () => void): () => void {
  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable) {
      processOfflineQueue(onSyncComplete);
    }
  });

  return unsubscribe;
}
