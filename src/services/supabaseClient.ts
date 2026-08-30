import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wnhqpfcahtelehdxnwod.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduaHFwZmNhaHRlbGVoZHhud29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTM4MjcsImV4cCI6MjEwMTk2OTgyN30.ixIO1XYcmvo1-5rlVVIzQBezFahKnDtuzeJWY5mAIUY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
