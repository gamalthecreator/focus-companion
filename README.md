# Focus Companion

An ADHD-friendly desktop app that lives in the system tray and helps you stay on task.

## Features

- **20-minute check-in loop** — gentle reminders to assess your focus
- **Active task timer** — track time spent on your current task with a visual progress bar
- **Task pile** — quick-switch between tasks using number keys (1-9, 0), with partial completion tracking (click to +25%, right-click to -25%)
- **Quick capture** — `Alt+Space` to instantly capture a thought or task
- **Distraction recovery** — popup when you get distracted to help you refocus
- **Stale task review** — nags you about tasks that haven't been touched in 3 days
- **Behavioral analytics dashboard** — 3 SVG charts showing focus trends, hourly peak windows, and distraction recovery latency, plus KPI metrics (ARR, AEI, Task Variance, Completion Rate)
- **Inline task editing** — click the pencil icon to edit task text directly in the pile
- **Telemetry export** — export full focus data as JSON or multi-section CSV for external analysis
- **Editable shortcuts** — customize all keyboard shortcuts in Settings
- **Concurrency lock** — prevents multiple instances from corrupting data

## Download

Grab the latest portable EXE from the [Releases](https://github.com/gamalthecreator/focus-companion/releases) page. No installation needed — just download and run.

## Usage

- Launch the app — it lives in the system tray
- Use `Alt+Space` anywhere to capture a quick thought
- Click a task to begin tracking, press number keys (1-9, 0) to switch instantly
- Click the progress bar on a task to advance it (0% → 25% → 50% → 75% → 100%)
- Right-click the progress bar to step backward
- Hover over a task to edit (pencil), restore (↺), or delete (trash)
- Switch to **Data & Insights** tab for charts and productivity metrics
- Export your data from the Look Up Later section

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
