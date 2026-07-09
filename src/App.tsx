import React, { useState, useEffect, useCallback, useRef } from 'react';

interface Task {
  id: string;
  text: string;
  type: 'active' | 'pile' | 'lookup';
  completed: number;
  createdAt: number;
  updatedAt: number;
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
    window.electron.onTaskUpdated(loadTasks);
    window.electron.onTimerTick((seconds: number) => setTimeLeft(seconds));
    window.electron.onShortcutsChanged(loadShortcuts);

    loadTasks();
    checkStaleTasks();
    loadShortcuts();

    window.electron.getTimerState().then(state => {
      setTimeLeft(state.secondsLeft);
    });
  }, [loadTasks, checkStaleTasks, loadShortcuts]);

  useEffect(() => {
    if (showSettings && settingsRef.current) {
      settingsRef.current.focus();
    }
  }, [showSettings]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingShortcut) return;

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
  }, [tasks, inputValue, activeTaskId, shortcuts, showSettings, editingShortcut]);

  const addTask = async () => {
    if (!inputValue.trim()) return;
    const newTask: Task = {
      id: crypto.randomUUID(),
      text: inputValue,
      type: 'pile',
      completed: 0,
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
        updatedAt: Date.now()
      });

      setTasks(prev => prev.map(t => t.id === activeTaskId ? { ...t, completed: 1 } : t));

      const updatedTasks = tasks.map(t => t.id === activeTaskId ? { ...t, completed: 1 } : t);
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

  return (
    <div className="h-screen flex flex-col p-6 space-y-8 overflow-hidden bg-[#0f172a] text-slate-200 font-sans">
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
                const numbered = tasks.filter(t => t.type === 'pile' && !t.completed);
                const completed = tasks.filter(t => t.type === 'pile' && t.completed);
                return [...numbered, ...completed].map((task, i) => {
                  const num = i < numbered.length ? (i < 9 ? (i + 1).toString() : i === 9 ? '0' : null) : null;
                  return (
                    <div key={task.id} onClick={() => setAsActive(task.id)}
                      className={`group p-3 rounded-xl cursor-pointer transition-all border flex justify-between items-start gap-2 ${activeTaskId === task.id ? 'bg-blue-600/20 border-blue-500/50 text-white shadow-lg shadow-blue-500/10' : 'bg-slate-800/40 border-transparent hover:border-slate-700 text-slate-400 hover:text-slate-200'} ${task.completed ? 'opacity-40 line-through' : ''}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {num && <span className="flex-shrink-0 w-5 h-5 rounded-md bg-slate-700/60 text-slate-400 text-[11px] font-mono font-bold flex items-center justify-center">{num}</span>}
                        <span className="flex-1 min-w-0 truncate">{task.text}</span>
                      </div>
                      <button onClick={(e) => deleteTask(task.id, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-red-900/40 text-slate-500 hover:text-red-300 flex-shrink-0"
                        title="Delete task" aria-label="Delete task"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                        </svg>
                      </button>
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
                className="text-[10px] uppercase tracking-widest text-slate-500 hover:text-white transition-colors font-bold">
                Export CSV
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
    </div>
  );
};

export default App;
