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
    data = { tasks: [], analytics: [], sessions: [], interruptions: [], settings: { ...DEFAULT_SHORTCUTS } };
  }
  if (!data.sessions) data.sessions = [];
  if (!data.interruptions) data.interruptions = [];
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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timer-tick', secondsUntilCheckin);
      }
      if (secondsUntilCheckin <= 0) {
        console.log('Main: Timer reached 0, triggering check-in');
        createCheckinWindow();
        secondsUntilCheckin = 20 * 60;
      }
    } else {
      secondsUntilCheckin = 20 * 60;
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
  const rows = getAnalytics();
  const csv = [
    ['ID', 'TaskID', 'StartTime', 'EndTime'],
    ...rows.map((r, i) => [i, r.taskId, new Date(r.startTime).toISOString(), r.endTime ? new Date(r.endTime).toISOString() : ''])
  ].map(e => e.join(",")).join("\n");

  return dialog.showSaveDialog({
    title: 'Export Analytics',
    defaultPath: 'focus-analytics.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  }).then(result => {
    if (result.canceled) {
      return { success: false };
    } else {
      fs.writeFileSync(result.filePath, csv, 'utf8');
      return { success: true, path: result.filePath };
    }
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

ipcMain.handle('distraction:respond', async (event, action) => {
  if (distractionWindow) distractionWindow.hide();
  logInterruption(currentSessionId, action);

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
  }
  resetCheckinTimer();
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
  return tasks.filter(t => t.type === 'pile' && !t.completed && t.updatedAt < threeDaysAgo)
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
