import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

interface Task {
  id: string;
  text: string;
  type: 'active' | 'pile' | 'lookup';
  completed: number;
  progress: number;
  createdAt: number;
  updatedAt: number;
}

interface Session {
  id: string;
  taskId: string;
  taskName: string;
  startTime: number;
  endTime: number;
  actualFocusMs: number;
  endingStatus: 'completed' | 'distracted' | 'paused';
}

interface Interruption {
  id: string;
  sessionId: string;
  timestamp: number;
  choiceMade: 'return' | 'switch' | 'capture';
}

interface DistractionLog {
  id: string;
  timestamp: number;
  text: string;
  type: 'lookup' | 'distraction';
  taskId?: string;
  taskName?: string;
}

interface ShortcutEntry {
  id: string;
  name: string;
  keys: string;
  category: 'global' | 'local';
}

const DEFAULT_SHORTCUTS: ShortcutEntry[] = [
  { id: 'shortcut.globalCapture', name: 'Quick Capture (global)', keys: 'Alt+Space', category: 'global' },
  { id: 'shortcut.localAddTask', name: 'Add Task', keys: 'Ctrl+Enter', category: 'local' },
  { id: 'shortcut.localPause', name: 'Pause Task', keys: 'Alt+F', category: 'local' },
  { id: 'shortcut.localCheckin', name: 'Manual Check-in', keys: 'Alt+C', category: 'local' },
  { id: 'shortcut.localMarkDone', name: 'Mark Done', keys: 'Alt+D', category: 'local' },
  { id: 'shortcut.localEscape', name: 'Close / Cancel', keys: 'Escape', category: 'local' },
];

function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
  const key = parts.pop()!;
  const eKey = e.key.toLowerCase();
  const isLetter = /^[a-z]$/.test(key);
  if (isLetter ? eKey !== key : e.key !== shortcut) {
    if (isLetter) { if (eKey !== key) return false; }
    else if (e.key !== shortcut && e.key !== key) return false;
  }
  const mods: Record<string, boolean> = {
    ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey,
  };
  const required = new Set(parts);
  for (const [m, v] of Object.entries(mods)) {
    if (required.has(m) !== v) return false;
  }
  return true;
}

