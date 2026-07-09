# Plan: Focus Companion Desktop App

## Context
"Focus Companion" is an ADHD-friendly external working memory tool. It aims to reduce cognitive load by providing a "system tray first" interface, global task capture, and gentle, low-friction check-ins to keep the user on task. It needs to be a local-first Electron application with a clean, minimalist UI.

## Proposed Architecture
- **Framework**: Electron + React + TypeScript + Vite.
- **Styling**: Tailwind CSS.
- **Persistence**: SQLite (via `better-sqlite3` or similar) for robustness and efficient querying of task history.
- **Process Model**:
  - `main.ts`: Handles system tray, window lifecycle (close-to-tray), global shortcuts (`globalShortcut`), and window management (main, capture, alert).
  - `renderer/`: React frontend for the main dashboard, capture overlay, and check-in prompt.
  - `preload.ts`: IPC bridge for communicating between the React frontend and Electron main process (e.g., storage access, setting global shortcuts).

## Development Steps
1. **Scaffold**: Initialize the Electron/React/Vite project.
2. **Main Process Setup**: 
   - Implement system tray logic (native `Tray` API).
   - Override default window close behavior (`win.on('close', ...)`).
   - Integrate `globalShortcut` for "Look Up Later" capture.
3. **Storage Implementation**: Create a service layer using SQLite to manage tasks, history, and configuration.
4. **UI Implementation**:
   - Main Window: Active task display + Task Pile.
   - Quick Capture Window: Frameless window for fast-input overlay.
   - Alert Popup: Focused window for 20-min check-ins.
5. **Logic Integration**: Connect UI components to the storage layer and IPC channels.

## Verification
- Verify tray behavior: clicking 'X' minimizes, right-click 'Quit' exits.
- Verify global shortcuts: Ctrl+Space triggers capture from any app.
- Verify storage: Add tasks, restart, and ensure they persist.
- Verify alerts: Test the 20-minute timer popup.

## Critical Files
- `src/main.ts` (or equivalent): Application entry, Tray, Window management, IPC.
- `src/preload.ts`: IPC bridge.
- `src/db.ts`: SQLite wrapper.
- `src/renderer/`: UI components.

## Questions for User
- Are there any preferences regarding the "minimalist" look? (e.g., specific color schemes, rounded corners).
- Do you have a preferred SQLite wrapper (e.g., `better-sqlite3` for synchronous speed, or something asynchronous)?
