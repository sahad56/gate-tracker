import { createClient } from '@supabase/supabase-js';

// Default demo keys or environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('gt_supabase_url') || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('gt_supabase_anon_key') || '';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured 
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

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
