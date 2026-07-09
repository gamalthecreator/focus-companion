# Focus Companion

An ADHD-friendly desktop app that lives in the system tray and helps you stay on task.

## Features

- **20-minute check-in loop** — gentle reminders to assess your focus
- **Active task timer** — track time spent on your current task
- **Task pile** — quick-switch between tasks using number keys (1-9, 0)
- **Quick capture** — `Alt+Space` to instantly capture a thought or task
- **Distraction recovery** — popup when you get distracted to help you refocus
- **Stale task review** — nags you about tasks that haven't been touched
- **Analytics** — see your focus patterns over time
- **Editable shortcuts** — customize all keyboard shortcuts in Settings

## Download

Grab the latest portable EXE from the [Releases](https://github.com/gamalthecreator/focus-companion/releases) page. No installation needed — just download and run.

## Usage

- Launch the app — it lives in the system tray
- Use `Alt+Space` anywhere to capture a quick thought
- Click "Start" on a task to begin tracking
- Press number keys (1-9, 0) to instantly switch to a task in the pile

## Development

```bash
npm install
npm run dev     # development mode
npm run build   # production build
npm start       # launch production app
npm run dist    # build installers
```

## Tech Stack

Electron + React + TypeScript + Vite + Tailwind CSS
