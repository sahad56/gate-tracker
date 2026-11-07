import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Truck, Check, Lock, Copy, Plus, Upload, Search, Calendar, 
  LogOut, Settings, Database, X, User, AlertCircle
} from 'lucide-react';
import { supabase, isSupabaseConfigured, WORKERS, WORKER_PASSWORD } from './supabase';
import type { TruckItem } from './supabase';

export function App() {
  // 1. Worker Auth state
  const [currentWorker, setCurrentWorker] = useState<string | null>(() => {
    return localStorage.getItem('gt_current_worker');
  });
  const [loginWorker, setLoginWorker] = useState<string>('worker1');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');

  // 2. Data state
  const [date, setDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [trucks, setTrucks] = useState<TruckItem[]>([]);
  const [search, setSearch] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');

  // 3. UI modals
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // New truck form
  const [newPlate, setNewPlate] = useState<string>('');
  const [newCountry, setNewCountry] = useState<'OMN' | 'DXB'>('OMN');
  const [newDriver, setNewDriver] = useState<string>('');

  // Settings
  const [sbUrl, setSbUrl] = useState<string>(() => localStorage.getItem('gt_supabase_url') || '');
  const [sbKey, setSbKey] = useState<string>(() => localStorage.getItem('gt_supabase_anon_key') || '');
  const [geminiKey, setGeminiKey] = useState<string>(() => localStorage.getItem('gt_gemini_key') || '');

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadText, setUploadText] = useState<string>('');
  const [parsingImage, setParsingImage] = useState<boolean>(false);

  // Cross-tab broadcast for local simulation
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? '' : cur));
    }, 3000);
  };

  // Setup broadcast channel for offline / local sync between tabs
  useEffect(() => {
    try {
      const bc = new BroadcastChannel('gate_tracker_channel');
      bc.onmessage = (event) => {
        if (event.data?.type === 'TRUCKS_UPDATED') {
          loadTrucks();
        }
      };
      broadcastRef.current = bc;
      return () => bc.close();
    } catch {
      // BroadcastChannel unsupported
    }
  }, [date]);

  // Handle Login
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginPassword.trim() !== WORKER_PASSWORD) {
      setLoginError('Incorrect password! Default is worker123');
      return;
    }
    localStorage.setItem('gt_current_worker', loginWorker);
    setCurrentWorker(loginWorker);
    setLoginPassword('');
    setLoginError('');
    showToast(`Welcome, ${loginWorker}!`);
  };

  const handleLogout = () => {
    localStorage.removeItem('gt_current_worker');
    setCurrentWorker(null);
  };

  // Load trucks for the selected date
  const loadTrucks = async () => {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('trucks')
          .select('*')
          .eq('work_date', date)
          .order('created_at', { ascending: true });

        if (error) throw error;
        setTrucks(data || []);
      } catch (err: any) {
        console.error('Supabase fetch error:', err);
        showToast('Supabase sync error: ' + (err.message || 'Check credentials'));
      }
    } else {
      // Local storage fallback
      const saved = localStorage.getItem(`gt_trucks_${date}`);
      if (saved) {
        try {
          setTrucks(JSON.parse(saved));
        } catch {
          setTrucks([]);
        }
      } else {
        // Initial sample trucks if empty
        const initialSamples: TruckItem[] = [
          {
            id: 'demo-1',
            work_date: date,
            plate: '3187YB',
            country: 'OMN',
            driver: 'Salim Al-Harthy',
            gate1_at: new Date().toISOString(),
            gate1_by: 'worker1',
            gate2_at: new Date().toISOString(),
            gate2_by: 'worker2',
            pcs: 7,
          },
          {
            id: 'demo-2',
            work_date: date,
            plate: '39263',
            country: 'DXB',
            driver: 'Rashid Khan',
            gate1_at: new Date().toISOString(),
            gate1_by: 'worker1',
            gate2_at: new Date().toISOString(),
            gate2_by: 'worker3',
            pcs: 7,
          },
          {
            id: 'demo-3',
            work_date: date,
            plate: '81852',
            country: 'DXB',
            driver: 'Mohammed Tariq',
            gate1_at: new Date().toISOString(),
            gate1_by: 'worker2',
            gate2_at: null,
            gate2_by: null,
            pcs: 14,
          },
          {
            id: 'demo-4',
            work_date: date,
            plate: '745612',
            country: 'OMN',
            driver: 'Nasir Ahmed',
            gate1_at: null,
            gate1_by: null,
            gate2_at: null,
            gate2_by: null,
            pcs: null,
          }
        ];
        setTrucks(initialSamples);
        localStorage.setItem(`gt_trucks_${date}`, JSON.stringify(initialSamples));
      }
    }
  };

  useEffect(() => {
    loadTrucks();
  }, [date]);

  // Supabase Realtime subscription
  useEffect(() => {
    const client = supabase;
    if (!isSupabaseConfigured || !client) return;

    const channel = client
      .channel('public:trucks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trucks' },
        () => {
          loadTrucks();
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [date]);

  // Helper to persist truck updates
  const saveTruck = async (updated: TruckItem) => {
    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase
          .from('trucks')
          .update({
            gate1_at: updated.gate1_at,
            gate1_by: updated.gate1_by,
            gate2_at: updated.gate2_at,
            gate2_by: updated.gate2_by,
            pcs: updated.pcs,
          })
          .eq('id', updated.id);

        if (error) throw error;
      } catch (err: any) {
        showToast('Error saving: ' + err.message);
      }
    } else {
      const next = trucks.map((t) => (t.id === updated.id ? updated : t));
      setTrucks(next);
      localStorage.setItem(`gt_trucks_${date}`, JSON.stringify(next));
      broadcastRef.current?.postMessage({ type: 'TRUCKS_UPDATED' });
    }
  };

  // Toggle Gate 1
  const toggleGate1 = async (t: TruckItem) => {
    if (!currentWorker) return;
    const isChecked = Boolean(t.gate1_at);
    let updated: TruckItem;

    if (isChecked) {
      // Unticking Gate 1 resets both Gate 1 AND Gate 2!
      updated = {
        ...t,
        gate1_at: null,
        gate1_by: null,
        gate2_at: null,
        gate2_by: null,
      };
      showToast(`${t.plate}: Gate 1 cleared (Gate 2 reset)`);
    } else {
      updated = {
        ...t,
        gate1_at: new Date().toISOString(),
        gate1_by: currentWorker,
      };
      showToast(`${t.plate}: Gate 1 ticked by ${currentWorker}`);
    }

    setTrucks((prev) => prev.map((item) => (item.id === t.id ? updated : item)));
    await saveTruck(updated);
  };

  // Toggle Gate 2 (Loading place)
  const toggleGate2 = async (t: TruckItem) => {
    if (!currentWorker) return;
    
    // Check gate 1 rule
    if (!t.gate1_at) {
      showToast('⚠️ Must tick Gate 1 first before Gate 2!');
      return;
    }

    const isChecked = Boolean(t.gate2_at);
    let updated: TruckItem;

    if (isChecked) {
      updated = {
        ...t,
        gate2_at: null,
        gate2_by: null,
      };
      showToast(`${t.plate}: Gate 2 unticked`);
    } else {
      updated = {
        ...t,
        gate2_at: new Date().toISOString(),
        gate2_by: currentWorker,
      };
      showToast(`🚚 ${t.plate}: LOADED! (by ${currentWorker})`);
    }

    setTrucks((prev) => prev.map((item) => (item.id === t.id ? updated : item)));
    await saveTruck(updated);
  };

  // Update PC (Pieces)
  const handlePcsChange = async (t: TruckItem, val: string) => {
    const pcsVal = val === '' ? null : parseInt(val, 10);
    const updated = { ...t, pcs: isNaN(pcsVal as any) ? null : pcsVal };
    setTrucks((prev) => prev.map((item) => (item.id === t.id ? updated : item)));
    await saveTruck(updated);
  };

  // Add new truck manually
  const handleAddTruck = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPlate = newPlate.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!cleanPlate) {
      showToast('Please enter a valid plate number');
      return;
    }

    // Check duplicate plate for the day
    const exists = trucks.some(
      (t) => t.plate.toUpperCase() === cleanPlate && t.country === newCountry
    );
    if (exists) {
      showToast(`⚠️ Truck ${cleanPlate} (${newCountry}) is already in today's list!`);
      return;
    }

    const newTruckData: TruckItem = {
      id: isSupabaseConfigured ? (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}`) : `t-${Date.now()}`,
      work_date: date,
      plate: cleanPlate,
      country: newCountry,
      driver: newDriver.trim() || undefined,
      gate1_at: null,
      gate1_by: null,
      gate2_at: null,
      gate2_by: null,
      pcs: null,
    };

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from('trucks').insert([newTruckData]).select();
        if (error) throw error;
        if (data && data[0]) {
          setTrucks((prev) => [...prev, data[0]]);
        }
      } catch (err: any) {
        showToast('Error adding truck: ' + err.message);
        return;
      }
    } else {
      const next = [...trucks, newTruckData];
      setTrucks(next);
      localStorage.setItem(`gt_trucks_${date}`, JSON.stringify(next));
      broadcastRef.current?.postMessage({ type: 'TRUCKS_UPDATED' });
    }

    setNewPlate('');
    setNewDriver('');
    setShowAdd(false);
    showToast(`✓ Added ${cleanPlate} (${newCountry})`);
  };

  // Delete truck
  const handleDeleteTruck = async (id: string) => {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      setTimeout(() => {
        setDeleteConfirmId((cur) => (cur === id ? null : cur));
      }, 3000);
      return;
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from('trucks').delete().eq('id', id);
        if (error) throw error;
      } catch (err: any) {
        showToast('Delete error: ' + err.message);
        return;
      }
    }

    const next = trucks.filter((t) => t.id !== id);
    setTrucks(next);
    localStorage.setItem(`gt_trucks_${date}`, JSON.stringify(next));
    broadcastRef.current?.postMessage({ type: 'TRUCKS_UPDATED' });
    setDeleteConfirmId(null);
    showToast('Truck removed');
  };

  // Format and copy day report
  const copyDayReport = () => {
    // Only trucks that passed Gate 2 (LOADED)
    const loadedTrucks = trucks.filter((t) => Boolean(t.gate2_at));

    if (loadedTrucks.length === 0) {
      showToast('No loaded trucks (Gate 2) yet to report!');
      return;
    }

    // Convert date YYYY-MM-DD to DD-MM-YYYY
    const [year, month, day] = date.split('-');
    const formattedDate = `${day}-${month}-${year}`;

    // Format each truck: "3187YB.  OMN-07PC"
    const truckLines = loadedTrucks.map((t) => {
      const pcsNum = t.pcs || 0;
      const paddedPcs = pcsNum < 10 ? `0${pcsNum}` : `${pcsNum}`;
      return `${t.plate}.  ${t.country}-${paddedPcs}PC`;
    });

    const reportText = `${formattedDate}\n\nKIZAD-CC\n\n${truckLines.join('\n')}\n\nLOADED`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(reportText).then(() => {
        showToast(`📋 Copied ${loadedTrucks.length} loaded trucks report!`);
      }).catch(() => {
        fallbackCopy(reportText, loadedTrucks.length);
      });
    } else {
      fallbackCopy(reportText, loadedTrucks.length);
    }
  };

  const fallbackCopy = (text: string, count: number) => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
      showToast(`📋 Copied ${count} loaded trucks report!`);
    } catch {
      showToast('Copy blocked by browser permissions');
    }
    el.remove();
  };

  // Parse text or photo lines
  const parseAndAddRows = (rawText: string) => {
    const lines = rawText.split('\n');
    let addedCount = 0;
    const newTrucksList = [...trucks];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().includes('gate') || trimmed.toLowerCase().includes('kizad')) continue;

      // Detect OMN or DXB
      const isDxb = /DXB|DUBAI/i.test(trimmed);
      const country: 'OMN' | 'DXB' = isDxb ? 'DXB' : 'OMN';

      // Extract plate number (alphanumeric like 3187YB or 39263 or 81852)
      const cleanMatch = trimmed.match(/[0-9]{3,6}[A-Z]{0,3}|[A-Z]{1,3}[0-9]{3,6}/i);
      if (!cleanMatch) continue;
      const plate = cleanMatch[0].toUpperCase();

      // Skip duplicate
      const already = newTrucksList.some(
        (t) => t.plate.toUpperCase() === plate && t.country === country
      );
      if (already) continue;

      newTrucksList.push({
        id: `t-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        work_date: date,
        plate: plate,
        country: country,
        gate1_at: null,
        gate1_by: null,
        gate2_at: null,
        gate2_by: null,
        pcs: null,
      });
      addedCount++;
    }

    if (addedCount > 0) {
      setTrucks(newTrucksList);
      localStorage.setItem(`gt_trucks_${date}`, JSON.stringify(newTrucksList));
      broadcastRef.current?.postMessage({ type: 'TRUCKS_UPDATED' });
      showToast(`Added ${addedCount} trucks from list!`);
    } else {
      showToast('No new trucks found in text or duplicates skipped.');
    }
  };

  // Image Upload handler (with Gemini or smart OCR parser)
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsingImage(true);
    showToast('Analyzing image photo…');

    const apiKey = geminiKey || import.meta.env.VITE_GEMINI_API_KEY;

    if (apiKey) {
      try {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(',')[1];
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        inline_data: {
                          mime_type: file.type,
                          data: base64data,
                        },
                      },
                      {
                        text: 'Extract the truck list from this image. For each truck, output: PLATE, COUNTRY (OMN or DXB), DRIVER. Example:\n3187YB OMN Salim\n39263 DXB Rashid\n81852 DXB Tariq\nOnly output clean text lines, no markdown.',
                      },
                    ],
                  },
                ],
              }),
            }
          );

          const result = await response.json();
          const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (generatedText) {
            parseAndAddRows(generatedText);
          } else {
            showToast('Could not extract text from photo');
          }
          setParsingImage(false);
        };
      } catch (err: any) {
        showToast('Vision API Error: ' + err.message);
        setParsingImage(false);
      }
    } else {
      // Prompt user or open modal
      setShowUploadModal(true);
      setParsingImage(false);
      showToast('Enter Gemini Key in Settings or paste list text');
    }
  };

  // Save Settings
  const handleSaveSettings = () => {
    localStorage.setItem('gt_supabase_url', sbUrl.trim());
    localStorage.setItem('gt_supabase_anon_key', sbKey.trim());
    localStorage.setItem('gt_gemini_key', geminiKey.trim());
    setShowSettings(false);
    showToast('Settings saved! Reloading…');
    setTimeout(() => window.location.reload(), 500);
  };

  // Filter trucks by search
  const filteredTrucks = useMemo(() => {
    if (!search.trim()) return trucks;
    const q = search.toLowerCase();
    return trucks.filter(
      (t) =>
        t.plate.toLowerCase().includes(q) ||
        (t.driver && t.driver.toLowerCase().includes(q)) ||
        t.country.toLowerCase().includes(q)
    );
  }, [trucks, search]);

  // Counters
  const sTotal = trucks.length;
  const sGate1 = trucks.filter((t) => Boolean(t.gate1_at)).length;
  const sLoaded = trucks.filter((t) => Boolean(t.gate2_at)).length;

  // -------------------------------------------------------------------------
  // LOGIN SCREEN (If not logged in)
  // -------------------------------------------------------------------------
  if (!currentWorker) {
    return (
      <div style={{ padding: '24px 20px', minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ 
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', 
            width: '64px', height: '64px', borderRadius: '20px', 
            background: 'var(--surface-raised)', border: '1px solid var(--surface-border)', 
            marginBottom: '16px' 
          }}>
            <Truck size={32} color="var(--text-main)" />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.5px' }}>Gate Tracker</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>KIZAD · CC · Worker Access</p>
        </div>

        <div style={{ background: 'var(--surface)', borderRadius: '24px', padding: '24px', border: '1px solid var(--surface-border)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={18} /> Select Worker ID
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
            {WORKERS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setLoginWorker(w)}
                style={{
                  padding: '14px 6px',
                  borderRadius: '14px',
                  border: '1px solid',
                  borderColor: loginWorker === w ? 'var(--text-main)' : 'var(--surface-border)',
                  background: loginWorker === w ? 'var(--btn-calc-action)' : 'var(--btn-calc-num)',
                  color: loginWorker === w ? 'var(--btn-calc-action-text)' : 'var(--text-main)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {w}
              </button>
            ))}
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Password (Default: worker123)
              </label>
              <input
                type="password"
                placeholder="Enter password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: '14px',
                  color: 'var(--text-main)',
                  fontSize: '15px',
                  outline: 'none',
                }}
                autoFocus
              />
            </div>

            {loginError && (
              <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={16} /> {loginError}
              </div>
            )}

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '15px',
                borderRadius: '16px',
                border: 'none',
                background: 'var(--btn-calc-action)',
                color: 'var(--btn-calc-action-text)',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              Sign In as {loginWorker}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <Settings size={14} /> Database & Supabase Settings
          </button>
        </div>

        {/* Settings Modal */}
        {showSettings && renderSettingsModal()}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // MAIN DASHBOARD (When Logged In)
  // -------------------------------------------------------------------------
  return (
    <div style={{ padding: '16px 16px 110px', width: '100%', boxSizing: 'border-box' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1.2 }}>Gate Tracker</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>KIZAD · CC</span>
            <span style={{ 
              fontSize: '11px', padding: '2px 8px', borderRadius: '10px', 
              background: isSupabaseConfigured ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: isSupabaseConfigured ? '#10b981' : '#f59e0b',
              fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', gap: '4px'
            }}>
              {isSupabaseConfigured ? '🟢 Live Supabase' : '🟡 Local Mode'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setShowSettings(true)}
            title="Database Settings"
            style={{
              width: '38px', height: '38px', borderRadius: '12px',
              background: 'var(--surface)', border: '1px solid var(--surface-border)',
              color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <Settings size={18} />
          </button>

          <button
            onClick={handleLogout}
            title="Log out"
            style={{
              padding: '8px 12px', borderRadius: '12px',
              background: 'var(--surface)', border: '1px solid var(--surface-border)',
              color: 'var(--text-main)', fontSize: '12px', fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: '6px',
              cursor: 'pointer'
            }}
          >
            <span>{currentWorker}</span>
            <LogOut size={14} color="var(--text-muted)" />
          </button>
        </div>
      </div>

      {/* Date & Action Panel (Calculator minimal card) */}
      <div style={{ 
        background: 'var(--surface)', borderRadius: '20px', padding: '14px', 
        border: '1px solid var(--surface-border)', marginBottom: '12px' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <Calendar size={18} color="var(--text-muted)" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--surface-border)',
              borderRadius: '12px',
              padding: '10px 14px',
              color: 'var(--text-main)',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: '14px',
              width: '100%',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={parsingImage}
            style={{
              padding: '12px', borderRadius: '14px',
              background: 'var(--btn-calc-action)',
              color: 'var(--btn-calc-action-text)',
              border: 'none',
              fontWeight: 700, fontSize: '13px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              cursor: 'pointer'
            }}
          >
            <Upload size={16} />
            {parsingImage ? 'Scanning…' : 'Upload photo'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoUpload}
          />

          <button
            onClick={() => setShowAdd(!showAdd)}
            style={{
              padding: '12px', borderRadius: '14px',
              background: 'var(--btn-calc-num)',
              color: 'var(--text-main)',
              border: '1px solid var(--surface-border)',
              fontWeight: 700, fontSize: '13px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              cursor: 'pointer'
            }}
          >
            <Plus size={16} />
            + Truck
          </button>
        </div>

        {/* Quick Add Form Drawer */}
        {showAdd && (
          <form onSubmit={handleAddTruck} style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--surface-border)' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                placeholder="Plate (e.g. 3187YB or 39263)"
                value={newPlate}
                onChange={(e) => setNewPlate(e.target.value)}
                style={{
                  flex: 2,
                  padding: '12px', borderRadius: '12px',
                  background: 'var(--surface-raised)', border: '1px solid var(--surface-border)',
                  color: 'var(--text-main)', fontSize: '14px', outline: 'none'
                }}
                autoFocus
              />
              <select
                value={newCountry}
                onChange={(e) => setNewCountry(e.target.value as 'OMN' | 'DXB')}
                style={{
                  flex: 1,
                  padding: '12px', borderRadius: '12px',
                  background: 'var(--surface-raised)', border: '1px solid var(--surface-border)',
                  color: 'var(--text-main)', fontSize: '14px', fontWeight: 700, outline: 'none'
                }}
              >
                <option value="OMN">OMN (6)</option>
                <option value="DXB">DXB (5)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Driver Name (Optional)"
                value={newDriver}
                onChange={(e) => setNewDriver(e.target.value)}
                style={{
                  flex: 2,
                  padding: '12px', borderRadius: '12px',
                  background: 'var(--surface-raised)', border: '1px solid var(--surface-border)',
                  color: 'var(--text-main)', fontSize: '14px', outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: '12px', borderRadius: '12px',
                  background: 'var(--btn-calc-action)', color: 'var(--btn-calc-action-text)',
                  border: 'none', fontWeight: 700, fontSize: '14px', cursor: 'pointer'
                }}
              >
                Save
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Stats Counter Bar (Calculator keys look) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
        <div style={{ 
          background: 'var(--surface)', borderRadius: '16px', padding: '12px 8px', 
          textAlign: 'center', border: '1px solid var(--surface-border)' 
        }}>
          <span style={{ display: 'block', fontSize: '22px', fontWeight: 800, color: '#3b82f6', fontFamily: 'JetBrains Mono' }}>
            {sGate1}
          </span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Gate 1</span>
        </div>

        <div style={{ 
          background: 'var(--surface)', borderRadius: '16px', padding: '12px 8px', 
          textAlign: 'center', border: '1px solid var(--surface-border)' 
        }}>
          <span style={{ display: 'block', fontSize: '22px', fontWeight: 800, color: '#10b981', fontFamily: 'JetBrains Mono' }}>
            {sLoaded}
          </span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Loaded</span>
        </div>

        <div style={{ 
          background: 'var(--surface)', borderRadius: '16px', padding: '12px 8px', 
          textAlign: 'center', border: '1px solid var(--surface-border)' 
        }}>
          <span style={{ display: 'block', fontSize: '22px', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'JetBrains Mono' }}>
            {sTotal}
          </span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Total</span>
        </div>
      </div>

      {/* Search Input */}
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '15px' }} />
        <input
          type="text"
          placeholder="Search plate or driver…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '13px 14px 13px 40px',
            background: 'var(--surface)',
            border: '1px solid var(--surface-border)',
            borderRadius: '16px',
            color: 'var(--text-main)',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{
              position: 'absolute', right: '12px', top: '12px',
              background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer'
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Trucks List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filteredTrucks.length === 0 ? (
          <div style={{ 
            background: 'var(--surface)', borderRadius: '20px', padding: '36px 20px', 
            textAlign: 'center', border: '1px dashed var(--surface-border)' 
          }}>
            <Truck size={36} color="var(--text-sub)" style={{ margin: '0 auto 10px' }} />
            <p style={{ color: 'var(--text-main)', fontWeight: 700, fontSize: '15px' }}>No trucks for this date</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
              Upload the truck photo or tap "+ Truck" to start
            </p>
          </div>
        ) : (
          filteredTrucks.map((t) => {
            const isG1 = Boolean(t.gate1_at);
            const isG2 = Boolean(t.gate2_at);

            return (
              <div
                key={t.id}
                className="animate-pop"
                style={{
                  background: 'var(--surface)',
                  borderRadius: '20px',
                  padding: '14px',
                  border: isG2 
                    ? '1px solid rgba(16, 185, 129, 0.4)' 
                    : isG1 
                    ? '1px solid rgba(59, 130, 246, 0.3)' 
                    : '1px solid var(--surface-border)',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.1)',
                  position: 'relative'
                }}
              >
                {/* Truck Header Row: Plate + Badges + Delete */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ 
                        fontFamily: 'JetBrains Mono, monospace', 
                        fontSize: '18px', 
                        fontWeight: 800, 
                        letterSpacing: '0.5px',
                        color: 'var(--text-main)'
                      }}>
                        {t.plate}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          padding: '3px 8px',
                          borderRadius: '8px',
                          background: t.country === 'OMN' ? 'rgba(217, 119, 6, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                          color: t.country === 'OMN' ? '#f59e0b' : '#60a5fa',
                          border: `1px solid ${t.country === 'OMN' ? 'rgba(217, 119, 6, 0.4)' : 'rgba(59, 130, 246, 0.4)'}`
                        }}
                      >
                        {t.country}
                      </span>

                      {isG2 && (
                        <span style={{ 
                          fontSize: '10px', fontWeight: 800, padding: '2px 6px', borderRadius: '6px',
                          background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', textTransform: 'uppercase'
                        }}>
                          LOADED
                        </span>
                      )}
                    </div>

                    {t.driver && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 500 }}>
                        {t.driver}
                      </div>
                    )}
                  </div>

                  {/* Delete button with 2-step confirmation */}
                  <button
                    onClick={() => handleDeleteTruck(t.id)}
                    style={{
                      background: deleteConfirmId === t.id ? '#ef4444' : 'transparent',
                      color: deleteConfirmId === t.id ? '#ffffff' : 'var(--text-sub)',
                      border: 'none',
                      padding: deleteConfirmId === t.id ? '4px 8px' : '4px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {deleteConfirmId === t.id ? 'Delete?' : '✕'}
                  </button>
                </div>

                {/* Gates and PC row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.6fr 72px', gap: '8px', alignItems: 'stretch' }}>
                  {/* Gate 1 Button */}
                  <button
                    type="button"
                    onClick={() => toggleGate1(t)}
                    style={{
                      padding: '10px 8px',
                      borderRadius: '14px',
                      border: '1px solid',
                      borderColor: isG1 ? '#2563eb' : 'var(--surface-border)',
                      background: isG1 ? '#2563eb' : 'var(--btn-calc-num)',
                      color: isG1 ? '#ffffff' : 'var(--text-main)',
                      fontWeight: 700,
                      fontSize: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {isG1 && <Check size={14} strokeWidth={3} />}
                      <span>Gate 1</span>
                    </div>
                    {isG1 && t.gate1_by && (
                      <span style={{ fontSize: '9px', opacity: 0.85, marginTop: '2px', fontWeight: 600 }}>
                        {t.gate1_by}
                      </span>
                    )}
                  </button>

                  {/* Gate 2 Button (LOADED) - LOCKED UNTIL GATE 1 IS TICKED */}
                  <button
                    type="button"
                    onClick={() => toggleGate2(t)}
                    disabled={!isG1}
                    style={{
                      padding: '10px 8px',
                      borderRadius: '14px',
                      border: '1px solid',
                      borderColor: isG2 ? '#059669' : !isG1 ? 'transparent' : 'var(--surface-border)',
                      background: isG2 ? '#059669' : !isG1 ? 'var(--surface-raised)' : 'var(--btn-calc-num)',
                      color: isG2 ? '#ffffff' : !isG1 ? 'var(--text-sub)' : 'var(--text-main)',
                      opacity: !isG1 ? 0.45 : 1,
                      fontWeight: 700,
                      fontSize: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: !isG1 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {!isG1 ? (
                        <Lock size={12} />
                      ) : isG2 ? (
                        <Check size={14} strokeWidth={3} />
                      ) : null}
                      <span>Gate 2 · {isG2 ? 'LOADED' : 'Load'}</span>
                    </div>
                    {isG2 && t.gate2_by && (
                      <span style={{ fontSize: '9px', opacity: 0.85, marginTop: '2px', fontWeight: 600 }}>
                        {t.gate2_by}
                      </span>
                    )}
                  </button>

                  {/* PC Box */}
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="PC"
                      value={t.pcs ?? ''}
                      onChange={(e) => handlePcsChange(t, e.target.value)}
                      style={{
                        width: '100%',
                        height: '100%',
                        minHeight: '44px',
                        padding: '6px',
                        borderRadius: '14px',
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--surface-border)',
                        color: 'var(--text-main)',
                        fontFamily: 'JetBrains Mono',
                        fontSize: '14px',
                        fontWeight: 700,
                        textAlign: 'center',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sticky Bottom Action Bar with Copy Button */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 16px calc(12px + var(--safe-bottom))',
          background: 'linear-gradient(transparent, var(--bg) 40%)',
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 90
        }}
      >
        <div style={{ width: '100%', maxWidth: '500px', pointerEvents: 'auto' }}>
          <button
            onClick={copyDayReport}
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: '18px',
              border: 'none',
              background: 'var(--btn-calc-action)',
              color: 'var(--btn-calc-action-text)',
              fontSize: '15px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              transition: 'transform 0.1s active'
            }}
          >
            <Copy size={18} />
            Copy Day Report ({sLoaded} Loaded)
          </button>
        </div>
      </div>

      {/* Floating Toast Notification */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--text-main)',
            color: 'var(--bg)',
            padding: '10px 18px',
            borderRadius: '14px',
            fontSize: '13px',
            fontWeight: 700,
            zIndex: 999,
            boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
            animation: 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* Upload Fallback Modal */}
      {showUploadModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px', zIndex: 100
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: '24px', padding: '24px',
            width: '100%', maxWidth: '420px', border: '1px solid var(--surface-border)'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '8px' }}>Paste Truck List</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
              Paste lines from your photo or document. Format: <br />
              <code style={{ fontSize: '11px' }}>3187YB OMN Salim</code> or <code style={{ fontSize: '11px' }}>39263 DXB</code>
            </p>
            <textarea
              rows={6}
              placeholder="Paste truck list here…"
              value={uploadText}
              onChange={(e) => setUploadText(e.target.value)}
              style={{
                width: '100%', padding: '12px', borderRadius: '14px',
                background: 'var(--surface-raised)', border: '1px solid var(--surface-border)',
                color: 'var(--text-main)', fontFamily: 'JetBrains Mono', fontSize: '13px',
                outline: 'none', marginBottom: '14px', boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                  parseAndAddRows(uploadText);
                  setUploadText('');
                  setShowUploadModal(false);
                }}
                style={{
                  flex: 1, padding: '12px', borderRadius: '14px',
                  background: 'var(--btn-calc-action)', color: 'var(--btn-calc-action-text)',
                  border: 'none', fontWeight: 700, cursor: 'pointer'
                }}
              >
                Add Trucks
              </button>
              <button
                onClick={() => setShowUploadModal(false)}
                style={{
                  padding: '12px 18px', borderRadius: '14px',
                  background: 'var(--btn-calc-num)', color: 'var(--text-main)',
                  border: '1px solid var(--surface-border)', fontWeight: 600, cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && renderSettingsModal()}
    </div>
  );

  // Modal for Supabase & API keys
  function renderSettingsModal() {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', zIndex: 100
      }}>
        <div style={{
          background: 'var(--surface)', borderRadius: '24px', padding: '24px',
          width: '100%', maxWidth: '440px', border: '1px solid var(--surface-border)',
          maxHeight: '90vh', overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={20} /> Supabase Settings
            </h3>
            <button
              onClick={() => setShowSettings(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
            Paste your free Supabase project keys here so all 6 workers on different phones sync live in real time.
          </p>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
              Supabase Project URL
            </label>
            <input
              type="text"
              placeholder="https://xyz.supabase.co"
              value={sbUrl}
              onChange={(e) => setSbUrl(e.target.value)}
              style={{
                width: '100%', padding: '12px', borderRadius: '12px',
                background: 'var(--surface-raised)', border: '1px solid var(--surface-border)',
                color: 'var(--text-main)', fontSize: '13px', outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
              Supabase Anon Key
            </label>
            <input
              type="password"
              placeholder="eyJhbGciOi..."
              value={sbKey}
              onChange={(e) => setSbKey(e.target.value)}
              style={{
                width: '100%', padding: '12px', borderRadius: '12px',
                background: 'var(--surface-raised)', border: '1px solid var(--surface-border)',
                color: 'var(--text-main)', fontSize: '13px', outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
              Gemini API Key (Optional for photo OCR)
            </label>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              style={{
                width: '100%', padding: '12px', borderRadius: '12px',
                background: 'var(--surface-raised)', border: '1px solid var(--surface-border)',
                color: 'var(--text-main)', fontSize: '13px', outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSaveSettings}
              style={{
                flex: 1, padding: '13px', borderRadius: '14px',
                background: 'var(--btn-calc-action)', color: 'var(--btn-calc-action-text)',
                border: 'none', fontWeight: 700, cursor: 'pointer'
              }}
            >
              Save & Connect
            </button>
            <button
              onClick={() => setShowSettings(false)}
              style={{
                padding: '13px 18px', borderRadius: '14px',
                background: 'var(--btn-calc-num)', color: 'var(--text-main)',
                border: '1px solid var(--surface-border)', fontWeight: 600, cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }
}
export default App;
