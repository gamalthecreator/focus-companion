export interface Task {
  id: string;
  text: string;
  type: 'active' | 'pile' | 'lookup';
  completed: number;
  progress: number;
  createdAt: number;
  updatedAt: number;
}

export interface Setting {
  key: string;
  value: string;
}

export interface Session {
  id: string;
  taskId: string;
  taskName: string;
  startTime: number;
  endTime: number;
  actualFocusMs: number;
  endingStatus: 'completed' | 'distracted' | 'paused';
}

export interface Interruption {
  id: string;
  sessionId: string;
  timestamp: number;
  choiceMade: 'return' | 'switch' | 'capture';
}

export interface DistractionLog {
  id: string;
  timestamp: number;
  text: string;
  type: 'lookup' | 'distraction';
  taskId?: string;
  taskName?: string;
}

export interface IElectronAPI {
  // Task CRUD
  getTasks: () => Promise<Task[]>;
  addTask: (task: { id: string; text: string; type: string; createdAt: number }) => Promise<{ success: boolean }>;
  updateTask: (id: string, updates: Partial<{ completed: boolean; updatedAt: number }>) => Promise<{ success: boolean }>;
  deleteTask: (id: string) => Promise<{ success: boolean }>;
  restoreTask: (id: string) => Promise<{ success: boolean }>;
  sendTask: (task: any) => void;

  // Active task
  setActiveTask: ({ id, text }: { id: string | null; text: string }) => Promise<{ success: boolean }>;
  getActiveTask: () => Promise<{ id: string | null; text: string }>;

  // Check-in
  respondToCheckin: (action: string) => void;
  triggerCheckin: () => void;

  // Distraction recovery
  respondToDistraction: (action: string, payload?: { text: string }) => Promise<{ success: boolean }>;

  // Timer
  onTimerTick: (callback: (seconds: number) => void) => void;
  getTimerState: () => Promise<{ secondsLeft: number }>;

  // Task updates from main
  onTaskUpdated: (callback: () => void) => void;

  // Analytics
  exportAnalytics: () => Promise<{ success: boolean; path?: string }>;
  getSessions: () => Promise<Session[]>;
  getInterruptions: () => Promise<Interruption[]>;
  getDistractionLogs: () => Promise<DistractionLog[]>;

  // Stale tasks
  getStaleTasks: () => Promise<Task[]>;
  snoozeTask: (id: string) => Promise<{ success: boolean }>;

  // Capture window
  closeCapture: () => void;

  // Settings
  getSettings: () => Promise<Setting[]>;
  setSetting: (key: string, value: string) => Promise<{ success: boolean }>;
  onShortcutsChanged: (callback: () => void) => void;
  shortcutsChanged: () => void;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