const App: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(20 * 60);
  const [staleTasks, setStaleTasks] = useState<Task[]>([]);
  const [shortcuts, setShortcuts] = useState<ShortcutEntry[]>(DEFAULT_SHORTCUTS);
  const [showSettings, setShowSettings] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'tasks' | 'insights'>('tasks');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [interruptions, setInterruptions] = useState<Interruption[]>([]);
  const [distractionLogs, setDistractionLogs] = useState<DistractionLog[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const settingsRef = useRef<HTMLDivElement>(null);

  const activeTask = tasks.find(t => t.id === activeTaskId);
  const timerPercentage = (timeLeft / (20 * 60)) * 100;

  const loadTasks = useCallback(async () => {
    try {
      const savedTasks = await window.electron.getTasks();
      const formattedTasks = savedTasks.map((t: Task) => ({ ...t, completed: !!t.completed }));
      setTasks(formattedTasks);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  }, []);

  const checkStaleTasks = useCallback(async () => {
    try {
      const stale = await window.electron.getStaleTasks();
      setStaleTasks(stale);
    } catch (error) {
      console.error('Failed to check stale tasks:', error);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([
        window.electron.getSessions(),
        window.electron.getInterruptions()
      ]);
      setSessions(s);
      setInterruptions(i);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  }, []);

  const loadDistractionLogs = useCallback(async () => {
    try {
      const logs = await window.electron.getDistractionLogs();
      setDistractionLogs(logs);
    } catch (error) {
      console.error('Failed to load distraction logs:', error);
    }
  }, []);

  const loadShortcuts = useCallback(async () => {
    try {
      const settings = await window.electron.getSettings();
      if (settings && settings.length > 0) {
        setShortcuts(prev => prev.map(s => {
          const match = settings.find((st: { key: string; value: string }) => st.key === s.id);
          return match ? { ...s, keys: match.value } : s;
        }));
      }
    } catch (error) {
      console.error('Failed to load shortcuts:', error);
    }
  }, []);

  const getKeys = (id: string) => shortcuts.find(s => s.id === id)?.keys || '';

  useEffect(() => {
    window.electron.onTaskUpdated(() => { loadTasks(); loadAnalytics(); loadDistractionLogs(); });
    window.electron.onTimerTick((seconds: number) => setTimeLeft(seconds));
    window.electron.onShortcutsChanged(loadShortcuts);

    loadTasks();
    checkStaleTasks();
    loadShortcuts();
    loadAnalytics();
    loadDistractionLogs();

    window.electron.getTimerState().then(state => {
      setTimeLeft(state.secondsLeft);
    });
  }, [loadTasks, checkStaleTasks, loadShortcuts, loadAnalytics, loadDistractionLogs]);

  useEffect(() => {
    if (showSettings && settingsRef.current) {
      settingsRef.current.focus();
    }
  }, [showSettings]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingShortcut || editingTaskId) return;

      if (matchShortcut(e, getKeys('shortcut.localAddTask'))) {
        e.preventDefault();
        addTask();
      } else if (matchShortcut(e, getKeys('shortcut.localPause'))) {
        e.preventDefault();
        pauseActiveTask();
      } else if (matchShortcut(e, getKeys('shortcut.localCheckin'))) {
        e.preventDefault();
        triggerManualCheckin();
      } else if (matchShortcut(e, getKeys('shortcut.localMarkDone'))) {
        e.preventDefault();
        markActiveDone();
      } else if (matchShortcut(e, getKeys('shortcut.localEscape'))) {
        if (showSettings) { setShowSettings(false); return; }
        setInputValue('');
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[0-9]$/.test(e.key)) {
        const idx = e.key === '0' ? 9 : parseInt(e.key) - 1;
        const numbered = tasks.filter(t => t.type === 'pile' && !t.completed);
        const target = numbered[idx];
        if (target) {
          e.preventDefault();
          setAsActive(target.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tasks, inputValue, activeTaskId, shortcuts, showSettings, editingShortcut, editingTaskId]);

  const addTask = async () => {
    if (!inputValue.trim()) return;
    const newTask: Task = {
      id: crypto.randomUUID(),
      text: inputValue,
      type: 'pile',
      completed: 0,
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await window.electron.addTask(newTask);
      setTasks(prev => [...prev, newTask]);
      setInputValue('');

      if (!activeTaskId) {
        setActiveTaskId(newTask.id);
        await window.electron.setActiveTask({ id: newTask.id, text: newTask.text });
      }
    } catch (error) {
      console.error('Failed to add task:', error);
    }
  };

  const deleteTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electron.deleteTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
      if (activeTaskId === id) {
        setActiveTaskId(null);
        await window.electron.setActiveTask({ id: null, text: '' });
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const markActiveDone = async () => {
    if (!activeTaskId) return;

    try {
      await window.electron.updateTask(activeTaskId, {
        completed: true,
        progress: 100,
        updatedAt: Date.now()
      });

      setTasks(prev => prev.map(t => t.id === activeTaskId ? { ...t, completed: 1, progress: 100 } : t));

      const updatedTasks = tasks.map(t => t.id === activeTaskId ? { ...t, completed: 1, progress: 100 } : t);
      const nextTask = updatedTasks.find(t => t.id !== activeTaskId && !t.completed && t.type === 'pile');

      const nextId = nextTask?.id || null;
      setActiveTaskId(nextId);
      await window.electron.setActiveTask({
        id: nextId,
        text: nextTask?.text || ''
      });
    } catch (error) {
      console.error('Failed to mark task as done:', error);
    }
  };

  const incrementProgress = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const current = task.progress ?? 0;
    const next = current >= 100 ? 0 : Math.min(current + 25, 100);
    try {
      await window.electron.updateTask(id, {
        progress: next,
        completed: next >= 100 ? 1 : 0,
        updatedAt: Date.now()
      });
      setTasks(prev => prev.map(t => t.id === id ? { ...t, progress: next, completed: next >= 100 ? 1 : 0 } : t));
      if (next >= 100 && activeTaskId === id) {
        const remaining = tasks.filter(t => t.id !== id && !t.completed && t.type === 'pile');
        const nextTask = remaining[0] || null;
        setActiveTaskId(nextTask?.id || null);
        await window.electron.setActiveTask({ id: nextTask?.id || null, text: nextTask?.text || '' });
      }
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  };

  const decrementProgress = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const current = task.progress ?? 0;
    const prev = current <= 0 ? 0 : Math.max(current - 25, 0);
    try {
      await window.electron.updateTask(id, {
        progress: prev,
        completed: 0,
        updatedAt: Date.now()
      });
      setTasks(prevTasks => prevTasks.map(t => t.id === id ? { ...t, progress: prev, completed: 0 } : t));
    } catch (error) {
      console.error('Failed to decrement progress:', error);
    }
  };

  const restoreTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electron.restoreTask(id);
      setTasks(prev => prev.map(t => t.id === id ? { ...t, progress: 0, completed: 0 } : t));
      if (activeTaskId === id) {
        setActiveTaskId(null);
        await window.electron.setActiveTask({ id: null, text: '' });
      }
    } catch (error) {
      console.error('Failed to restore task:', error);
    }
  };

  const startEditTask = (id: string, text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTaskId(id);
    setEditText(text);
  };

  const saveEditTask = async (id: string) => {
    if (!editText.trim()) { setEditingTaskId(null); return; }
    try {
      await window.electron.updateTask(id, { text: editText, updatedAt: Date.now() });
      setTasks(prev => prev.map(t => t.id === id ? { ...t, text: editText } : t));
      setEditingTaskId(null);
    } catch (error) {
      console.error('Failed to edit task:', error);
    }
  };

  const setAsActive = async (id: string) => {
    setActiveTaskId(id);
    const task = tasks.find(t => t.id === id);
    if (task) {
      await window.electron.setActiveTask({ id: task.id, text: task.text });
    }
  };

  const pauseActiveTask = async () => {
    if (!activeTaskId) return;
    window.electron.respondToCheckin('pause');
    setActiveTaskId(null);
  };

  const triggerManualCheckin = () => window.electron.triggerCheckin();

  const exportData = async () => {
    try {
      const result = await window.electron.exportAnalytics();
      if (result.success) {
        alert('Analytics exported successfully to ' + result.path);
      } else {
        alert('Export canceled or failed.');
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export analytics.');
    }
  };

  const snoozeStaleTask = async (id: string) => {
    try {
      await window.electron.snoozeTask(id);
      setStaleTasks(prev => prev.filter(t => t.id !== id));
    } catch (error) {
      console.error('Failed to snooze task:', error);
    }
  };

  const deleteStaleTask = async (id: string) => {
    try {
      await window.electron.deleteTask(id);
      setStaleTasks(prev => prev.filter(t => t.id !== id));
      loadTasks();
    } catch (error) {
      console.error('Failed to delete stale task:', error);
    }
  };

  const doStaleTaskNow = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
      setActiveTaskId(id);
      await window.electron.setActiveTask({ id: task.id, text: task.text });
      setStaleTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  const clarifyTask = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
      setInputValue(task.text);
      setStaleTasks(prev => prev.filter(t => t.id !== id));
    }
  };

  const startEditShortcut = (id: string) => {
    setEditingShortcut(id);
  };

  const handleShortcutKeydown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (editingShortcut) {
        setEditingShortcut(null);
      } else {
        setShowSettings(false);
      }
      return;
    }

    if (!editingShortcut) return;
    e.preventDefault();
    e.stopPropagation();

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    const key = e.key === ' ' ? 'Space' : e.key;
    parts.push(key);
    const newKeys = parts.join('+');

    setShortcuts(prev => prev.map(s => s.id === editingShortcut ? { ...s, keys: newKeys } : s));
    setEditingShortcut(null);

    try {
      await window.electron.setSetting(editingShortcut, newKeys);
      if (editingShortcut.startsWith('shortcut.global')) {
        window.electron.shortcutsChanged();
      }
    } catch (error) {
      console.error('Failed to save shortcut:', error);
    }
  };

  // ---- Analytics computations ----
  const analyticsData = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;

    // Daily focus over last 30 days
    const dailyFocus: { date: string; minutes: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = new Date(now - i * dayMs);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + dayMs;
      const totalMs = sessions
        .filter(s => s.startTime >= dayStart.getTime() && s.startTime < dayEnd)
        .reduce((sum, s) => sum + s.actualFocusMs, 0);
      dailyFocus.push({ date: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), minutes: Math.round(totalMs / 60000) });
    }
    const maxDailyMin = Math.max(...dailyFocus.map(d => d.minutes), 1);

    // 7-day rolling moving average
    const movingAvg = dailyFocus.map((_, i) => {
      const slice = dailyFocus.slice(Math.max(0, i - 6), i + 1);
      return slice.reduce((s, d) => s + d.minutes, 0) / slice.length;
    });

    // Hourly aggregation
    const hourlyTotals = new Array(24).fill(0);
    const hourlyCounts = new Array(24).fill(0);
    sessions.forEach(s => {
      const h = new Date(s.startTime).getHours();
      hourlyTotals[h] += s.actualFocusMs;
      hourlyCounts[h]++;
    });
    const maxHourlyMin = Math.max(...hourlyTotals.map(v => v), 1);

    // Compute latency after distraction: for each distraction session, find next session start
    const latencies: { hour: number; latencyMin: number }[] = [];
    for (let i = 0; i < sessions.length - 1; i++) {
      if (sessions[i].endingStatus === 'distracted') {
        const nextSession = sessions.slice(i + 1).find(s => s.startTime > sessions[i].endTime);
        if (nextSession) {
          const latency = (nextSession.startTime - sessions[i].endTime) / 60000;
          if (latency >= 0 && latency < 240) {
            latencies.push({ hour: new Date(sessions[i].endTime).getHours(), latencyMin: Math.round(latency) });
          }
        }
      }
    }
    const medianLatency = latencies.length > 0
      ? latencies.map(l => l.latencyMin).sort((a, b) => a - b)[Math.floor(latencies.length / 2)]
      : 0;

    // KPIs
    const totalInterruptions = interruptions.length;
    const returnChoices = interruptions.filter(i => i.choiceMade === 'return').length;
    const arr = totalInterruptions > 0 ? Math.round((returnChoices / totalInterruptions) * 100) : 0;

    // Task Complexity Variance: correlate task name length with distracted sessions
    const taskSessions: Record<string, { distracted: number; total: number }> = {};
    sessions.forEach(s => {
      if (!taskSessions[s.taskId]) taskSessions[s.taskId] = { distracted: 0, total: 0 };
      taskSessions[s.taskId].total++;
      if (s.endingStatus === 'distracted') taskSessions[s.taskId].distracted++;
    });
    const tasksWithData = tasks.filter(t => taskSessions[t.id]);
    const distractionRates = tasksWithData.map(t => ({
      length: t.text.length,
      rate: (taskSessions[t.id]?.distracted || 0) / (taskSessions[t.id]?.total || 1),
    }));
    const avgShortRate = distractionRates.filter(d => d.length < 30).reduce((s, d) => s + d.rate, 0) / Math.max(distractionRates.filter(d => d.length < 30).length, 1);
    const avgLongRate = distractionRates.filter(d => d.length >= 30).reduce((s, d) => s + d.rate, 0) / Math.max(distractionRates.filter(d => d.length >= 30).length, 1);
    const taskVariance = distractionRates.length > 0 ? Math.round((avgLongRate - avgShortRate) * 100) : 0;

    // Task completion rate
    const pileTasks = tasks.filter(t => t.type === 'pile');
    const avgProgress = pileTasks.length > 0
      ? Math.round(pileTasks.reduce((s, t) => s + (t.progress ?? (t.completed ? 100 : 0)), 0) / pileTasks.length)
      : 0;
    const doneCount = pileTasks.filter(t => t.completed || (t.progress ?? 0) >= 100).length;
    const completionRate = pileTasks.length > 0 ? Math.round((doneCount / pileTasks.length) * 100) : 0;

    // AEI: total focus minutes / total runtime minutes
    const totalFocusMin = sessions.reduce((s, sess) => s + sess.actualFocusMs, 0) / 60000;
    const totalRuntimeMin = sessions
      .filter(s => s.endTime > s.startTime)
      .reduce((s, sess) => s + (sess.endTime - sess.startTime), 0) / 60000;
    const aei = totalRuntimeMin > 0 ? Math.round((totalFocusMin / totalRuntimeMin) * 100) : 100;

    return { dailyFocus, movingAvg, maxDailyMin, hourlyTotals, maxHourlyMin, latencies, medianLatency, arr, taskVariance, aei, totalInterruptions, avgProgress, completionRate };
  }, [sessions, interruptions, tasks]);

  // ---- Time-based greeting ----
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  // ---- SVG chart dimensions ----
  const chartW = 600;
  const chartH = 180;
  const pad = { t: 10, r: 10, b: 30, l: 40 };
  const plotW = chartW - pad.l - pad.r;
  const plotH = chartH - pad.t - pad.b;

  // ---- SVG chart helpers ----
  const linePath = (points: number[], maxVal: number) => {
    if (points.length < 2) return '';
    const xScale = (i: number) => pad.l + (i / Math.max(points.length - 1, 1)) * plotW;
    const yScale = (v: number) => pad.t + plotH - (v / Math.max(maxVal, 1)) * plotH;
    return points.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i)},${yScale(v)}`).join(' ');
  };

  const barWidth = plotW / 24;

  return (
    <div className="h-screen flex flex-col p-6 space-y-6 overflow-hidden bg-[#0f172a] text-slate-200 font-sans">
      {/* Stale Task Review Modal */}
      {staleTasks.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full mx-4 max-h-[70vh] flex flex-col shadow-2xl">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold text-white">Tasks Needing Review</h3>
              <p className="text-sm text-slate-400 mt-1">
                You have {staleTasks.length} task{staleTasks.length > 1 ? 's' : ''} that havent been touched in 3 days.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {staleTasks.map(task => (
                <div key={task.id} className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
                  <p className="text-sm text-slate-200 mb-2 line-clamp-2">{task.text}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => doStaleTaskNow(task.id)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-700/60 text-emerald-300 hover:bg-emerald-700 font-medium transition-colors">
                      Do now
                    </button>
                    <button onClick={() => snoozeStaleTask(task.id)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 font-medium transition-colors">
                      Still relevant
                    </button>
                    <button onClick={() => clarifyTask(task.id)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-700/60 text-amber-300 hover:bg-amber-700 font-medium transition-colors">
                      Too vague
                    </button>
                    <button onClick={() => deleteStaleTask(task.id)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-red-900/60 text-red-300 hover:bg-red-800 font-medium transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setStaleTasks([])}
              className="mt-3 text-sm text-slate-500 hover:text-slate-300 transition-colors font-medium">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Shortcuts Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div ref={settingsRef} tabIndex={-1}
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl outline-none"
            onKeyDown={handleShortcutKeydown}>
            <h3 className="text-lg font-semibold text-white mb-4">Keyboard Shortcuts</h3>
            <div className="space-y-1 mb-4">
              {shortcuts.map(s => (
                <div key={s.id}
                  onClick={() => !editingShortcut && startEditShortcut(s.id)}
                  className={`flex justify-between items-center px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                    editingShortcut === s.id
                      ? 'bg-blue-600/20 border border-blue-500/50 ring-1 ring-blue-500/30'
                      : 'hover:bg-slate-800/60 border border-transparent'
                  }`}>
                  <div>
                    <span className="text-sm text-slate-200">{s.name}</span>
                    <span className={`text-[10px] ml-2 ${s.category === 'global' ? 'text-amber-400' : 'text-slate-500'}`}>
                      {s.category === 'global' ? 'global' : 'local'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {editingShortcut === s.id ? (
                      <span className="text-xs text-blue-400 font-mono animate-pulse">Press new keys...</span>
                    ) : (
                      <kbd className="px-2.5 py-1 bg-slate-800 rounded-lg text-xs font-mono text-slate-300 border border-slate-700">
                        {s.keys}
                      </kbd>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              {editingShortcut && (
                <button onClick={() => setEditingShortcut(null)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">
                  Cancel
                </button>
              )}
              <button onClick={() => setShowSettings(false)}
                className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-800/50 rounded-2xl p-1 w-fit mx-auto">
        <button onClick={() => setActiveTab('tasks')}
          className={`px-5 py-2 text-sm font-medium rounded-xl transition-all ${activeTab === 'tasks' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
          Tasks
        </button>
        <button onClick={() => setActiveTab('insights')}
          className={`px-5 py-2 text-sm font-medium rounded-xl transition-all ${activeTab === 'insights' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
          Data & Insights
        </button>
      </div>

      {activeTab === 'tasks' && (
      <>
      {/* Hero Section: The Current Task Loop */}
      <section className="glass-panel p-8 text-center space-y-6 transition-all animate-in fade-in slide-in-from-top-4 duration-700 relative overflow-hidden">
        <div className="relative z-10 space-y-4">
          <div className="flex justify-between items-start">
            <div />
            <h2 className="text-xs uppercase tracking-[0.2em] text-slate-500 font-bold">Currently Working On</h2>
            <button onClick={() => setShowSettings(true)}
              className="btn-icon text-slate-500 hover:text-white transition-colors"
              title="Keyboard Shortcuts"
              aria-label="Open keyboard shortcuts">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h.01M10 16h.01M14 16h.01M18 16h.01"/>
              </svg>
            </button>
          </div>

          {activeTask ? (
            <div className="space-y-8">
              <h1 className="text-4xl font-light text-white tracking-tight">
                {activeTask.text}
              </h1>

              {/* Visual Timer Bar */}
              <div className="w-full max-w-md mx-auto space-y-2">
                <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
                    style={{ width: `${timerPercentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-slate-500 font-medium">
                  <span>Focus Session</span>
                  <span>{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
                </div>
              </div>

              <div className="flex justify-center gap-3">
                <button onClick={markActiveDone}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-full transition-all hover:scale-105 active:scale-95 font-medium">
                  Done ({getKeys('shortcut.localMarkDone')})
                </button>
                <button onClick={pauseActiveTask}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-full transition-all hover:scale-105 active:scale-95 font-medium">
                  Pause ({getKeys('shortcut.localPause')})
                </button>
                <button onClick={triggerManualCheckin}
                  className="px-6 py-2 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white text-sm rounded-full transition-all hover:scale-105 active:scale-95 font-medium">
                  Check-in ({getKeys('shortcut.localCheckin')})
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-slate-400 italic text-lg">No active task. What's next?</p>
              <div className="flex justify-center">
                <input
                  autoFocus
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTask()}
                  placeholder="Type a task and hit Enter..."
                  className="bg-slate-800/50 border border-slate-700 rounded-2xl px-6 py-3 w-80 text-center input-focus text-white text-lg shadow-xl transition-all focus:ring-2 focus:ring-blue-500/50 outline-none"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-6 flex-1 overflow-hidden">
        {/* Task Pile */}
        <section className="glass-panel p-6 flex flex-col space-y-4 overflow-hidden">
          <h3 className="text-sm font-bold text-slate-400 flex justify-between items-center uppercase tracking-wider">
            Task Pile
            <span className="text-[10px] font-normal opacity-60">{getKeys('shortcut.localAddTask')} to add</span>
          </h3>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            {tasks.filter(t => t.type === 'pile').length === 0 ? (
              <p className="text-xs text-slate-600 italic text-center py-4">Pile is empty.</p>
            ) : (
              (() => {
        const numbered = tasks.filter(t => t.type === 'pile' && !t.completed && (t.progress ?? 0) < 100);
                const completed = tasks.filter(t => t.type === 'pile' && t.completed);
                return [...numbered, ...completed].map((task, i) => {
                  const num = i < numbered.length ? (i < 9 ? (i + 1).toString() : i === 9 ? '0' : null) : null;
                  const pct = task.progress ?? (task.completed ? 100 : 0);
                  return (
                    <div key={task.id} onClick={() => !editingTaskId && setAsActive(task.id)}
                      className={`group p-3 rounded-xl transition-all border ${activeTaskId === task.id ? 'bg-blue-600/20 border-blue-500/50 text-white shadow-lg shadow-blue-500/10' : 'bg-slate-800/40 border-transparent hover:border-slate-700 text-slate-400 hover:text-slate-200'} ${task.completed ? 'opacity-50' : ''} ${!editingTaskId ? 'cursor-pointer' : ''}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {num && <span className="flex-shrink-0 w-5 h-5 rounded-md bg-slate-700/60 text-slate-400 text-[11px] font-mono font-bold flex items-center justify-center">{num}</span>}
                        {editingTaskId === task.id ? (
                          <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEditTask(task.id); if (e.key === 'Escape') setEditingTaskId(null); }}
                            onBlur={() => saveEditTask(task.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 bg-slate-700/60 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500/50"/>
                        ) : (
                          <span className={`flex-1 min-w-0 truncate ${task.completed ? 'line-through' : ''}`}>{task.text}</span>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!task.completed && pct < 100 && (
                            <span className="text-[10px] font-mono text-slate-500">{pct}%</span>
                          )}
                          <button onClick={(e) => startEditTask(task.id, task.text, e)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-blue-800/40 text-slate-500 hover:text-blue-300"
                            title="Edit task" aria-label="Edit task">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          {task.completed && (
                            <button onClick={(e) => restoreTask(task.id, e)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-amber-800/40 text-slate-500 hover:text-amber-300"
                              title="Restore task (clear progress & sessions)" aria-label="Restore task">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                              </svg>
                            </button>
                          )}
                          <button onClick={(e) => deleteTask(task.id, e)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-red-900/40 text-slate-500 hover:text-red-300"
                            title="Delete task" aria-label="Delete task">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                      {!task.completed && pct < 100 && (
                        <div onClick={(e) => !editingTaskId && incrementProgress(task.id, e)}
                          onContextMenu={(e) => { e.preventDefault(); !editingTaskId && decrementProgress(task.id, e); }}
                          className="mt-1.5 h-1.5 w-full bg-slate-700/50 rounded-full overflow-hidden cursor-pointer group/progress hover:bg-slate-700/70 transition-colors"
                          title="Left-click to +25%, right-click to -25%">
                          <div className="h-full bg-emerald-500/60 rounded-full transition-all duration-300" style={{ width: `${pct}%` }}/>
                        </div>
                      )}
                    </div>
                  );
                });
              })()
            )}
          </div>
        </section>

        {/* Look Up Later */}
        <section className="glass-panel p-6 flex flex-col space-y-4 overflow-hidden">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Look Up Later</h3>
            <div className="flex gap-2">
              <button onClick={exportData}
                className="text-[10px] uppercase tracking-widest text-slate-500 hover:text-white transition-colors font-bold"
                title="Export JSON telemetry dump or multi-section CSV for external analysis">
                Export Data
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            {tasks.filter(t => t.type === 'lookup').map(task => (
              <div key={task.id}
                className="group p-3 rounded-xl bg-slate-800/40 border border-transparent hover:border-slate-700 text-slate-400 text-sm transition-all hover:text-slate-200 cursor-default flex justify-between items-start gap-2">
                <span className="flex-1 min-w-0">{task.text}</span>
                <button onClick={(e) => deleteTask(task.id, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-red-900/40 text-slate-500 hover:text-red-300 flex-shrink-0"
                  title="Delete" aria-label="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            ))}
            {tasks.filter(t => t.type === 'lookup').length === 0 && (
              <p className="text-xs text-slate-600 italic text-center py-4">Nothing to look up.</p>
            )}
          </div>
        </section>
      </div>
      </>
      )}

      {activeTab === 'insights' && (
      <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar">
        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="glass-panel p-5 rounded-2xl space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500 font-bold">
              <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
              ARR
            </div>
            <div className="text-3xl font-light text-white">{analyticsData.arr}%</div>
            <div className="text-[10px] text-slate-500 leading-tight" title="Attentional Resilience Rate: percentage of distraction events where you chose to return to your task">
              {analyticsData.totalInterruptions > 0
                ? `${analyticsData.arr}% of ${analyticsData.totalInterruptions} distraction events ended with a return to task`
                : 'No interruption data yet'}
            </div>
          </div>
          <div className="glass-panel p-5 rounded-2xl space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500 font-bold">
              <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              Task Variance
            </div>
            <div className="text-3xl font-light text-white">{analyticsData.taskVariance > 0 ? '+' : ''}{analyticsData.taskVariance}%</div>
            <div className="text-[10px] text-slate-500 leading-tight" title="Difference in distraction rate between short tasks (&lt;30 chars) and long tasks (30+ chars)">
              {analyticsData.taskVariance > 0 ? 'Longer tasks linked to higher distraction rate' : analyticsData.taskVariance < 0 ? 'Shorter tasks linked to higher distraction rate' : 'No correlation detected'}
            </div>
          </div>
          <div className="glass-panel p-5 rounded-2xl space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500 font-bold">
              <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              AEI
            </div>
            <div className="text-3xl font-light text-white">{analyticsData.aei}%</div>
            <div className="text-[10px] text-slate-500 leading-tight" title="Attentional Efficiency Index: focus minutes divided by total runtime minutes">
              {analyticsData.aei}% of active session time was spent actually focused
            </div>
          </div>
          <div className="glass-panel p-5 rounded-2xl space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500 font-bold">
              <svg className="w-3.5 h-3.5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Completion Rate
            </div>
            <div className="text-3xl font-light text-white">{analyticsData.completionRate}%</div>
            <div className="text-[10px] text-slate-500 leading-tight" title="Percentage of all pile tasks that have been completed">
              {analyticsData.avgProgress}% average progress across {tasks.filter(t => t.type === 'pile').length} tasks
            </div>
          </div>
        </div>

        {/* Chart: 7-Day Rolling Moving Average */}
        <div className="glass-panel p-5 rounded-2xl space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Focus Trend (30 days)</h3>
            <div className="flex gap-4 text-[10px] text-slate-600">
              <span><span className="inline-block w-3 h-0.5 bg-blue-500/30 mr-1 align-middle"/>Daily</span>
              <span><span className="inline-block w-3 h-0.5 bg-blue-400 mr-1 align-middle"/>7-day avg</span>
            </div>
          </div>
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            {/* Y axis gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map(pct => {
              const y = pad.t + plotH - pct * plotH;
              return (
                <g key={pct}>
                  <line x1={pad.l} y1={y} x2={chartW - pad.r} y2={y} stroke="#1e293b" strokeWidth="1"/>
                  <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-slate-600 text-[9px]">{Math.round(analyticsData.maxDailyMin * pct)}m</text>
                </g>
              );
            })}
            {/* Raw daily line */}
            <path d={linePath(analyticsData.dailyFocus.map(d => d.minutes), analyticsData.maxDailyMin)} fill="none" stroke="#3b82f6" strokeOpacity="0.25" strokeWidth="1.5"/>
            {/* 7-day MA line */}
            <path d={linePath(analyticsData.movingAvg, analyticsData.maxDailyMin)} fill="none" stroke="#60a5fa" strokeWidth="2.5"/>
            {/* X axis labels (every 5 days) */}
            {analyticsData.dailyFocus.filter((_, i) => i % 5 === 0 || i === analyticsData.dailyFocus.length - 1).map((d, i, arr) => {
              const idx = analyticsData.dailyFocus.indexOf(d);
              const x = pad.l + (idx / Math.max(analyticsData.dailyFocus.length - 1, 1)) * plotW;
              return <text key={i} x={x} y={chartH - 4} textAnchor="middle" className="fill-slate-600 text-[8px]">{d.date}</text>;
            })}
          </svg>
        </div>

        {/* Chart: Hourly Focus Distribution */}
        <div className="glass-panel p-5 rounded-2xl space-y-3">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Ultradian Attentional Density</h3>
          <svg viewBox={`0 0 ${chartW + 20} ${chartH + 10}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            {analyticsData.hourlyTotals.map((total, hour) => {
              const barH = (total / analyticsData.maxHourlyMin) * plotH;
              const x = pad.l + hour * barWidth;
              const y = pad.t + plotH - barH;
              return (
                <g key={hour}>
                  <rect x={x} y={y} width={Math.max(barWidth - 1, 2)} height={Math.max(barH, 0)} rx="2" className="fill-blue-500/40 hover:fill-blue-500/60 transition-colors"/>
                  {hour % 3 === 0 && (
                    <text x={x + barWidth / 2} y={chartH - 4} textAnchor="middle" className="fill-slate-600 text-[8px]">{hour}</text>
                  )}
                </g>
              );
            })}
            {/* Y axis label */}
            <text x={8} y={pad.t + plotH / 2} textAnchor="middle" transform={`rotate(-90, 8, ${pad.t + plotH / 2})`} className="fill-slate-600 text-[9px]">focus (min)</text>
          </svg>
          <div className="text-[10px] text-slate-500 text-center">Hour of day (24h). Taller bars = your golden windows of peak focus.</div>
        </div>

        {/* Chart: Latency Scatter */}
        <div className="glass-panel p-5 rounded-2xl space-y-3">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Attentional Latency After Distraction</h3>
          {analyticsData.latencies.length > 0 ? (
            <>
              <svg viewBox={`0 0 ${chartW + 20} ${chartH + 10}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                {analyticsData.latencies.map((pt, i) => {
                  const x = pad.l + (pt.hour / 23) * plotW;
                  const y = pad.t + plotH - (pt.latencyMin / Math.max(...analyticsData.latencies.map(l => l.latencyMin), 1)) * plotH;
                  return <circle key={i} cx={x} cy={y} r="3" className="fill-amber-400/60 hover:fill-amber-400 transition-colors"/>;
                })}
                {/* Median line */}
                {analyticsData.medianLatency > 0 && (
                  <>
                    <line x1={pad.l} y1={pad.t + plotH - (analyticsData.medianLatency / Math.max(...analyticsData.latencies.map(l => l.latencyMin), 1)) * plotH} x2={chartW - pad.r} y2={pad.t + plotH - (analyticsData.medianLatency / Math.max(...analyticsData.latencies.map(l => l.latencyMin), 1)) * plotH} stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="4 3"/>
                    <text x={chartW - pad.r} y={pad.t + plotH - (analyticsData.medianLatency / Math.max(...analyticsData.latencies.map(l => l.latencyMin), 1)) * plotH - 4} textAnchor="end" className="fill-amber-400 text-[9px]">median: {analyticsData.medianLatency}m</text>
                  </>
                )}
                {/* X axis labels */}
                {[0, 6, 12, 18, 23].map(h => (
                  <text key={h} x={pad.l + (h / 23) * plotW} y={chartH - 4} textAnchor="middle" className="fill-slate-600 text-[8px]">{h}:00</text>
                ))}
              </svg>
              <div className="text-[10px] text-slate-500 text-center">Each dot = one distraction. Y-axis = minutes to start a new focus session. Dashed line = median recovery time.</div>
            </>
          ) : (
            <p className="text-xs text-slate-600 italic text-center py-8">Not enough distraction data yet. Keep using the app to build your profile.</p>
          )}
        </div>

        {/* Distraction Timeline */}
        <div className="glass-panel p-5 rounded-2xl space-y-3">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Distraction Timeline (14 days)</h3>
          {(() => {
            const now = Date.now();
            const dayMs = 86400000;
            const days: { label: string; count: number; logs: DistractionLog[] }[] = [];
            for (let i = 13; i >= 0; i--) {
              const dayStart = new Date(now - i * dayMs);
              dayStart.setHours(0, 0, 0, 0);
              const dayEnd = dayStart.getTime() + dayMs;
              const dayLogs = distractionLogs.filter(l => l.timestamp >= dayStart.getTime() && l.timestamp < dayEnd);
              days.push({
                label: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                count: dayLogs.length,
                logs: dayLogs,
              });
            }
            const maxCount = Math.max(...days.map(d => d.count), 1);
            const barW = plotW / 14;
            return (
              <svg viewBox={`0 0 ${chartW + 20} ${chartH + 10}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                {days.map((day, i) => {
                  const barH = (day.count / maxCount) * plotH;
                  const x = pad.l + i * barW;
                  const y = pad.t + plotH - barH;
                  return (
                    <g key={i}>
                      <rect x={x} y={y} width={Math.max(barW - 2, 3)} height={Math.max(barH, 0)} rx="2" className="fill-amber-500/40 hover:fill-amber-500/60 transition-colors cursor-pointer">
                        <title>{day.count > 0 ? `${day.count} distraction${day.count > 1 ? 's' : ''}\n${day.logs.map(l => l.text + (l.taskName ? ` (during: ${l.taskName})` : '')).join('\n')}` : 'No distractions'}</title>
                      </rect>
                      {i % 2 === 0 && (
                        <text x={x + barW / 2} y={chartH - 4} textAnchor="middle" className="fill-slate-600 text-[8px]">{day.label}</text>
                      )}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
        </div>

        {/* Distraction Breakdown */}
        <div className="glass-panel p-5 rounded-2xl space-y-3">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Distraction Breakdown</h3>
          {distractionLogs.length > 0 ? (
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
              {(() => {
                const grouped: Record<string, { count: number; lastSeen: number; type: string; text: string }> = {};
                distractionLogs.forEach(log => {
                  const key = log.text.toLowerCase().trim();
                  if (!grouped[key]) grouped[key] = { count: 0, lastSeen: 0, type: log.type, text: log.text };
                  grouped[key].count++;
                  if (log.timestamp > grouped[key].lastSeen) grouped[key].lastSeen = log.timestamp;
                });
                const sorted = Object.values(grouped).sort((a, b) => b.count - a.count);
                return sorted.map((entry, i) => (
                  <div key={i} className="group flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${entry.type === 'lookup' ? 'bg-violet-400' : 'bg-amber-400'}`} title={entry.type === 'lookup' ? 'Research Later' : 'Just Logged'}/>
                      <span className="text-sm text-slate-300 truncate" title={`Last: ${new Date(entry.lastSeen).toLocaleString()}`}>{entry.text}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] font-mono text-slate-500">{entry.count}x</span>
                      <span className="text-[10px] text-slate-600 hidden group-hover:inline">{entry.type === 'lookup' ? 'lookup' : 'log'}</span>
                    </div>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <p className="text-xs text-slate-600 italic text-center py-4">No distractions logged yet. Use the capture option in the recovery popup to start tracking.</p>
          )}
        </div>
      </div>
      )}
    </div>
  );
};

export default App;
