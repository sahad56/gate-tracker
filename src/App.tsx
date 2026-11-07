import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Truck, Check, Lock, Copy, Plus, Upload, Search, 
  LogOut, Trash2, X, User, AlertCircle
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

  // Option B: Worker filter and tabs
  const [tab, setTab] = useState<'all' | 'my'>('all');
  const [workerFilter, setWorkerFilter] = useState<string>('all');

  // 3. UI modals
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState<boolean>(false);

  // New truck form
  const [newPlate, setNewPlate] = useState<string>('');
  const [newCountry, setNewCountry] = useState<'OMN' | 'DXB'>('OMN');
  const [newDriver, setNewDriver] = useState<string>('');

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
    }, 2500);
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

  // Helper to test if a truck belongs to current worker
  const isTruckMine = (t: TruckItem) => {
    if (!currentWorker) return false;
    return (
      t.gate1_by === currentWorker ||
      t.gate2_by === currentWorker ||
      t.created_by === currentWorker ||
      (t.driver && t.driver.toLowerCase().includes(currentWorker.toLowerCase()))
    );
  };

  // Helper to test if a truck belongs to a specific worker
  const isTruckWorker = (t: TruckItem, w: string) => {
    return (
      t.gate1_by === w ||
      t.gate2_by === w ||
      t.created_by === w ||
      (t.driver && t.driver.toLowerCase().includes(w.toLowerCase()))
    );
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
        showToast('Sync error: ' + (err.message || 'Check connection'));
      }
    } else {
      const saved = localStorage.getItem(`gt_trucks_${date}`);
      if (saved) {
        try {
          setTrucks(JSON.parse(saved));
        } catch {
          setTrucks([]);
        }
      } else {
        setTrucks([]);
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
      showToast(`${t.plate}: Gate 1 ticked (${currentWorker})`);
    }

    setTrucks((prev) => prev.map((item) => (item.id === t.id ? updated : item)));
    await saveTruck(updated);
  };

  // Toggle Gate 2 (Loading place)
  const toggleGate2 = async (t: TruckItem) => {
    if (!currentWorker) return;
    
    // Check gate 1 rule
    if (!t.gate1_at) {
      showToast('⚠️ Tick Gate 1 first!');
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
      showToast(`🚚 ${t.plate}: LOADED! (${currentWorker})`);
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
      showToast('Enter valid plate number');
      return;
    }

    // Check duplicate plate for the day
    const exists = trucks.some(
      (t) => t.plate.toUpperCase() === cleanPlate && t.country === newCountry
    );
    if (exists) {
      showToast(`⚠️ Truck ${cleanPlate} already in list!`);
      return;
    }

    const workerTag = currentWorker || 'worker1';
    const driverString = newDriver.trim() 
      ? `${newDriver.trim()} · ${workerTag}` 
      : workerTag;

    const newTruckData: TruckItem = {
      id: isSupabaseConfigured ? (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}`) : `t-${Date.now()}`,
      work_date: date,
      plate: cleanPlate,
      country: newCountry,
      driver: driverString,
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
        showToast('Error: ' + err.message);
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
    showToast(`✓ Added ${cleanPlate} (${workerTag})`);
  };

  // Delete single truck
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

  // Clear all trucks for this day (when day is done)
  const handleClearDay = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      setTimeout(() => setClearConfirm(false), 3500);
      return;
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from('trucks').delete().eq('work_date', date);
        if (error) throw error;
      } catch (err: any) {
        showToast('Clear error: ' + err.message);
        return;
      }
    }

    setTrucks([]);
    localStorage.removeItem(`gt_trucks_${date}`);
    broadcastRef.current?.postMessage({ type: 'TRUCKS_UPDATED' });
    setClearConfirm(false);
    showToast('All trucks cleared for this date');
  };

  // Format and copy day report
  const copyDayReport = (onlyMine: boolean = false) => {
    let sourceTrucks = trucks;
    if (onlyMine) {
      sourceTrucks = sourceTrucks.filter(isTruckMine);
    }
    const loadedTrucks = sourceTrucks.filter((t) => Boolean(t.gate2_at));

    if (loadedTrucks.length === 0) {
      showToast(onlyMine ? 'No loaded trucks for you yet!' : 'No loaded trucks (Gate 2) yet!');
      return;
    }

    const [year, month, day] = date.split('-');
    const formattedDate = `${day}-${month}-${year}`;

    const truckLines = loadedTrucks.map((t) => {
      const pcsNum = t.pcs || 0;
      const paddedPcs = pcsNum < 10 ? `0${pcsNum}` : `${pcsNum}`;
      return `${t.plate}.  ${t.country}-${paddedPcs}PC`;
    });

    const reportText = `${formattedDate}\n\nKIZAD-CC\n\n${truckLines.join('\n')}\n\nLOADED`;

    const label = onlyMine ? `My (${loadedTrucks.length})` : `All (${loadedTrucks.length})`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(reportText).then(() => {
        showToast(`📋 Copied ${label} report!`);
      }).catch(() => {
        fallbackCopy(reportText, label);
      });
    } else {
      fallbackCopy(reportText, label);
    }
  };

  const fallbackCopy = (text: string, label: string) => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
      showToast(`📋 Copied ${label} report!`);
    } catch {
      showToast('Copy blocked by browser');
    }
    el.remove();
  };

  // Parse text lines from image/doc
  const parseAndAddRows = async (rawText: string) => {
    const lines = rawText.split('\n');
    const workerTag = currentWorker || 'worker1';
    const toInsert: TruckItem[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().includes('gate') || trimmed.toLowerCase().includes('kizad')) continue;

      const isDxb = /DXB|DUBAI/i.test(trimmed);
      const country: 'OMN' | 'DXB' = isDxb ? 'DXB' : 'OMN';

      const cleanMatch = trimmed.match(/[0-9]{3,6}[A-Z]{0,3}|[A-Z]{1,3}[0-9]{3,6}/i);
      if (!cleanMatch) continue;
      const plate = cleanMatch[0].toUpperCase();

      const already = trucks.some(
        (t) => t.plate.toUpperCase() === plate && t.country === country
      ) || toInsert.some(
        (t) => t.plate.toUpperCase() === plate && t.country === country
      );
      if (already) continue;

      toInsert.push({
        id: isSupabaseConfigured ? (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`) : `t-${Date.now()}-${Math.random()}`,
        work_date: date,
        plate: plate,
        country: country,
        driver: workerTag,
        gate1_at: null,
        gate1_by: null,
        gate2_at: null,
        gate2_by: null,
        pcs: null,
      });
    }

    if (toInsert.length > 0) {
      if (isSupabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase.from('trucks').insert(toInsert).select();
          if (error) throw error;
          if (data) {
            setTrucks((prev) => [...prev, ...data]);
          }
        } catch (err: any) {
          showToast('Supabase insert: ' + err.message);
          return;
        }
      } else {
        const next = [...trucks, ...toInsert];
        setTrucks(next);
        localStorage.setItem(`gt_trucks_${date}`, JSON.stringify(next));
        broadcastRef.current?.postMessage({ type: 'TRUCKS_UPDATED' });
      }
      showToast(`Added ${toInsert.length} trucks for ${workerTag}!`);
    } else {
      showToast('No new trucks found in text.');
    }
  };

  // Image Upload handler
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsingImage(true);
    showToast('Analyzing image photo…');

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

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
            await parseAndAddRows(generatedText);
          } else {
            showToast('Could not extract text');
          }
          setParsingImage(false);
        };
      } catch (err: any) {
        showToast('Vision error: ' + err.message);
        setParsingImage(false);
      }
    } else {
      setShowUploadModal(true);
      setParsingImage(false);
    }
  };

  // Filter trucks by search, tab (All vs My), and worker filter
  const filteredTrucks = useMemo(() => {
    let list = trucks;

    // Tab filter
    if (tab === 'my') {
      list = list.filter(isTruckMine);
    }

    // Specific worker dropdown filter
    if (workerFilter !== 'all') {
      list = list.filter((t) => isTruckWorker(t, workerFilter));
    }

    // Search query
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.plate.toLowerCase().includes(q) ||
          (t.driver && t.driver.toLowerCase().includes(q)) ||
          t.country.toLowerCase().includes(q)
      );
    }

    return list;
  }, [trucks, tab, workerFilter, search, currentWorker]);

  // Counters
  const sTotal = trucks.length;
  const sGate1 = trucks.filter((t) => Boolean(t.gate1_at)).length;
  const sLoaded = trucks.filter((t) => Boolean(t.gate2_at)).length;

  const myTrucksList = useMemo(() => trucks.filter(isTruckMine), [trucks, currentWorker]);
  const sMyTotal = myTrucksList.length;
  const sMyLoaded = myTrucksList.filter((t) => Boolean(t.gate2_at)).length;

  // -------------------------------------------------------------------------
  // LOGIN SCREEN (Pure White Aesthetic - ZERO API keys shown to workers)
  // -------------------------------------------------------------------------
  if (!currentWorker) {
    return (
      <div style={{ 
        height: '100dvh', width: '100%', 
        display: 'flex', flexDirection: 'column', justifyContent: 'center', 
        padding: '20px', background: '#f5f6f9' 
      }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ 
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', 
            width: '52px', height: '52px', borderRadius: '16px', 
            background: '#ffffff', border: '1px solid #e5e7eb', 
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            marginBottom: '12px' 
          }}>
            <Truck size={26} color="#111827" />
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#111827', letterSpacing: '-0.4px' }}>Gate Tracker</h1>
          <p style={{ color: '#6b7280', fontSize: '12px', marginTop: '2px', fontWeight: 500 }}>KIZAD · CC · Worker Access</p>
        </div>

        <div style={{ 
          background: '#ffffff', borderRadius: '20px', padding: '20px', 
          border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' 
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <User size={15} /> Select Your Worker ID
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '16px' }}>
            {WORKERS.map((w) => {
              const active = loginWorker === w;
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => setLoginWorker(w)}
                  style={{
                    padding: '11px 4px',
                    borderRadius: '12px',
                    border: '1px solid',
                    borderColor: active ? '#111827' : '#e5e7eb',
                    background: active ? '#111827' : '#f9fafb',
                    color: active ? '#ffffff' : '#374151',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.12s ease'
                  }}
                >
                  {w}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '5px' }}>
                Password (Default: worker123)
              </label>
              <input
                type="password"
                placeholder="worker123"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  color: '#111827',
                  fontSize: '14px',
                  outline: 'none',
                }}
                autoFocus
              />
            </div>

            {loginError && (
              <div style={{ color: '#dc2626', fontSize: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <AlertCircle size={14} /> {loginError}
              </div>
            )}

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '13px',
                borderRadius: '14px',
                border: 'none',
                background: '#111827',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Sign In as {loginWorker}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // MAIN DASHBOARD (Option B: All / My Trucks Filter, All Day Persistence)
  // -------------------------------------------------------------------------
  return (
    <div style={{ 
      height: '100dvh', width: '100%', 
      display: 'flex', flexDirection: 'column', 
      overflow: 'hidden', background: '#f5f6f9', position: 'relative' 
    }}>
      
      {/* 1. FIXED TOP HEADER BAR (Compact) */}
      <header style={{ 
        flexShrink: 0, padding: '12px 14px 8px', 
        background: '#ffffff', borderBottom: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '16px', fontWeight: 800, color: '#111827', letterSpacing: '-0.4px' }}>
                Gate Tracker
              </span>
              <span style={{ 
                fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '6px', 
                background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0'
              }}>
                🟢 Live Cloud
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
              KIZAD · CC · <span style={{ fontWeight: 700, color: '#111827' }}>{currentWorker}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {/* Clear All Day Button (After work is finished) */}
            <button
              onClick={handleClearDay}
              title="Clear all trucks for this date"
              style={{
                height: '32px', padding: '0 8px', borderRadius: '10px',
                background: clearConfirm ? '#fee2e2' : '#f3f4f6',
                border: `1px solid ${clearConfirm ? '#fca5a5' : '#e5e7eb'}`,
                color: clearConfirm ? '#dc2626' : '#6b7280',
                fontSize: '11px', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: '4px',
                cursor: 'pointer'
              }}
            >
              <Trash2 size={13} />
              <span>{clearConfirm ? 'Clear all?' : 'Clear'}</span>
            </button>

            <button
              onClick={handleLogout}
              title="Log out"
              style={{
                height: '32px', padding: '0 10px', borderRadius: '10px',
                background: '#f3f4f6', border: '1px solid #e5e7eb',
                color: '#111827', fontSize: '11px', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: '5px',
                cursor: 'pointer'
              }}
            >
              <span>{currentWorker}</span>
              <LogOut size={12} color="#6b7280" />
            </button>
          </div>
        </div>

        {/* Shredded Controls Line: Date + Photo + Add */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1.2 }}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 8px',
                borderRadius: '10px',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                color: '#111827',
                fontSize: '12px',
                fontWeight: 700,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={parsingImage}
            style={{
              padding: '7px 11px', borderRadius: '10px',
              background: '#111827', color: '#ffffff',
              border: 'none', fontWeight: 700, fontSize: '11px',
              display: 'flex', alignItems: 'center', gap: '4px',
              cursor: 'pointer', whiteSpace: 'nowrap'
            }}
          >
            <Upload size={13} />
            {parsingImage ? 'Scanning…' : 'Photo'}
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
              padding: '7px 11px', borderRadius: '10px',
              background: showAdd ? '#111827' : '#ffffff',
              color: showAdd ? '#ffffff' : '#111827',
              border: '1px solid #e5e7eb',
              fontWeight: 700, fontSize: '11px',
              display: 'flex', alignItems: 'center', gap: '3px',
              cursor: 'pointer', whiteSpace: 'nowrap'
            }}
          >
            <Plus size={13} />
            Truck
          </button>
        </div>

        {/* Quick Add Form Dropdown */}
        {showAdd && (
          <form onSubmit={handleAddTruck} style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e5e7eb' }}>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
              <input
                type="text"
                placeholder="Plate (e.g. 3187YB)"
                value={newPlate}
                onChange={(e) => setNewPlate(e.target.value)}
                style={{
                  flex: 2, padding: '8px 10px', borderRadius: '8px',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  color: '#111827', fontSize: '12px', outline: 'none'
                }}
                autoFocus
              />
              <select
                value={newCountry}
                onChange={(e) => setNewCountry(e.target.value as 'OMN' | 'DXB')}
                style={{
                  flex: 1, padding: '8px 6px', borderRadius: '8px',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  color: '#111827', fontSize: '12px', fontWeight: 700, outline: 'none'
                }}
              >
                <option value="OMN">OMN (6)</option>
                <option value="DXB">DXB (5)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input
                type="text"
                placeholder="Driver name (optional)"
                value={newDriver}
                onChange={(e) => setNewDriver(e.target.value)}
                style={{
                  flex: 2, padding: '8px 10px', borderRadius: '8px',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  color: '#111827', fontSize: '12px', outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  flex: 1, padding: '8px', borderRadius: '8px',
                  background: '#111827', color: '#ffffff',
                  border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer'
                }}
              >
                Add
              </button>
            </div>
          </form>
        )}

        {/* OPTION B: Filter Tabs (All Trucks vs My Trucks) */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => { setTab('all'); setWorkerFilter('all'); }}
            style={{
              flex: 1, padding: '6px 4px', borderRadius: '8px', border: '1px solid',
              borderColor: tab === 'all' && workerFilter === 'all' ? '#111827' : '#e5e7eb',
              background: tab === 'all' && workerFilter === 'all' ? '#111827' : '#ffffff',
              color: tab === 'all' && workerFilter === 'all' ? '#ffffff' : '#6b7280',
              fontWeight: 700, fontSize: '11px', cursor: 'pointer'
            }}
          >
            All Trucks ({sTotal})
          </button>

          <button
            type="button"
            onClick={() => { setTab('my'); setWorkerFilter('all'); }}
            style={{
              flex: 1, padding: '6px 4px', borderRadius: '8px', border: '1px solid',
              borderColor: tab === 'my' ? '#2563eb' : '#e5e7eb',
              background: tab === 'my' ? '#eff6ff' : '#ffffff',
              color: tab === 'my' ? '#2563eb' : '#6b7280',
              fontWeight: 700, fontSize: '11px', cursor: 'pointer'
            }}
          >
            My Trucks ({sMyTotal})
          </button>

          {/* Worker Dropdown Filter */}
          <select
            value={workerFilter}
            onChange={(e) => {
              setWorkerFilter(e.target.value);
              if (e.target.value !== 'all') setTab('all');
            }}
            style={{
              padding: '6px 6px', borderRadius: '8px', border: '1px solid #e5e7eb',
              background: workerFilter !== 'all' ? '#111827' : '#ffffff',
              color: workerFilter !== 'all' ? '#ffffff' : '#4b5563',
              fontWeight: 700, fontSize: '11px', outline: 'none', cursor: 'pointer'
            }}
          >
            <option value="all">Worker: Any</option>
            {WORKERS.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </div>

        {/* Compact Shredded Stats Pills */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px' }}>
          <div style={{ 
            background: '#eff6ff', borderRadius: '10px', padding: '5px', 
            textAlign: 'center', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
          }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#2563eb', fontFamily: 'JetBrains Mono' }}>
              {sGate1}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#1e40af' }}>Gate 1</span>
          </div>

          <div style={{ 
            background: '#ecfdf5', borderRadius: '10px', padding: '5px', 
            textAlign: 'center', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
          }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#059669', fontFamily: 'JetBrains Mono' }}>
              {sLoaded}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#065f46' }}>Loaded</span>
          </div>

          <div style={{ 
            background: '#f9fafb', borderRadius: '10px', padding: '5px', 
            textAlign: 'center', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
          }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#111827', fontFamily: 'JetBrains Mono' }}>
              {filteredTrucks.length}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280' }}>Shown</span>
          </div>
        </div>

        {/* Slim Search Input */}
        <div style={{ position: 'relative', marginTop: '6px' }}>
          <Search size={13} color="#9ca3af" style={{ position: 'absolute', left: '10px', top: '9px' }} />
          <input
            type="text"
            placeholder={tab === 'my' ? `Search ${currentWorker}'s trucks…` : 'Search plate or driver…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 28px 7px 28px',
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              color: '#111827',
              fontSize: '12px',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute', right: '8px', top: '7px',
                background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer'
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      {/* 2. SCROLLABLE TRUCK LIST (ONLY this part scrolls) */}
      <main className="scroll-area" style={{ padding: '8px 12px 85px' }}>
        {filteredTrucks.length === 0 ? (
          <div style={{ 
            background: '#ffffff', borderRadius: '16px', padding: '30px 16px', 
            textAlign: 'center', border: '1px dashed #e5e7eb', marginTop: '10px' 
          }}>
            <Truck size={30} color="#9ca3af" style={{ margin: '0 auto 8px' }} />
            <p style={{ color: '#111827', fontWeight: 700, fontSize: '13px' }}>
              {tab === 'my' ? `No trucks for ${currentWorker}` : 'No trucks found'}
            </p>
            <p style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>
              {tab === 'my' 
                ? 'Tap "+ Truck" to add your trucks, or switch to "All Trucks"' 
                : 'Tap "Photo" or "+ Truck" above'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {filteredTrucks.map((t) => {
              const isG1 = Boolean(t.gate1_at);
              const isG2 = Boolean(t.gate2_at);
              const mine = isTruckMine(t);

              return (
                <div
                  key={t.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: '14px',
                    padding: '9px 10px',
                    border: isG2 
                      ? '1px solid #a7f3d0' 
                      : isG1 
                      ? '1px solid #bfdbfe' 
                      : mine
                      ? '1px solid #dbeafe'
                      : '1px solid #e5e7eb',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    transition: 'border-color 0.15s ease'
                  }}
                >
                  {/* Row 1: Plate, Country tag, Loaded badge, Driver/Owner, Delete */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ 
                        fontFamily: 'JetBrains Mono, monospace', 
                        fontSize: '15px', 
                        fontWeight: 800, 
                        color: '#111827',
                        letterSpacing: '0.3px'
                      }}>
                        {t.plate}
                      </span>

                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          padding: '1px 6px',
                          borderRadius: '6px',
                          background: t.country === 'OMN' ? '#fef3c7' : '#dbeafe',
                          color: t.country === 'OMN' ? '#b45309' : '#1d4ed8',
                          border: `1px solid ${t.country === 'OMN' ? '#fde68a' : '#bfdbfe'}`
                        }}
                      >
                        {t.country}
                      </span>

                      {isG2 && (
                        <span style={{ 
                          fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '5px',
                          background: '#d1fae5', color: '#065f46', textTransform: 'uppercase'
                        }}>
                          LOADED
                        </span>
                      )}

                      {/* Driver & Worker Owner tag */}
                      {t.driver && (
                        <span style={{ 
                          fontSize: '10px', color: '#4b5563', fontWeight: 600,
                          background: '#f3f4f6', padding: '1px 6px', borderRadius: '5px' 
                        }}>
                          {t.driver}
                        </span>
                      )}
                    </div>

                    {/* Compact Delete button */}
                    <button
                      onClick={() => handleDeleteTruck(t.id)}
                      style={{
                        background: deleteConfirmId === t.id ? '#fee2e2' : 'transparent',
                        color: deleteConfirmId === t.id ? '#dc2626' : '#9ca3af',
                        border: 'none',
                        padding: '2px 5px',
                        borderRadius: '6px',
                        fontSize: '10px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {deleteConfirmId === t.id ? 'Sure?' : '✕'}
                    </button>
                  </div>

                  {/* Row 2: Gate 1 + Gate 2 (LOADED) + PC input */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr 54px', gap: '5px', alignItems: 'center' }}>
                    {/* Gate 1 Button */}
                    <button
                      type="button"
                      onClick={() => toggleGate1(t)}
                      style={{
                        height: '34px',
                        padding: '0 6px',
                        borderRadius: '9px',
                        border: '1px solid',
                        borderColor: isG1 ? '#2563eb' : '#e5e7eb',
                        background: isG1 ? '#2563eb' : '#f9fafb',
                        color: isG1 ? '#ffffff' : '#374151',
                        fontWeight: 700,
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      {isG1 && <Check size={12} strokeWidth={3} />}
                      <span>Gate 1</span>
                      {isG1 && t.gate1_by && (
                        <span style={{ fontSize: '8px', opacity: 0.85, fontWeight: 600 }}>
                          ({t.gate1_by})
                        </span>
                      )}
                    </button>

                    {/* Gate 2 Button (LOADED) - LOCKED UNTIL GATE 1 IS TICKED */}
                    <button
                      type="button"
                      onClick={() => toggleGate2(t)}
                      disabled={!isG1}
                      style={{
                        height: '34px',
                        padding: '0 6px',
                        borderRadius: '9px',
                        border: '1px solid',
                        borderColor: isG2 ? '#059669' : !isG1 ? '#edf0f4' : '#e5e7eb',
                        background: isG2 ? '#059669' : !isG1 ? '#f9fafb' : '#f9fafb',
                        color: isG2 ? '#ffffff' : !isG1 ? '#9ca3af' : '#111827',
                        opacity: !isG1 ? 0.5 : 1,
                        fontWeight: 700,
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        cursor: !isG1 ? 'not-allowed' : 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      {!isG1 ? (
                        <Lock size={11} />
                      ) : isG2 ? (
                        <Check size={12} strokeWidth={3} />
                      ) : null}
                      <span>G2 · {isG2 ? 'LOADED' : 'Load'}</span>
                      {isG2 && t.gate2_by && (
                        <span style={{ fontSize: '8px', opacity: 0.85, fontWeight: 600 }}>
                          ({t.gate2_by})
                        </span>
                      )}
                    </button>

                    {/* Compact PC Box */}
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="PC"
                      value={t.pcs ?? ''}
                      onChange={(e) => handlePcsChange(t, e.target.value)}
                      style={{
                        height: '34px',
                        width: '100%',
                        padding: '0 4px',
                        borderRadius: '9px',
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        color: '#111827',
                        fontFamily: 'JetBrains Mono',
                        fontSize: '12px',
                        fontWeight: 700,
                        textAlign: 'center',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 3. FIXED BOTTOM BAR (Copy Report: My Report vs All Report) */}
      <footer
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '10px 14px calc(10px + var(--safe-bottom))',
          background: 'linear-gradient(to top, #ffffff 75%, rgba(255, 255, 255, 0))',
          display: 'flex',
          justifyContent: 'center',
          gap: '8px',
          pointerEvents: 'none',
          zIndex: 40
        }}
      >
        <button
          onClick={() => copyDayReport(tab === 'my')}
          style={{
            flex: 2,
            maxWidth: '320px',
            padding: '13px',
            borderRadius: '14px',
            border: 'none',
            background: '#111827',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            pointerEvents: 'auto'
          }}
        >
          <Copy size={15} />
          {tab === 'my' 
            ? `Copy My Report (${sMyLoaded})` 
            : `Copy Report (${sLoaded} Loaded)`}
        </button>

        {tab === 'my' ? (
          <button
            onClick={() => copyDayReport(false)}
            title="Copy all site loaded trucks"
            style={{
              flex: 1,
              maxWidth: '120px',
              padding: '13px 8px',
              borderRadius: '14px',
              border: '1px solid #e5e7eb',
              background: '#ffffff',
              color: '#111827',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              pointerEvents: 'auto'
            }}
          >
            All ({sLoaded})
          </button>
        ) : (
          <button
            onClick={() => copyDayReport(true)}
            title="Copy only my loaded trucks"
            style={{
              flex: 1,
              maxWidth: '120px',
              padding: '13px 8px',
              borderRadius: '14px',
              border: '1px solid #e5e7eb',
              background: '#ffffff',
              color: '#111827',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              pointerEvents: 'auto'
            }}
          >
            Mine ({sMyLoaded})
          </button>
        )}
      </footer>

      {/* Toast Notification */}
      {toastMsg && (
        <div
          style={{
            position: 'absolute',
            top: '14px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111827',
            color: '#ffffff',
            padding: '8px 14px',
            borderRadius: '10px',
            fontSize: '12px',
            fontWeight: 700,
            zIndex: 999,
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
            whiteSpace: 'nowrap'
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* Upload/Paste Modal */}
      {showUploadModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px', zIndex: 100
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '18px', padding: '18px',
            width: '100%', maxWidth: '380px', border: '1px solid #e5e7eb',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '6px' }}>Paste Truck List</h3>
            <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '10px' }}>
              Format: <code style={{ background: '#f3f4f6', padding: '2px 4px', borderRadius: '4px' }}>3187YB OMN</code> or <code style={{ background: '#f3f4f6', padding: '2px 4px', borderRadius: '4px' }}>39263 DXB</code>
            </p>
            <textarea
              rows={5}
              placeholder="Paste truck list lines here…"
              value={uploadText}
              onChange={(e) => setUploadText(e.target.value)}
              style={{
                width: '100%', padding: '10px', borderRadius: '10px',
                background: '#f9fafb', border: '1px solid #e5e7eb',
                color: '#111827', fontFamily: 'JetBrains Mono', fontSize: '12px',
                outline: 'none', marginBottom: '12px', boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => {
                  parseAndAddRows(uploadText);
                  setUploadText('');
                  setShowUploadModal(false);
                }}
                style={{
                  flex: 1, padding: '10px', borderRadius: '10px',
                  background: '#111827', color: '#ffffff',
                  border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer'
                }}
              >
                Add Trucks ({currentWorker})
              </button>
              <button
                onClick={() => setShowUploadModal(false)}
                style={{
                  padding: '10px 14px', borderRadius: '10px',
                  background: '#f3f4f6', color: '#374151',
                  border: '1px solid #e5e7eb', fontWeight: 600, fontSize: '12px', cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
