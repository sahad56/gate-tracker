import { createClient } from '@supabase/supabase-js';

// Hardcoded live Supabase credentials so workers NEVER have to enter keys
const DEFAULT_URL = 'https://qztvlvkrxchqrfwdebij.supabase.co';
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dHZsdmtyeGNocXJmd2RlYmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwMzMxNjcsImV4cCI6MjEwOTYwOTE2N30.Se3ZmTFryS4RC9U6q3I7bRwypUmN87xRw12t3b6MApE';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY;

export const isSupabaseConfigured = true;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export interface TruckItem {
  id: string;
  work_date: string;
  plate: string;
  country: 'OMN' | 'DXB';
  driver?: string;
  gate1_at?: string | null;
  gate1_by?: string | null;
  gate2_at?: string | null;
  gate2_by?: string | null;
  pcs?: number | null;
  created_by?: string | null;
  created_at?: string;
}

export const WORKERS = [
  'worker1',
  'worker2',
  'worker3',
  'worker4',
  'worker5',
  'worker6',
];

export const WORKER_PASSWORD = 'worker123';
