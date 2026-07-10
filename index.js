const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;
let captureWindow = null;
let checkinWindow = null;
let distractionWindow = null;
let tray = null;
let data = null;
let dataPath = null;
let lockPath = null;
let currentActiveTaskId = null;
let currentActiveTaskText = '';
let sessionStartTime = null;
let currentSessionId = null;
let secondsUntilCheckin = 20 * 60;

const DEFAULT_SHORTCUTS = {
  'shortcut.globalCapture': 'Alt+Space',
  'shortcut.localAddTask': 'Ctrl+Enter',
  'shortcut.localPause': 'Alt+F',
  'shortcut.localCheckin': 'Alt+C',
  'shortcut.localMarkDone': 'Alt+D',
  'shortcut.localEscape': 'Escape',
};

// Concurrency lock
function acquireLock() {
  lockPath = path.join(app.getPath('userData'), 'focus-companion.lock');
  try {
    if (fs.existsSync(lockPath)) {
      const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const age = Date.now() - existing.timestamp;
      if (age < 10000) {
        console.error('Another instance appears to be running. Exiting.');
        app.quit();
        return false;
      }
    }
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now(), id: crypto.randomUUID() }), 'utf8');
    return true;
  } catch {
    return true;
  }
}

function releaseLock() {
  try {
    if (lockPath && fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {}
}

// JSON data storage
function initData() {
  dataPath = path.join(app.getPath('userData'), 'focus-companion.json');
  try {
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch {
    data = { tasks: [], analytics: [], sessions: [], interruptions: [], distractionLogs: [], settings: { ...DEFAULT_SHORTCUTS } };
  }
  if (!data.sessions) data.sessions = [];
  if (!data.interruptions) data.interruptions = [];
  if (!data.distractionLogs) data.distractionLogs = [];
}

function saveData() {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

function touchLock() {
  try {
    if (lockPath && fs.existsSync(lockPath)) {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      lock.timestamp = Date.now();
      fs.writeFileSync(lockPath, JSON.stringify(lock), 'utf8');
    }
  } catch {}
}

function getTasks() {
  return data.tasks || [];
}

function getAnalytics() {
  return data.analytics || [];
}

function getSettings() {
  return data.settings || {};
}

// Timer logic
function startCheckinTimer() {
  console.log('Main: Starting check-in timer...');
  setInterval(() => {
    if (currentActiveTaskId) {
      secondsUntilCheckin--;
      if (secondsUntilCheckin <= 0) {
        console.log('Main: Timer reached 0, triggering check-in');
        createCheckinWindow();
        secondsUntilCheckin = 20 * 60;
      }
    }
    // Always send tick so the UI never freezes
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('timer-tick', secondsUntilCheckin);
    }
  }, 1000);
}

function resetCheckinTimer() {
  secondsUntilCheckin = 20 * 60;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer-tick', secondsUntilCheckin);
  }
}

function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();
  const settings = getSettings();
  const shortcut = settings['shortcut.globalCapture'] || 'Alt+Space';
  try {
    globalShortcut.register(shortcut, () => {
      createCaptureWindow();
    });
    console.log('Global capture shortcut registered:', shortcut);
  } catch (e) {
    console.error('Failed to register global shortcut:', shortcut, e);
  }
}

function createCaptureWindow() {
  if (captureWindow) {
    if (captureWindow.isVisible()) {
      captureWindow.hide();
    } else {
      captureWindow.show();
    }
    return;
  }

  captureWindow = new BrowserWindow({
    width: 500,
    height: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  captureWindow.loadFile('capture.html');

  captureWindow.on('blur', () => {
    captureWindow.hide();
  });
}

function createCheckinWindow() {
  if (checkinWindow) {
    if (checkinWindow.isVisible()) {
      checkinWindow.hide();
    } else {
      checkinWindow.show();
    }
    return;
  }

  checkinWindow = new BrowserWindow({
    width: 450,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  checkinWindow.loadFile('checkin.html');

  checkinWindow.on('blur', () => {
    checkinWindow.hide();
  });
}

function createDistractionWindow() {
  if (distractionWindow) {
    distractionWindow.show();
    return;
  }

  distractionWindow = new BrowserWindow({
    width: 450,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  distractionWindow.loadFile('distraction.html');

  distractionWindow.on('blur', () => {
    distractionWindow.hide();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173').catch(err => {
      console.error('Failed to load Vite server, falling back to dist:', err);
      mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Helper to log time to analytics
function logSession(taskId, taskName, start, end, status) {
  if (!taskId || !start || !end) return;
  data.analytics.push({ taskId, startTime: start, endTime: end });
  data.sessions.push({
    id: crypto.randomUUID(),
    taskId,
    taskName: taskName || '',
    startTime: start,
    endTime: end,
    actualFocusMs: end - start,
    endingStatus: status || 'paused',
  });
  saveData();
}

function logInterruption(sessionId, choice) {
  data.interruptions.push({
    id: crypto.randomUUID(),
    sessionId: sessionId || '',
    timestamp: Date.now(),
    choiceMade: choice,
  });
  saveData();
}

// IPC Handlers
ipcMain.on('capture:close', () => {
  if (captureWindow) captureWindow.hide();
});

ipcMain.handle('settings:get-all', async () => {
  const settings = getSettings();
  return Object.keys(settings)
    .filter(k => k.startsWith('shortcut.'))
    .map(key => ({ key, value: settings[key] }));
});

ipcMain.handle('settings:set', async (event, key, value) => {
  data.settings = data.settings || {};
  data.settings[key] = value;
  saveData();
  return { success: true };
});

ipcMain.on('settings:global-shortcuts-changed', () => {
  registerGlobalShortcuts();
});

ipcMain.handle('db:get-active-task', async () => {
  return { id: currentActiveTaskId, text: currentActiveTaskText };
});

ipcMain.on('checkin:respond', async (event, action) => {
  if (checkinWindow) checkinWindow.hide();
  const now = Date.now();

  if (action === 'done' && currentActiveTaskId) {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === currentActiveTaskId);
    if (task) {
      task.completed = 1;
      task.progress = 100;
      task.updatedAt = now;
      saveData();
    }

    if (sessionStartTime) {
      logSession(currentActiveTaskId, currentActiveTaskText, sessionStartTime, now, 'completed');
    }

    currentActiveTaskId = null;
    currentActiveTaskText = '';
    sessionStartTime = null;
    currentSessionId = null;

    if (mainWindow) mainWindow.webContents.send('task-updated');
  } else if (action === 'pause') {
    if (currentActiveTaskId && sessionStartTime) {
      logSession(currentActiveTaskId, currentActiveTaskText, sessionStartTime, now, 'paused');
    }
    currentActiveTaskId = null;
    currentActiveTaskText = '';
    sessionStartTime = null;
    currentSessionId = null;
    if (mainWindow) mainWindow.webContents.send('task-updated');
  } else if (action === 'distracted') {
    console.log('User reported distraction. Opening recovery window.');
    if (currentActiveTaskId && sessionStartTime) {
      logSession(currentActiveTaskId, currentActiveTaskText, sessionStartTime, now, 'distracted');
    }
    currentActiveTaskId = null;
    currentActiveTaskText = '';
    sessionStartTime = null;
    currentSessionId = null;
    createDistractionWindow();
  }
});

ipcMain.on('checkin:manual-trigger', () => {
  createCheckinWindow();
});

ipcMain.handle('db:set-active-task', async (event, { id, text }) => {
  console.log(`Main: Setting active task to ${id} (${text})`);
  const now = Date.now();

  if (currentActiveTaskId && sessionStartTime) {
    logSession(currentActiveTaskId, currentActiveTaskText, sessionStartTime, now, 'paused');
  }

  currentActiveTaskId = id;
  currentActiveTaskText = text || '';
  sessionStartTime = id ? now : null;
  currentSessionId = id ? crypto.randomUUID() : null;

  if (id) {
    resetCheckinTimer();
  }

  return { success: true };
});

ipcMain.handle('db:export-analytics', async () => {
  const sessions = data.sessions || [];
  const interruptions = data.interruptions || [];
  const tasks = getTasks();

  // Build a comprehensive JSON telemetry dump
  const telemExport = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    summary: {
      totalSessions: sessions.length,
      totalInterruptions: interruptions.length,
      totalTasks: tasks.length,
      totalFocusHours: Math.round(sessions.reduce((s, sess) => s + sess.actualFocusMs, 0) / 3600000 * 100) / 100,
    },
    tasks: tasks.map(t => ({
      id: t.id,
      text: t.text,
      type: t.type,
      completed: !!t.completed,
      progress: t.progress ?? (t.completed ? 100 : 0),
      createdAt: new Date(t.createdAt).toISOString(),
      updatedAt: new Date(t.updatedAt).toISOString(),
      sessions: sessions.filter(s => s.taskId === t.id).length,
      totalFocusMs: sessions.filter(s => s.taskId === t.id).reduce((sum, s) => sum + s.actualFocusMs, 0),
    })),
    sessions: sessions.map(s => ({
      id: s.id,
      taskId: s.taskId,
      taskName: s.taskName,
      startTime: new Date(s.startTime).toISOString(),
      endTime: new Date(s.endTime).toISOString(),
      actualFocusMs: s.actualFocusMs,
      actualFocusMin: Math.round(s.actualFocusMs / 60000 * 100) / 100,
      endingStatus: s.endingStatus,
    })),
    interruptions: interruptions.map(i => ({
      id: i.id,
      sessionId: i.sessionId,
      timestamp: new Date(i.timestamp).toISOString(),
      choiceMade: i.choiceMade,
    })),
  };

  // Also build a multi-section CSV
  const csvHeader = '# Focus Companion Telemetry Export\n';
  const csvDate = `# Exported: ${new Date().toISOString()}\n\n`;

  const sessionsCsv = [
    '=== SESSIONS ===',
    'SessionID,TaskID,TaskName,StartTime,EndTime,FocusMinutes,Status',
    ...sessions.map(s =>
      [s.id, s.taskId, `"${(s.taskName || '').replace(/"/g, '""')}"`, new Date(s.startTime).toISOString(), new Date(s.endTime).toISOString(), Math.round(s.actualFocusMs / 60000 * 100) / 100, s.endingStatus].join(',')
    ),
  ].join('\n');

  const interruptionsCsv = [
    '\n\n=== INTERRUPTIONS ===',
    'InterruptionID,SessionID,Timestamp,Choice',
    ...interruptions.map(i =>
      [i.id, i.sessionId || '', new Date(i.timestamp).toISOString(), i.choiceMade].join(',')
    ),
  ].join('\n');

  const tasksCsv = [
    '\n\n=== TASKS ===',
    'TaskID,Text,Type,Completed,Progress,CreatedAt,UpdatedAt,SessionCount,TotalFocusMinutes',
    ...tasks.map(t => {
      const taskSessions = sessions.filter(s => s.taskId === t.id);
      return [
        t.id,
        `"${(t.text || '').replace(/"/g, '""')}"`,
        t.type,
        t.completed ? 1 : 0,
        t.progress ?? (t.completed ? 100 : 0),
        new Date(t.createdAt).toISOString(),
        new Date(t.updatedAt).toISOString(),
        taskSessions.length,
        Math.round(taskSessions.reduce((s, sess) => s + sess.actualFocusMs, 0) / 60000 * 100) / 100,
      ].join(',');
    }),
  ].join('\n');

  const csvFull = csvHeader + csvDate + sessionsCsv + interruptionsCsv + tasksCsv;

  return dialog.showSaveDialog({
    title: 'Export Analytics',
    defaultPath: 'focus-telemetry.json',
    filters: [
      { name: 'JSON Telemetry Dump', extensions: ['json'] },
      { name: 'CSV (multi-section)', extensions: ['csv'] },
    ]
  }).then(result => {
    if (result.canceled) return { success: false };
    const ext = path.extname(result.filePath).toLowerCase();
    if (ext === '.csv') {
      fs.writeFileSync(result.filePath, csvFull, 'utf8');
    } else {
      fs.writeFileSync(result.filePath, JSON.stringify(telemExport, null, 2), 'utf8');
    }
    return { success: true, path: result.filePath };
  });
});

ipcMain.handle('db:get-tasks', async () => {
  const tasks = getTasks();
  return tasks.sort((a, b) => b.createdAt - a.createdAt);
});

ipcMain.handle('db:add-task', async (event, task) => {
  console.log('Main: Adding task:', task);
  data.tasks.push({
    id: task.id,
    text: task.text,
    type: task.type,
    completed: 0,
    progress: 0,
    createdAt: task.createdAt,
    updatedAt: task.createdAt,
  });
  saveData();
  console.log('Main: Task added successfully, sending task-updated event');
  if (mainWindow) mainWindow.webContents.send('task-updated');
  return { success: true };
});

ipcMain.handle('db:update-task', async (event, id, updates) => {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === id);
  if (task) {
    Object.assign(task, updates);
    saveData();
  }
  return { success: true };
});

ipcMain.handle('db:delete-task', async (event, id) => {
  data.tasks = getTasks().filter(t => t.id !== id);
  saveData();
  return { success: true };
});

ipcMain.handle('db:restore-task', async (event, id) => {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = 0;
    task.progress = 0;
    task.updatedAt = Date.now();
    const sessionIds = data.sessions.filter(s => s.taskId === id).map(s => s.id);
    data.sessions = data.sessions.filter(s => s.taskId !== id);
    data.analytics = (data.analytics || []).filter(a => a.taskId !== id);
    data.interruptions = data.interruptions.filter(i => !sessionIds.includes(i.sessionId));
    saveData();
  }
  if (mainWindow) mainWindow.webContents.send('task-updated');
  return { success: true };
});

ipcMain.handle('distraction:respond', async (event, action, payload) => {
  if (distractionWindow) distractionWindow.hide();
  logInterruption(currentSessionId, typeof action === 'string' ? action : action?.action || 'capture');

  if (action === 'return') {
    if (mainWindow) mainWindow.webContents.send('task-updated');
  } else if (action === 'switch') {
    if (currentActiveTaskId && sessionStartTime) {
      logSession(currentActiveTaskId, currentActiveTaskText, sessionStartTime, Date.now(), 'distracted');
    }
    currentActiveTaskId = null;
    currentActiveTaskText = '';
    sessionStartTime = null;
    currentSessionId = null;
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.send('task-updated');
    }
  } else if (action === 'capture') {
    createCaptureWindow();
    if (mainWindow) mainWindow.webContents.send('task-updated');
  } else if (action === 'capture_lookup' || action === 'capture_log') {
    const text = payload?.text || 'unknown distraction';
    data.distractionLogs.push({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      text,
      type: action === 'capture_lookup' ? 'lookup' : 'distraction',
      taskId: currentActiveTaskId || undefined,
      taskName: currentActiveTaskText || undefined,
    });
    saveData();
    if (action === 'capture_lookup') {
      const lookupTask = {
        id: crypto.randomUUID(),
        text,
        type: 'lookup',
        createdAt: Date.now(),
      };
      data.tasks.push({
        id: lookupTask.id,
        text: lookupTask.text,
        type: 'lookup',
        completed: 0,
        progress: 0,
        createdAt: lookupTask.createdAt,
        updatedAt: lookupTask.createdAt,
      });
      saveData();
    }
    if (mainWindow) mainWindow.webContents.send('task-updated');
  }
  resetCheckinTimer();
});

ipcMain.handle('db:get-distraction-logs', async () => {
  return data.distractionLogs || [];
});

ipcMain.handle('db:get-timer-state', async () => {
  return { secondsLeft: secondsUntilCheckin };
});

ipcMain.handle('db:get-sessions', async () => {
  return data.sessions || [];
});

ipcMain.handle('db:get-interruptions', async () => {
  return data.interruptions || [];
});

ipcMain.handle('db:get-stale-tasks', async () => {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const tasks = getTasks();
  return tasks.filter(t => t.type === 'pile' && !t.completed && (t.progress ?? 0) < 100 && t.updatedAt < threeDaysAgo)
    .sort((a, b) => a.updatedAt - b.updatedAt);
});

ipcMain.handle('db:snooze-task', async (event, id) => {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.updatedAt = Date.now();
    saveData();
  }
  return { success: true };
});

app.whenReady().then(() => {
  if (!acquireLock()) return;
  initData();
  createWindow();

  tray = new Tray(path.join(__dirname, 'icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Focus Companion');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());

  registerGlobalShortcuts();

  setInterval(touchLock, 5000);

  startCheckinTimer();
});

app.on('before-quit', () => {
  releaseLock();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
