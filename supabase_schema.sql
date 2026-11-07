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

-- 2. Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_trucks_work_date ON public.trucks(work_date);
CREATE INDEX IF NOT EXISTS idx_trucks_plate ON public.trucks(plate);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;

-- 4. Allow public / anon read, insert, update, delete for worker app
CREATE POLICY "Allow anon read" ON public.trucks 
    FOR SELECT USING (true);

CREATE POLICY "Allow anon insert" ON public.trucks 
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anon update" ON public.trucks 
    FOR UPDATE USING (true);

CREATE POLICY "Allow anon delete" ON public.trucks 
    FOR DELETE USING (true);

-- 5. Enable Realtime updates across all worker phones!
ALTER PUBLICATION supabase_realtime ADD TABLE public.trucks;

-- Verify setup
SELECT 'Gate Tracker database setup complete! All 6 workers can sync in real time.' AS status;
