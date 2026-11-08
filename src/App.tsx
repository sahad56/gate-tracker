import React, { useState, useEffect, useMemo } from 'react';
import { 
  Truck, Check, Lock, Copy, Plus, Search, 
  LogOut, X, AlertCircle, Phone, Clock, Download
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase, getEmailPrefix } from './supabase';
import type { TruckItem } from './supabase';

// Format ISO string to Dubai 24h time HH:mm
function formatDubaiTime(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '';
  }
}

// Calculate difference in minutes between two dates/ISOs
function getMinutesDiff(startIso: string, endIso?: string | null): number {
  try {
    const start = new Date(startIso).getTime();
    const end = endIso ? new Date(endIso).getTime() : Date.now();
    return Math.max(0, Math.round((end - start) / 60000));
  } catch {
    return 0;
  }
}

// Line parser according to Prompt B.5:
// PLATE COUNTRY DRIVER NAME PHONE
function parseTruckLine(line: string): {
  plate: string;
  country: 'OMN' | 'DXB';
  driver: string | null;
  driver_phone: string | null;
} | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('plate') || lower.startsWith('kizad') || lower === 'loaded') return null;

  // Split by tabs or spaces
  const tokens = trimmed.split(/[\t\s]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // First token = plate (alphanumeric uppercase)
  const plate = tokens[0].toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!plate) return null;

  // Second token = country (OMN or DXB, also accept OMN-8548 style)
  let country: 'OMN' | 'DXB' = 'OMN';
  let startIndex = 1;
  if (tokens.length > 1) {
    const t1 = tokens[1].toUpperCase();
    if (t1.includes('DXB') || t1.includes('DUBAI')) {
      country = 'DXB';
      startIndex = 2;
    } else if (t1.includes('OMN') || t1.includes('OMAN')) {
      country = 'OMN';
      startIndex = 2;
    }
  }

  // Remaining tokens: driver name and optional phone
  const remaining = tokens.slice(startIndex);
  let driver_phone: string | null = null;
  let driverTokens = remaining;

  if (remaining.length > 0) {
    const last = remaining[remaining.length - 1];
    const cleanPhone = last.replace(/[\s-]/g, '');
    if (/^\+?[0-9]{7,15}$/.test(cleanPhone)) {
      driver_phone = last;
      driverTokens = remaining.slice(0, remaining.length - 1);
    }
  }

  const driver = driverTokens.join(' ').trim() || null;

  return { plate, country, driver, driver_phone };
}

interface UndoState {
  truckId: string;
  plate: string;
  prevGate1At: string | null;
  prevGate2At: string | null;
  actionText: string;
  timeoutId: any;
}

