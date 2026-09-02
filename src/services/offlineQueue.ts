import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabaseClient';

export interface QueuedMutation {
  id: string;
  action: 'UPSERT_RESOURCE' | 'DELETE_RESOURCE' | 'UPSERT_FOLDER' | 'DELETE_FOLDER';
  table: string;
  recordId: string;
  data?: any;
  columns?: any;
  timestamp: number;
  attempts?: number;
}

const QUEUE_KEY = 'clickrypt_offline_mutation_queue';
const MAX_ATTEMPTS = 5;

// Module-level concurrency guard: prevents two overlapping flushes from
// interleaving and double-processing the same items.
let isProcessing = false;

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
      attempts: 0,
    };
    queue.push(item);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

export async function processOfflineQueue(onSyncComplete?: () => void): Promise<{ processed: number; failed: number }> {
  // Concurrency guard: if a flush is already running, skip this call.
  // Two overlapping flushes would interleave and double-process items.
  if (isProcessing) return { processed: 0, failed: 0 };
  isProcessing = true;

  try {
    const queue = await getQueuedMutations();
    if (queue.length === 0) return { processed: 0, failed: 0 };

    const processedIds = new Set<string>();
    const droppedIds = new Set<string>();
    let processed = 0;
    let failed = 0;

    for (const item of queue) {
      try {
        if (item.action === 'UPSERT_RESOURCE' || item.action === 'UPSERT_FOLDER') {
          const { error } = await supabase.from(item.table).upsert({
            id: item.recordId,
            mode: item.data?.mode || 'personal',
            ...item.columns,
            data: item.data,
          });
          if (error) throw error;
          processed++;
          processedIds.add(item.id);
        } else if (item.action === 'DELETE_RESOURCE' || item.action === 'DELETE_FOLDER') {
          const { error } = await supabase.from(item.table).delete().eq('id', item.recordId);
          if (error) throw error;
          processed++;
          processedIds.add(item.id);
        }
      } catch {
        failed++;
        const attempts = (item.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Drop permanently failed items so they don't retry forever and
          // block the rest of the queue.
          droppedIds.add(item.id);
        } else {
          // Will be kept in the re-read queue below with incremented attempts.
          // (We don't update in-place here; we re-read and patch.)
        }
      }
    }

    // Safe write-back: re-read the queue (in case new mutations were added
    // during the flush), then filter out processed + dropped items and bump
    // attempts on the rest. This fixes the lost-mutation race where a blind
    // setItem(remaining) would overwrite items queued mid-flush.
    const freshQueue = await getQueuedMutations();
    const remaining = freshQueue
      .filter((item) => !processedIds.has(item.id) && !droppedIds.has(item.id))
      .map((item) => {
        // If this item was in the original queue and failed (not processed,
        // not dropped), increment its attempt counter.
        const wasInOriginal = queue.some((q) => q.id === item.id);
        if (wasInOriginal && !processedIds.has(item.id)) {
          return { ...item, attempts: (item.attempts || 0) + 1 };
        }
        return item;
      });

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    if (processed > 0 && onSyncComplete) {
      onSyncComplete();
    }

    return { processed, failed };
  } finally {
    isProcessing = false;
  }
}

export function setupOfflineAutoSync(onSyncComplete?: () => void): () => void {
  const unsubscribe = NetInfo.addEventListener((state) => {
    // Relax the condition: isInternetReachable is often null on Android,
    // which would block auto-flush even when connected. Only block when
    // it's explicitly false.
    if (state.isConnected && state.isInternetReachable !== false) {
      processOfflineQueue(onSyncComplete);
    }
  });

  return unsubscribe;
}
