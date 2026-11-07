# 🚚 Gate Tracker (Supabase + Vercel) Setup Guide

Live multi-worker tracking for Oman (OMN) & Dubai (DXB) trucks with:
- **6 Worker Accounts**: `worker1`, `worker2`, `worker3`, `worker4`, `worker5`, `worker6` (Password: `worker123` for everyone)
- **Gate 1 Tick**: Tapped by worker, saves instantly with worker name.
- **Gate 2 Tick (LOADED)**: Strictly locked until Gate 1 is ticked! Unticking Gate 1 resets Gate 2.
- **PC Counter**: Input pieces per truck (formatted as `07PC`, `14PC` in reports).
- **Copy Day Report**: Generates exact image 2 format for your boss in 1 tap.
- **Supabase Realtime**: Instant sync between all workers' phones simultaneously!
- **Minimal Theme**: Calculator-style black & white mobile UI.

---

## ⚡ Step 1: Run Locally Right Now
In your terminal:
```bash
cd c:\kenz\gate-tracker
npm run dev
```
Open the link (e.g. `http://localhost:5173`) in your browser or phone!
Select **worker1**, enter password **`worker123`** to test immediately.

---

## 🗄️ Step 2: Supabase Setup (Free - Takes 2 Minutes)
1. Go to [supabase.com](https://supabase.com) and create a free project.
2. In your Supabase project dashboard, open **SQL Editor** on the left menu.
3. Open the file `supabase_schema.sql` in this folder, copy all contents, paste it into the SQL editor, and click **Run**.
   - This creates the `trucks` table.
   - Sets up Row Level Security.
   - Enables **Realtime** sync so all 6 workers see updates instantly without refreshing.
4. Go to **Project Settings** (gear icon) -> **API**:
   - Copy **Project URL** (e.g. `https://xyz.supabase.co`)
   - Copy **anon public Key** (starts with `eyJ...`)

---

## 🚀 Step 3: Deploy to Vercel (Live Today!)

### Method A: Via Vercel Web (Easiest)
1. Push this folder to a GitHub repository:
   ```bash
   cd c:\kenz\gate-tracker
   git init
   git add .
   git commit -m "Gate Tracker initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/gate-tracker.git
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com), log in, and click **"Add New" -> "Project"**.
3. Import your `gate-tracker` GitHub repo.
4. In **Environment Variables**, add:
   - `VITE_SUPABASE_URL`: Your Supabase URL
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anon key
   - *(Optional)* `VITE_GEMINI_API_KEY`: Free Gemini key if you want photo AI reading
5. Click **Deploy**! In 30 seconds, your website is LIVE with a free `.vercel.app` link.

### Method B: Via Vercel CLI (Direct from terminal)
```bash
cd c:\kenz\gate-tracker
npx vercel
```
Follow prompts and enter your credentials.

---

## 📱 How Your 6 Workers Use It
1. Send the live Vercel link to your workers: `https://your-gate-tracker.vercel.app`
2. Each worker opens the link on their phone and selects their ID:
   - **Worker 1**: `worker1` (Pass: `worker123`)
   - **Worker 2**: `worker2` (Pass: `worker123`)
   - **Worker 3**: `worker3` (Pass: `worker123`)
   - **Worker 4**: `worker4` (Pass: `worker123`)
   - **Worker 5**: `worker5` (Pass: `worker123`)
   - **Worker 6**: `worker6` (Pass: `worker123`)
3. **When a truck arrives at Gate 1**: Worker taps `Gate 1`. The button turns blue with `✓ Gate 1 (worker1)`.
4. **When truck reaches Gate 2 (loading place)**: `Gate 2` is now unlocked. Worker taps `Gate 2 · LOADED`. It turns emerald green with `✓ Gate 2 · LOADED (worker2)`.
5. **Type Pieces (PC)**: Enter e.g. `7` or `14` in the PC box.
6. **End of Day Report for Boss**: Tap the large bottom button **"Copy Day Report"**.
   Clipboard will have:
   ```
   03-11-2026

   KIZAD-CC

   3187YB.  OMN-07PC
   39263.  DXB-07PC

   LOADED
   ```
   Paste straight into WhatsApp or SMS to your boss!
