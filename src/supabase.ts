import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
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
  driver?: string | null;
  driver_phone?: string | null;
  gate1_at?: string | null;
  gate1_by?: string | null;
  gate2_at?: string | null;
  gate2_by?: string | null;
  pcs?: number | null;
  created_at?: string;
  owner_id?: string | null;
  owner_name?: string | null;
}

export function getEmailPrefix(email?: string | null): string {
  if (!email) return '';
  return email.split('@')[0];
}