export function App() {
  // 1. Auth state (Real Supabase Auth)
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [loginInput, setLoginInput] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState<boolean>(false);

  // 2. Data state
  const [date, setDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [trucks, setTrucks] = useState<TruckItem[]>([]);
  const [search, setSearch] = useState<string>('');
  const [toastMsg, setToastMsg] = useState<string>('');

  // Minute ticker for live wait time update
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  // Modals & form state
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [showPasteModal, setShowPasteModal] = useState<boolean>(false);
  const [pasteText, setPasteText] = useState<string>('');
  const [isPasting, setIsPasting] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newDayConfirm, setNewDayConfirm] = useState<boolean>(false);

  // New truck form
  const [newPlate, setNewPlate] = useState<string>('');
  const [newCountry, setNewCountry] = useState<'OMN' | 'DXB'>('OMN');
  const [newDriver, setNewDriver] = useState<string>('');
  const [newPhone, setNewPhone] = useState<string>('');

  // Undo state (Feature 2)
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  // iOS Add to Home Screen hint (Feature 1)
  const [showIosPrompt, setShowIosPrompt] = useState<boolean>(() => {
    try {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone = ('standalone' in navigator && (navigator as any).standalone);
      const dismissed = localStorage.getItem('gt_pwa_hint_dismissed');
      return isIos && !isStandalone && !dismissed;
    } catch {
      return false;
    }
  });

  // Admin filter by worker (for kenz)
  const [adminWorkerFilter, setAdminWorkerFilter] = useState<string>('all');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? '' : cur));
    }, 3500);
  };

  // Auth initialization
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const currentUserEmail = session?.user?.email || '';
  const currentWorker = getEmailPrefix(currentUserEmail);
  const isAdmin = currentWorker.toLowerCase() === 'kenz' || currentUserEmail.toLowerCase() === 'kenz@gate.app';

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginInput.trim() || !loginPassword.trim()) {
      setLoginError('Enter your username and password');
      return;
    }

    setIsSubmittingAuth(true);
    setLoginError('');

    // If user typed 'kenz' or 'w1', auto append '@gate.app'
    let fullEmail = loginInput.trim();
    if (!fullEmail.includes('@')) {
      fullEmail = `${fullEmail}@gate.app`;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: fullEmail,
        password: loginPassword,
      });

      if (error) {
        setLoginError(error.message);
      } else if (data.session) {
        setSession(data.session);
        setLoginPassword('');
        setLoginError('');
        showToast(`Welcome, ${getEmailPrefix(data.session.user.email)}!`);
      }
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setTrucks([]);
  };

  // Load trucks for the selected date from Supabase
  const loadTrucks = async () => {
    if (!session) return;
    try {
      const { data, error } = await supabase
        .from('trucks')
        .select('*')
        .eq('work_date', date)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

      if (error) throw error;
      
      setTrucks((prev) => {
        if (!prev || prev.length === 0) return data || [];
        const map = new Map((data || []).map((t) => [t.id, t]));
        const serverIds = new Set((data || []).map((t) => t.id));
        
        // Keep existing trucks in their EXACT current positions, updating their attributes
        const preserved = prev
          .filter((t) => serverIds.has(t.id))
          .map((t) => ({ ...t, ...(map.get(t.id) || {}) }));

        // Append any newly added trucks at the end
        const existingIds = new Set(prev.map((t) => t.id));
        const newItems = (data || []).filter((t) => !existingIds.has(t.id));

        return [...preserved, ...newItems];
      });
    } catch (err: any) {
      console.error('Supabase fetch error:', err);
      showToast('Sync error: ' + (err.message || 'Check connection'));
    }
  };

  useEffect(() => {
    if (session) {
      setTrucks([]);
      loadTrucks();
    }
  }, [date, session]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel('public:trucks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trucks' },
        (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new) {
            setTrucks((prev) =>
              prev.map((item) => (item.id === payload.new.id ? { ...item, ...payload.new } : item))
            );
          } else if (payload.eventType === 'DELETE' && payload.old) {
            setTrucks((prev) => prev.filter((item) => item.id !== (payload.old as any).id));
          } else if (payload.eventType === 'INSERT' && payload.new) {
            setTrucks((prev) => {
              const newItem = payload.new as TruckItem;
              if (newItem.work_date !== date) return prev;
              if (prev.some((item) => item.id === newItem.id)) return prev;
              return [...prev, newItem];
            });
          } else {
            loadTrucks();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [date, session]);

  // Set undo toast helper
  const triggerUndo = (truckId: string, plate: string, prevGate1At: string | null, prevGate2At: string | null, actionText: string) => {
    if (undoState?.timeoutId) {
      clearTimeout(undoState.timeoutId);
    }

    const timeoutId = setTimeout(() => {
      setUndoState((cur) => (cur?.truckId === truckId ? null : cur));
    }, 5000);

    setUndoState({
      truckId,
      plate,
      prevGate1At,
      prevGate2At,
      actionText,
      timeoutId,
    });
  };

  // Handle Undo click
  const handleUndo = async () => {
    if (!undoState) return;
    const { truckId, prevGate1At, prevGate2At, timeoutId } = undoState;
    if (timeoutId) clearTimeout(timeoutId);
    setUndoState(null);

    // Optimistic in-place update (zero shuffle)
    setTrucks((prev) =>
      prev.map((item) =>
        item.id === truckId
          ? { ...item, gate1_at: prevGate1At, gate2_at: prevGate2At }
          : item
      )
    );

    try {
      const { error } = await supabase
        .from('trucks')
        .update({
          gate1_at: prevGate1At,
          gate2_at: prevGate2At,
        })
        .eq('id', truckId);

      if (error) throw error;
      showToast('Action undone');
    } catch (err: any) {
      showToast('Undo failed: ' + err.message);
    }
  };

  // Toggle Gate 1
  const toggleGate1 = async (t: TruckItem) => {
    const isChecked = Boolean(t.gate1_at);
    const prevGate1At = t.gate1_at ?? null;
    const prevGate2At = t.gate2_at ?? null;

    let payload: { gate1_at: string | null; gate2_at: string | null };
    let actionLabel: string;

    if (isChecked) {
      payload = { gate1_at: null, gate2_at: null };
      actionLabel = `${t.plate}: Gate 1 unticked`;
    } else {
      payload = { gate1_at: new Date().toISOString(), gate2_at: prevGate2At };
      actionLabel = `${t.plate}: Gate 1 ticked`;
    }

    // Instant optimistic update in place (no position change)
    setTrucks((prev) =>
      prev.map((item) => (item.id === t.id ? { ...item, ...payload } : item))
    );

    triggerUndo(t.id, t.plate, prevGate1At, prevGate2At, actionLabel);

    try {
      const { error } = await supabase
        .from('trucks')
        .update(payload)
        .eq('id', t.id);

      if (error) throw error;
    } catch (err: any) {
      // Revert if error
      setTrucks((prev) =>
        prev.map((item) =>
          item.id === t.id ? { ...item, gate1_at: prevGate1At, gate2_at: prevGate2At } : item
        )
      );
      showToast('Error: ' + err.message);
    }
  };

  // Toggle Gate 2 (LOADED)
  const toggleGate2 = async (t: TruckItem) => {
    if (!t.gate1_at) {
      showToast('⚠️ Tick Gate 1 first!');
      return;
    }

    const isChecked = Boolean(t.gate2_at);
    const prevGate1At = t.gate1_at ?? null;
    const prevGate2At = t.gate2_at ?? null;

    const payload = {
      gate2_at: isChecked ? null : new Date().toISOString(),
    };
    const actionLabel = isChecked ? `${t.plate}: Gate 2 unticked` : `${t.plate}: Gate 2 ticked`;

    // Instant optimistic update in place (no position change)
    setTrucks((prev) =>
      prev.map((item) => (item.id === t.id ? { ...item, ...payload } : item))
    );

    triggerUndo(t.id, t.plate, prevGate1At, prevGate2At, actionLabel);

    try {
      const { error } = await supabase
        .from('trucks')
        .update(payload)
        .eq('id', t.id);

      if (error) throw error;
    } catch (err: any) {
      // Revert if error
      setTrucks((prev) =>
        prev.map((item) =>
          item.id === t.id ? { ...item, gate2_at: prevGate2At } : item
        )
      );
      showToast('Error: ' + err.message);
    }
  };

  // Update PC (Pieces) on blur
  const handlePcsBlur = async (t: TruckItem, val: string) => {
    const pcsVal = val === '' ? null : parseInt(val, 10);
    const num = isNaN(pcsVal as any) ? null : pcsVal;
    if (t.pcs === num) return;

    setTrucks((prev) => prev.map((item) => (item.id === t.id ? { ...item, pcs: num } : item)));

    try {
      const { error } = await supabase
        .from('trucks')
        .update({ pcs: num })
        .eq('id', t.id);

      if (error) throw error;
    } catch (err: any) {
      showToast('PC save error: ' + err.message);
    }
  };

  // Update Driver name and phone on blur
  const handleDriverFieldsBlur = async (id: string, driver: string, driver_phone: string) => {
    const dVal = driver.trim() || null;
    const pVal = driver_phone.trim() || null;

    setTrucks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, driver: dVal, driver_phone: pVal } : item))
    );

    try {
      const { error } = await supabase
        .from('trucks')
        .update({ driver: dVal, driver_phone: pVal })
        .eq('id', id);

      if (error) throw error;
    } catch (err: any) {
      showToast('Driver save error: ' + err.message);
    }
  };

  // Add single truck manually
  const handleAddTruck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      showToast('Please sign in first');
      return;
    }

    const cleanPlate = newPlate.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!cleanPlate) {
      showToast('Enter valid plate number');
      return;
    }

    const rowToInsert = {
      work_date: date,
      plate: cleanPlate,
      country: newCountry,
      driver: newDriver.trim() || null,
      driver_phone: newPhone.trim() || null,
      gate1_at: null,
      gate2_at: null,
      pcs: null,
    };

    try {
      const { data, error } = await supabase
        .from('trucks')
        .upsert([rowToInsert], { onConflict: 'work_date,plate,country', ignoreDuplicates: true })
        .select();

      if (error) throw error;

      await loadTrucks();

      if (data && data.length > 0) {
        showToast(`✓ Added ${cleanPlate}`);
        setNewPlate('');
        setNewDriver('');
        setNewPhone('');
        setShowAdd(false);
      } else {
        showToast(`⚠️ Truck ${cleanPlate} already exists for this day!`);
      }
    } catch (err: any) {
      showToast('Error: ' + err.message);
    }
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

    try {
      const { error } = await supabase.from('trucks').delete().eq('id', id);
      if (error) throw error;
      setDeleteConfirmId(null);
      await loadTrucks();
      showToast('Truck removed');
    } catch (err: any) {
      showToast('Delete error: ' + err.message);
    }
  };

  // New Day button: confirm -> set date to today with an empty list. Never delete old data.
  const handleNewDay = () => {
    if (!newDayConfirm) {
      setNewDayConfirm(true);
      setTimeout(() => setNewDayConfirm(false), 3500);
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    setDate(todayStr);
    setNewDayConfirm(false);
    showToast('Switched to New Day (Today)');
  };

  // Paste / Batch Insert trucks
  const handlePasteSubmit = async () => {
    if (!session) {
      showToast('⚠️ No session! Please log in first.');
      return;
    }

    const lines = pasteText.split('\n');
    const toInsertMap = new Map<string, {
      work_date: string;
      plate: string;
      country: 'OMN' | 'DXB';
      driver: string | null;
      driver_phone: string | null;
      gate1_at: null;
      gate2_at: null;
      pcs: null;
    }>();

    for (const line of lines) {
      const parsed = parseTruckLine(line);
      if (!parsed) continue;
      const key = `${parsed.plate}_${parsed.country}`;
      if (!toInsertMap.has(key)) {
        toInsertMap.set(key, {
          work_date: date,
          plate: parsed.plate,
          country: parsed.country,
          driver: parsed.driver,
          driver_phone: parsed.driver_phone,
          gate1_at: null,
          gate2_at: null,
          pcs: null,
        });
      }
    }

    const rows = Array.from(toInsertMap.values());
    if (rows.length === 0) {
      showToast('No valid truck lines found');
      return;
    }

    setIsPasting(true);

    try {
      const { data, error } = await supabase
        .from('trucks')
        .upsert(rows, {
          onConflict: 'work_date,plate,country',
          ignoreDuplicates: true,
        })
        .select();

      if (error) throw error;

      await loadTrucks();

      const added = data ? data.length : 0;
      const skipped = rows.length - added;

      if (skipped > 0) {
        showToast(`✓ ${added} added, ${skipped} skipped`);
      } else {
        showToast(`✓ ${added} trucks added!`);
      }

      setPasteText('');
      setShowPasteModal(false);
    } catch (err: any) {
      showToast('Error: ' + (err.message || 'Could not paste trucks'));
    } finally {
      setIsPasting(false);
    }
  };

  // Format and copy day report
  // Exact format specified in prompt:
  // 03-11-2026
  // (blank line)
  // KIZAD-CC
  // (blank line)
  // 3187YB.  OMN-07PC
  // (blank line)
  // LOADED
  const copyDayReport = () => {
    const loadedTrucks = trucks.filter((t) => Boolean(t.gate2_at));

    if (loadedTrucks.length === 0) {
      showToast('No loaded trucks (Gate 2) yet!');
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

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(reportText).then(() => {
        showToast(`📋 Copied Day Report (${loadedTrucks.length} Loaded)!`);
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
      showToast(`📋 Copied Day Report (${count} Loaded)!`);
    } catch {
      showToast('Copy blocked by browser');
    }
    el.remove();
  };

  // Download PDF Report with all truck details (Plate, Country, Driver, Phone, Gate 1, Gate 2, Wait time, PC, Owner)
  const downloadPdfReport = () => {
    if (trucks.length === 0) {
      showToast('No trucks for this day to download');
      return;
    }

    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      // Title & Header info
      const [year, month, day] = date.split('-');
      const formattedDate = `${day}-${month}-${year}`;

      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 24, 39); // #111827
      doc.text('GATE TRACKER — KIZAD CC DAILY REPORT', 14, 15);

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128); // #6b7280
      doc.text(`Date: ${formattedDate}   |   Exported by: ${currentWorker} (${currentUserEmail})`, 14, 21);

      // Summary Stats bar
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(31, 41, 55);
      const summaryText = `Total Trucks: ${sTotal}   •   Gate 1: ${sGate1}   •   Loaded (G2): ${sLoaded}   •   Avg Wait: ${avgWaitMin > 0 ? avgWaitMin + ' min' : '--'}`;
      doc.setFillColor(243, 244, 246);
      doc.roundedRect(14, 24, 269, 7, 2, 2, 'F');
      doc.text(summaryText, 18, 28.5);

      // Columns
      const headers = [
        ['#', 'Plate', 'Country', 'Driver Name', 'Phone Number', 'Gate 1 Time', 'Gate 2 (Loaded)', 'Duration / Wait', 'PC', ...(isAdmin ? ['Owner'] : [])]
      ];

      const rows = filteredTrucks.map((t, idx) => {
        const isG1 = Boolean(t.gate1_at);
        const isG2 = Boolean(t.gate2_at);
        const g1Time = formatDubaiTime(t.gate1_at);
        const g2Time = formatDubaiTime(t.gate2_at);

        let g1Col = '--';
        if (isG1) {
          g1Col = g1Time + (t.gate1_by ? ` (${t.gate1_by})` : '');
        }

        let g2Col = '--';
        if (isG2) {
          g2Col = g2Time + (t.gate2_by ? ` (${t.gate2_by})` : '');
        }

        let durationCol = 'Pending';
        if (isG1 && isG2) {
          durationCol = `Took ${getMinutesDiff(t.gate1_at!, t.gate2_at!)} min`;
        } else if (isG1 && !isG2) {
          durationCol = `Waiting ${getMinutesDiff(t.gate1_at!)} min`;
        }

        const pcsText = t.pcs != null ? (t.pcs < 10 ? `0${t.pcs} PC` : `${t.pcs} PC`) : '--';

        return [
          String(idx + 1),
          t.plate,
          t.country,
          t.driver || '--',
          t.driver_phone || '--',
          g1Col,
          g2Col,
          durationCol,
          pcsText,
          ...(isAdmin ? [t.owner_name || '--'] : [])
        ];
      });

      autoTable(doc, {
        head: headers,
        body: rows,
        startY: 34,
        styles: {
          fontSize: 8.5,
          cellPadding: 2.2,
          textColor: [17, 24, 39],
          lineColor: [229, 231, 235],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: [17, 24, 39],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
        },
        alternateRowStyles: {
          fillColor: [249, 250, 251],
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          1: { fontStyle: 'bold', halign: 'center', cellWidth: 26 },
          2: { halign: 'center', cellWidth: 18 },
          3: { cellWidth: 38 },
          4: { cellWidth: 32 },
          5: { halign: 'center', cellWidth: 32 },
          6: { halign: 'center', cellWidth: 34 },
          7: { halign: 'center', cellWidth: 30 },
          8: { halign: 'center', cellWidth: 18 },
          ...(isAdmin ? { 9: { halign: 'center', cellWidth: 22 } } : {})
        },
        didDrawPage: (data) => {
          doc.setFontSize(8);
          doc.setTextColor(156, 163, 175);
          doc.text(
            `Gate Tracker · Page ${data.pageNumber}`,
            14,
            doc.internal.pageSize.height - 8
          );
        }
      });

      doc.save(`Gate_Tracker_Report_${formattedDate}.pdf`);
      showToast('📥 Downloaded PDF Report!');
    } catch (err: any) {
      console.error('PDF error:', err);
      showToast('PDF error: ' + (err.message || 'Could not create PDF'));
    }
  };

  // Filter trucks by search and admin worker filter (kenz only)
  const filteredTrucks = useMemo(() => {
    let list = trucks;

    if (isAdmin && adminWorkerFilter !== 'all') {
      list = list.filter((t) => (t.owner_name || '').toLowerCase() === adminWorkerFilter.toLowerCase());
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.plate.toLowerCase().includes(q) ||
          (t.driver && t.driver.toLowerCase().includes(q)) ||
          (t.driver_phone && t.driver_phone.includes(q)) ||
          t.country.toLowerCase().includes(q)
      );
    }

    return list;
  }, [trucks, isAdmin, adminWorkerFilter, search]);

  // Top Counters
  const sTotal = trucks.length;
  const sGate1 = trucks.filter((t) => Boolean(t.gate1_at)).length;
  const sLoaded = trucks.filter((t) => Boolean(t.gate2_at)).length;

  // Average wait time for loaded trucks of the day
  const loadedWithBothGates = trucks.filter((t) => Boolean(t.gate1_at && t.gate2_at));
  const avgWaitMin = useMemo(() => {
    if (loadedWithBothGates.length === 0) return 0;
    const totalDiff = loadedWithBothGates.reduce(
      (acc, t) => acc + getMinutesDiff(t.gate1_at!, t.gate2_at!),
      0
    );
    return Math.round(totalDiff / loadedWithBothGates.length);
  }, [loadedWithBothGates]);

  // Kenz Admin: Per-worker summary (trucks / Gate 1 / Loaded)
  const workerSummaries = useMemo(() => {
    if (!isAdmin) return [];
    const map = new Map<string, { total: number; gate1: number; loaded: number }>();

    for (const t of trucks) {
      const w = t.owner_name || 'unassigned';
      const cur = map.get(w) || { total: 0, gate1: 0, loaded: 0 };
      cur.total += 1;
      if (t.gate1_at) cur.gate1 += 1;
      if (t.gate2_at) cur.loaded += 1;
      map.set(w, cur);
    }

    return Array.from(map.entries()).map(([name, stats]) => ({
      name,
      ...stats,
    }));
  }, [trucks, isAdmin]);

  // Loading indicator for initial session check
  if (authLoading) {
    return (
      <div style={{ height: '100dvh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f9' }}>
        <div style={{ color: '#6b7280', fontSize: '13px', fontWeight: 600 }}>Loading Gate Tracker…</div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // LOGIN SCREEN (Real Supabase Auth, no hardcoded worker list or passwords)
  // -------------------------------------------------------------------------
  if (!session) {
    return (
      <div style={{ 
        height: '100dvh', width: '100%', 
        display: 'flex', flexDirection: 'column', justifyContent: 'center', 
        padding: '20px', background: '#f5f6f9' 
      }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ 
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', 
            width: '54px', height: '54px', borderRadius: '16px', 
            background: '#ffffff', border: '1px solid #e5e7eb', 
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            marginBottom: '12px' 
          }}>
            <Truck size={28} color="#111827" />
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#111827', letterSpacing: '-0.4px' }}>Gate Tracker</h1>
          <p style={{ color: '#6b7280', fontSize: '12px', marginTop: '2px', fontWeight: 500 }}>KIZAD · CC · Gate System</p>
        </div>

        <div style={{ 
          background: '#ffffff', borderRadius: '20px', padding: '22px 20px', 
          border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' 
        }}>
          <h2 style={{ fontSize: '14px', fontWeight: 800, color: '#111827', marginBottom: '14px' }}>
            Worker Sign In
          </h2>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#4b5563', marginBottom: '5px' }}>
                Worker ID or Email
              </label>
              <input
                type="text"
                placeholder="e.g. kenz, w1, w3, w4"
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '11px 13px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '11px',
                  color: '#111827',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#4b5563', marginBottom: '5px' }}>
                Password
              </label>
              <input
                type="password"
                placeholder="Enter password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '11px 13px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '11px',
                  color: '#111827',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {loginError && (
              <div style={{ color: '#dc2626', fontSize: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <AlertCircle size={14} /> {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingAuth}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                border: 'none',
                background: '#111827',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: isSubmittingAuth ? 0.7 : 1
              }}
            >
              {isSubmittingAuth ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // MAIN DASHBOARD (Pure White Aesthetic, Shredded Compact Viewport)
  // -------------------------------------------------------------------------
  return (
    <div style={{ 
      height: '100dvh', width: '100%', 
      display: 'flex', flexDirection: 'column', 
      overflow: 'hidden', background: '#f5f6f9', position: 'relative' 
    }}>
      
      {/* iOS Add to Home Screen Banner Hint */}
      {showIosPrompt && (
        <div style={{
          background: '#111827', color: '#ffffff', padding: '7px 12px',
          fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', zIndex: 50, borderBottom: '1px solid #374151'
        }}>
          <span>📲 Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong></span>
          <button
            onClick={() => {
              localStorage.setItem('gt_pwa_hint_dismissed', '1');
              setShowIosPrompt(false);
            }}
            style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px 4px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 1. FIXED TOP HEADER BAR */}
      <header style={{ 
        flexShrink: 0, padding: '10px 12px 6px', 
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
                🟢 Live
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
              KIZAD · CC · <span style={{ fontWeight: 800, color: '#111827' }}>{currentWorker}</span>
              {isAdmin && <span style={{ marginLeft: '4px', fontSize: '9px', color: '#2563eb', fontWeight: 700 }}>[Admin]</span>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {/* Download PDF Report Button (on the left side of New day) */}
            <button
              onClick={downloadPdfReport}
              title="Download Day Report PDF"
              style={{
                height: '32px', padding: '0 8px', borderRadius: '10px',
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                color: '#111827',
                fontSize: '11px', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: '4px',
                cursor: 'pointer'
              }}
            >
              <Download size={12} />
              <span>PDF</span>
            </button>

            {/* New Day Button */}
            <button
              onClick={handleNewDay}
              title="Switch to New Day (Today)"
              style={{
                height: '32px', padding: '0 8px', borderRadius: '10px',
                background: newDayConfirm ? '#dbeafe' : '#f3f4f6',
                border: `1px solid ${newDayConfirm ? '#93c5fd' : '#e5e7eb'}`,
                color: newDayConfirm ? '#1d4ed8' : '#374151',
                fontSize: '11px', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: '4px',
                cursor: 'pointer'
              }}
            >
              <span>{newDayConfirm ? 'Today?' : 'New day'}</span>
            </button>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              title="Log out"
              style={{
                height: '32px', padding: '0 8px', borderRadius: '10px',
                background: '#f3f4f6', border: '1px solid #e5e7eb',
                color: '#111827', fontSize: '11px', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: '4px',
                cursor: 'pointer'
              }}
            >
              <span>{currentWorker}</span>
              <LogOut size={12} color="#6b7280" />
            </button>
          </div>
        </div>

        {/* Shredded Controls Line: Date input + Paste button + Add Truck button */}
        <div style={{ display: 'flex', gap: '5px', marginTop: '8px', alignItems: 'center' }}>
          <div style={{ flex: 1.3, minWidth: 0 }}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                width: '100%',
                minWidth: 0,
                padding: '6px 8px',
                borderRadius: '10px',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                color: '#111827',
                fontSize: '12px',
                fontWeight: 700,
                outline: 'none',
                boxSizing: 'border-box',
                appearance: 'none',
                WebkitAppearance: 'none',
                height: '34px'
              }}
            />
          </div>

          <button
            onClick={() => setShowPasteModal(true)}
            style={{
              height: '34px',
              padding: '0 9px', borderRadius: '10px',
              background: '#111827', color: '#ffffff',
              border: 'none', fontWeight: 700, fontSize: '11px',
              display: 'flex', alignItems: 'center', gap: '4px',
              cursor: 'pointer', whiteSpace: 'nowrap'
            }}
          >
            <span>📋 Paste</span>
          </button>

          <button
            onClick={() => setShowAdd(!showAdd)}
            style={{
              height: '34px',
              padding: '0 9px', borderRadius: '10px',
              background: showAdd ? '#111827' : '#ffffff',
              color: showAdd ? '#ffffff' : '#111827',
              border: '1px solid #e5e7eb',
              fontWeight: 700, fontSize: '11px',
              display: 'flex', alignItems: 'center', gap: '3px',
              cursor: 'pointer', whiteSpace: 'nowrap'
            }}
          >
            <Plus size={13} />
            <span>Truck</span>
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
                  flex: 2, padding: '7px 9px', borderRadius: '8px',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  color: '#111827', fontSize: '12px', outline: 'none'
                }}
                autoFocus
              />
              <select
                value={newCountry}
                onChange={(e) => setNewCountry(e.target.value as 'OMN' | 'DXB')}
                style={{
                  flex: 1, padding: '7px 5px', borderRadius: '8px',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  color: '#111827', fontSize: '12px', fontWeight: 700, outline: 'none'
                }}
              >
                <option value="OMN">OMN</option>
                <option value="DXB">DXB</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              <input
                type="text"
                placeholder="Driver name"
                value={newDriver}
                onChange={(e) => setNewDriver(e.target.value)}
                style={{
                  flex: 1.5, padding: '7px 9px', borderRadius: '8px',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  color: '#111827', fontSize: '12px', outline: 'none'
                }}
              />
              <input
                type="tel"
                placeholder="Phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                style={{
                  flex: 1.5, padding: '7px 9px', borderRadius: '8px',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  color: '#111827', fontSize: '12px', outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  flex: 1, padding: '7px', borderRadius: '8px',
                  background: '#111827', color: '#ffffff',
                  border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer'
                }}
              >
                Add
              </button>
            </div>
          </form>
        )}

        {/* Top Counters: Total, Gate 1, Loaded, Avg wait */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginTop: '6px' }}>
          <div style={{ 
            background: '#f9fafb', borderRadius: '8px', padding: '4px', 
            textAlign: 'center', border: '1px solid #e5e7eb'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#111827', fontFamily: 'JetBrains Mono' }}>
              {sTotal}
            </div>
            <div style={{ fontSize: '9px', fontWeight: 700, color: '#6b7280' }}>Total</div>
          </div>

          <div style={{ 
            background: '#eff6ff', borderRadius: '8px', padding: '4px', 
            textAlign: 'center', border: '1px solid #dbeafe'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#2563eb', fontFamily: 'JetBrains Mono' }}>
              {sGate1}
            </div>
            <div style={{ fontSize: '9px', fontWeight: 700, color: '#1e40af' }}>Gate 1</div>
          </div>

          <div style={{ 
            background: '#ecfdf5', borderRadius: '8px', padding: '4px', 
            textAlign: 'center', border: '1px solid #a7f3d0'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#059669', fontFamily: 'JetBrains Mono' }}>
              {sLoaded}
            </div>
            <div style={{ fontSize: '9px', fontWeight: 700, color: '#065f46' }}>Loaded</div>
          </div>

          <div style={{ 
            background: '#fef3c7', borderRadius: '8px', padding: '4px', 
            textAlign: 'center', border: '1px solid #fde68a'
          }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#b45309', fontFamily: 'JetBrains Mono' }}>
              {avgWaitMin > 0 ? `${avgWaitMin}m` : '--'}
            </div>
            <div style={{ fontSize: '9px', fontWeight: 700, color: '#92400e' }}>Avg wait</div>
          </div>
        </div>

        {/* Admin per-worker summary (for kenz only) */}
        {isAdmin && workerSummaries.length > 0 && (
          <div style={{ 
            marginTop: '6px', padding: '5px 8px', borderRadius: '8px',
            background: '#f3f4f6', border: '1px solid #e5e7eb',
            display: 'flex', gap: '8px', overflowX: 'auto', alignItems: 'center'
          }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: '#374151', whiteSpace: 'nowrap' }}>Workers:</span>
            {workerSummaries.map((w) => (
              <button
                key={w.name}
                type="button"
                onClick={() => setAdminWorkerFilter(adminWorkerFilter === w.name ? 'all' : w.name)}
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '6px',
                  border: '1px solid',
                  borderColor: adminWorkerFilter === w.name ? '#111827' : '#d1d5db',
                  background: adminWorkerFilter === w.name ? '#111827' : '#ffffff',
                  color: adminWorkerFilter === w.name ? '#ffffff' : '#374151',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {w.name}: {w.total}t · {w.gate1}g1 · {w.loaded}ld
              </button>
            ))}
          </div>
        )}

        {/* Slim Search Input */}
        <div style={{ position: 'relative', marginTop: '6px' }}>
          <Search size={13} color="#9ca3af" style={{ position: 'absolute', left: '10px', top: '9px' }} />
          <input
            type="text"
            placeholder="Search plate, driver, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 28px 6px 28px',
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '9px',
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
                position: 'absolute', right: '8px', top: '6px',
                background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer'
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      {/* 2. SCROLLABLE TRUCK LIST (ONLY this part scrolls) */}
      <main className="scroll-area" style={{ padding: '8px 10px 85px' }}>
        {filteredTrucks.length === 0 ? (
          <div style={{ 
            background: '#ffffff', borderRadius: '16px', padding: '30px 16px', 
            textAlign: 'center', border: '1px dashed #e5e7eb', marginTop: '10px' 
          }}>
            <Truck size={30} color="#9ca3af" style={{ margin: '0 auto 8px' }} />
            <p style={{ color: '#111827', fontWeight: 700, fontSize: '13px' }}>
              No trucks found
            </p>
            <p style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>
              Tap <strong>Paste</strong> or <strong>+ Truck</strong> above to add trucks.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {filteredTrucks.map((t) => {
              const isG1 = Boolean(t.gate1_at);
              const isG2 = Boolean(t.gate2_at);

              // Time & wait calculations
              const g1Time = formatDubaiTime(t.gate1_at);
              const g2Time = formatDubaiTime(t.gate2_at);

              let waitText = '';
              if (isG1 && !isG2) {
                const diff = getMinutesDiff(t.gate1_at!);
                waitText = `Waiting ${diff} min`;
              } else if (isG1 && isG2) {
                const diff = getMinutesDiff(t.gate1_at!, t.gate2_at!);
                waitText = `Took ${diff} min`;
              }

              return (
                <div
                  key={t.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: '13px',
                    padding: '8px 10px',
                    border: isG2 
                      ? '1px solid #a7f3d0' 
                      : isG1 
                      ? '1px solid #bfdbfe' 
                      : '1px solid #e5e7eb',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  {/* Row 1: Fixed height header (Plate + Country + Owner + Wait time pill + Delete) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '22px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                      <span style={{ 
                        fontFamily: 'JetBrains Mono, monospace', 
                        fontSize: '14px', 
                        fontWeight: 800, 
                        color: '#111827',
                        letterSpacing: '0.3px',
                        whiteSpace: 'nowrap'
                      }}>
                        {t.plate}
                      </span>

                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: '5px',
                          background: t.country === 'OMN' ? '#fef3c7' : '#dbeafe',
                          color: t.country === 'OMN' ? '#b45309' : '#1d4ed8',
                          border: `1px solid ${t.country === 'OMN' ? '#fde68a' : '#bfdbfe'}`,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {t.country}
                      </span>

                      {/* Admin: show owner name on card */}
                      {isAdmin && t.owner_name && (
                        <span style={{ 
                          fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '5px',
                          background: '#f3f4f6', color: '#4b5563',
                          whiteSpace: 'nowrap'
                        }}>
                          👤 {t.owner_name}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {/* Wait time pill */}
                      {waitText ? (
                        <span style={{ 
                          fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '5px',
                          background: isG2 ? '#ecfdf5' : '#eff6ff', 
                          color: isG2 ? '#065f46' : '#1e40af',
                          display: 'inline-flex', alignItems: 'center', gap: '3px',
                          whiteSpace: 'nowrap'
                        }}>
                          <Clock size={10} />
                          {waitText}
                        </span>
                      ) : null}

                      {/* Delete button */}
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
                  </div>

                  {/* Row 2: Driver Name input + Phone input with Call link */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 28px', gap: '5px', alignItems: 'center' }}>
                    <input
                      type="text"
                      key={`d-${t.id}`}
                      defaultValue={t.driver || ''}
                      placeholder="Driver name"
                      onBlur={(e) => handleDriverFieldsBlur(t.id, e.target.value, t.driver_phone || '')}
                      style={{
                        height: '28px',
                        padding: '0 7px',
                        borderRadius: '7px',
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        color: '#111827',
                        fontSize: '11px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />

                    <input
                      type="tel"
                      key={`p-${t.id}`}
                      defaultValue={t.driver_phone || ''}
                      placeholder="Phone"
                      onBlur={(e) => handleDriverFieldsBlur(t.id, t.driver || '', e.target.value)}
                      style={{
                        height: '28px',
                        padding: '0 7px',
                        borderRadius: '7px',
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        color: '#111827',
                        fontSize: '11px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />

                    {t.driver_phone ? (
                      <a
                        href={`tel:${t.driver_phone}`}
                        title={`Call ${t.driver_phone}`}
                        style={{
                          height: '28px', width: '28px',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: '6px', background: '#ecfdf5', border: '1px solid #a7f3d0',
                          color: '#059669', textDecoration: 'none', boxSizing: 'border-box'
                        }}
                      >
                        <Phone size={12} />
                      </a>
                    ) : (
                      <span style={{ width: '28px', height: '28px' }} />
                    )}
                  </div>

                  {/* Row 3: Gate 1 + Gate 2 (LOADED) + PC input */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr 54px', gap: '5px', alignItems: 'center' }}>
                    {/* Gate 1 Button */}
                    <button
                      type="button"
                      onClick={() => toggleGate1(t)}
                      style={{
                        height: '34px',
                        padding: '0 4px',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: isG1 ? '#2563eb' : '#e5e7eb',
                        background: isG1 ? '#2563eb' : '#f9fafb',
                        color: isG1 ? '#ffffff' : '#374151',
                        fontWeight: 700,
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      {isG1 && <Check size={12} strokeWidth={3} />}
                      <span>{isG1 ? `Gate 1 · ${g1Time}` : 'Gate 1'}</span>
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
                        padding: '0 4px',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: isG2 ? '#059669' : !isG1 ? '#edf0f4' : '#e5e7eb',
                        background: isG2 ? '#059669' : '#f9fafb',
                        color: isG2 ? '#ffffff' : !isG1 ? '#9ca3af' : '#111827',
                        opacity: !isG1 ? 0.5 : 1,
                        fontWeight: 700,
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        cursor: !isG1 ? 'not-allowed' : 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      {!isG1 ? (
                        <Lock size={11} />
                      ) : isG2 ? (
                        <Check size={12} strokeWidth={3} />
                      ) : null}
                      <span>{isG2 ? `G2 · ${g2Time}` : 'G2 · Load'}</span>
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
                      defaultValue={t.pcs ?? ''}
                      onBlur={(e) => handlePcsBlur(t, e.target.value)}
                      style={{
                        height: '34px',
                        width: '100%',
                        padding: '0 4px',
                        borderRadius: '8px',
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

      {/* Undo Toast (Feature 2: positioned above bottom bar) */}
      {undoState && (
        <div style={{
          position: 'absolute',
          bottom: '72px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#111827',
          color: '#ffffff',
          padding: '8px 12px',
          borderRadius: '11px',
          fontSize: '11px',
          fontWeight: 700,
          zIndex: 80,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          whiteSpace: 'nowrap'
        }}>
          <span>{undoState.actionText}</span>
          <button
            onClick={handleUndo}
            style={{
              background: '#ffffff',
              color: '#111827',
              border: 'none',
              borderRadius: '7px',
              padding: '3px 8px',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer'
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* 3. FIXED BOTTOM BAR (Copy Day Report) */}
      <footer
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '10px 14px calc(10px + var(--safe-bottom))',
          background: 'linear-gradient(to top, #ffffff 80%, rgba(255, 255, 255, 0))',
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 40
        }}
      >
        <button
          onClick={copyDayReport}
          style={{
            width: '100%',
            maxWidth: '380px',
            padding: '13px',
            borderRadius: '13px',
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
          <span>Copy Day Report ({sLoaded} Loaded)</span>
        </button>
      </footer>

      {/* Toast Notification */}
      {toastMsg && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111827',
            color: '#ffffff',
            padding: '7px 12px',
            borderRadius: '9px',
            fontSize: '11px',
            fontWeight: 700,
            zIndex: 999,
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
            whiteSpace: 'nowrap'
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* Paste Modal */}
      {showPasteModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px', zIndex: 100
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '16px', padding: '16px',
            width: '100%', maxWidth: '380px', border: '1px solid #e5e7eb',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '4px' }}>Paste Trucks</h3>
            <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>
              Format: <code>PLATE COUNTRY DRIVER PHONE</code><br />
              Example: <code>3187YB OMN Ahmed Ali 96891234567</code><br />
              (Also supports Excel copy-paste with tabs)
            </p>
            <textarea
              rows={6}
              placeholder="3187YB OMN Ahmed Ali 96891234567&#10;39263 DXB Rashid 0501234567"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              style={{
                width: '100%', padding: '9px', borderRadius: '9px',
                background: '#f9fafb', border: '1px solid #e5e7eb',
                color: '#111827', fontFamily: 'JetBrains Mono', fontSize: '11px',
                outline: 'none', marginBottom: '10px', boxSizing: 'border-box'
              }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={handlePasteSubmit}
                disabled={isPasting}
                style={{
                  flex: 1, padding: '9px', borderRadius: '9px',
                  background: '#111827', color: '#ffffff',
                  border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                  opacity: isPasting ? 0.7 : 1
                }}
              >
                {isPasting ? 'Saving to Database…' : 'Add to Database'}
              </button>
              <button
                onClick={() => setShowPasteModal(false)}
                style={{
                  padding: '9px 12px', borderRadius: '9px',
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
