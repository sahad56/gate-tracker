-- ===================================================
-- GATE TRACKER - SUPABASE DATABASE SETUP SCRIPT
-- Paste this into your Supabase Dashboard -> SQL Editor and click "Run"
-- ===================================================

-- 1. Create the trucks table
CREATE TABLE IF NOT EXISTS public.trucks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,
    plate VARCHAR(25) NOT NULL,
    country VARCHAR(10) NOT NULL CHECK (country IN ('OMN', 'DXB')),
    driver VARCHAR(255),
    gate1_at TIMESTAMPTZ,
    gate1_by VARCHAR(50),
    gate2_at TIMESTAMPTZ,
    gate2_by VARCHAR(50),
    pcs SMALLINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (work_date, plate, country)
);

-- 2. Fast search indexes
CREATE INDEX IF NOT EXISTS idx_trucks_work_date ON public.trucks(work_date);
CREATE INDEX IF NOT EXISTS idx_trucks_plate ON public.trucks(plate);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;

-- 4. Clean up any previous policies
DROP POLICY IF EXISTS "Allow anon read" ON public.trucks;
DROP POLICY IF EXISTS "Allow anon insert" ON public.trucks;
DROP POLICY IF EXISTS "Allow anon update" ON public.trucks;
DROP POLICY IF EXISTS "Allow anon delete" ON public.trucks;

-- 5. Allow worker app full read/write access
CREATE POLICY "Allow anon read" ON public.trucks FOR SELECT USING (true);
CREATE POLICY "Allow anon insert" ON public.trucks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.trucks FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete" ON public.trucks FOR DELETE USING (true);

-- 6. Enable Realtime live sync across all worker phones
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'trucks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trucks;
  END IF;
END $$;

-- 7. Confirm success
SELECT 'Gate Tracker table created successfully!' AS result;
