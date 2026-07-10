const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Task CRUD
  getTasks: () => ipcRenderer.invoke('db:get-tasks'),
  addTask: (task) => ipcRenderer.invoke('db:add-task', task),
  updateTask: (id, updates) => ipcRenderer.invoke('db:update-task', id, updates),
  deleteTask: (id) => ipcRenderer.invoke('db:delete-task', id),
  sendTask: (task) => ipcRenderer.send('add-task', task),

  // Active task
  setActiveTask: ({ id, text }) => ipcRenderer.invoke('db:set-active-task', { id, text }),
  getActiveTask: () => ipcRenderer.invoke('db:get-active-task'),

  // Check-in
  respondToCheckin: (action) => ipcRenderer.send('checkin:respond', action),
  triggerCheckin: () => ipcRenderer.send('checkin:manual-trigger'),

  // Distraction recovery
  respondToDistraction: (action) => ipcRenderer.invoke('distraction:respond', action),

  // Timer
  onTimerTick: (callback) => ipcRenderer.on('timer-tick', (_event, value) => callback(value)),
  getTimerState: () => ipcRenderer.invoke('db:get-timer-state'),

  // Task updates from main
  onTaskUpdated: (callback) => ipcRenderer.on('task-updated', (_event, value) => callback(value)),

  // Analytics
  exportAnalytics: () => ipcRenderer.invoke('db:export-analytics'),
  getSessions: () => ipcRenderer.invoke('db:get-sessions'),
  getInterruptions: () => ipcRenderer.invoke('db:get-interruptions'),

  // Stale tasks
  getStaleTasks: () => ipcRenderer.invoke('db:get-stale-tasks'),
  snoozeTask: (id) => ipcRenderer.invoke('db:snooze-task', id),

  // Capture window control
  closeCapture: () => ipcRenderer.send('capture:close'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get-all'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  onShortcutsChanged: (callback) => ipcRenderer.on('shortcuts-changed', () => callback()),
  shortcutsChanged: () => ipcRenderer.send('settings:global-shortcuts-changed'),
});
