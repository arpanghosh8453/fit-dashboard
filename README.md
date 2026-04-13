<p align="center">
    <img src="public/favicon.svg" alt="FIT Dashboard" width="80" />
</p>

<H1 align="center">FIT Dashboard</H1>

<p align="center">A high-performance activity analytics dashboard for Garmin FIT files. Available as a Tauri v2 desktop app or a Docker-deployable web app. Built with Rust, DuckDB, and React.</p>

---

## Contents

- [Features](#features)
- [Getting Started](#getting-started)
  - [Try the Webapp](#try-the-webapp)
  - [Run from Source (Development)](#run-from-source-development)
  - [Docker Deployment (Self-hosted)](#docker-deployment-self-hosted)
  - [Tauri Desktop App](#tauri-desktop-app)
- [Usage](#usage)
- [Export Formats](#export-formats)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Security](#security)
- [License](#license)

## Features

- **FIT File Parsing**: Native Rust parser using the `fitparser` crate. Supports all standard Garmin FIT activity files with automatic field extraction.
- **High-Performance Storage**: DuckDB-powered analytical database with automatic downsampling for fast time-series queries. Handles hundreds of activities with millions of data points.
- **Interactive Telemetry Charts**: ECharts-powered visualization of speed, heart rate, cadence, altitude, power, and temperature. Synchronized zoom/pan with Ctrl+scroll guarding to prevent accidental navigation.
- **Activity Map**: MapLibre GL map with dynamic path coloring by metric (speed, HR, cadence, altitude, power, temperature, time). Hover tooltips show telemetry details at each point. Supports multiple map styles.
- **Overview Dashboard**: Aggregate statistics across all imported activities — total distance, total duration, activity count, and recent activity feed with interactive map overlay.
- **Advanced Filtering**: Filter by sport type, date range, duration range, and full-text search. Collapsible filter panel with bordered container design.
- **Bulk Export**: Export filtered activities as CSV, JSON, GPX, or KML. Uses the File System Access API to write directly to a chosen folder. Fallback to individual browser downloads when the API is unavailable.
- **Single Export**: Right-click any activity to export it individually via the context menu with format submenu.
- **Bulk Delete**: Delete all filtered activities at once with inline confirmation and progress overlay.
- **Inline Management**: Rename and delete activities with inline UI — no browser dialogs. All destructive actions require explicit confirmation.
- **Session Persistence**: Authentication tokens persist across browser refreshes with a configurable 72-hour TTL (web) or until logout (desktop).
- **Dark & Light Themes**: Modern glassmorphism design with CSS custom properties. Theme toggles instantly across the entire interface.
- **Responsive Layout**: Collapsible sidebar with a persistent expand strip. Works on desktop and tablet viewports.
- **Import Queue**: Batch import multiple FIT files with sequential processing for stability. Duplicate detection prevents re-importing the same file.
- **Password Protection**: Argon2-hashed credentials with session-based authentication. First-use onboarding flow for initial setup.

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+
- npm (bundled with Node.js)

### Run from Source (Development)

```bash
# Clone the repository
git clone https://github.com/your-username/fit-dashboard
cd fit-dashboard

# Install frontend dependencies
npm install

# Start the Rust backend (web server mode)
cd src-tauri
cargo run --features web
# Backend starts at http://localhost:8080

# In another terminal, start the frontend dev server
cd fit-dashboard
npm run dev
# Frontend starts at http://localhost:5173
```

Open http://localhost:5173 in your browser. On first launch, the onboarding screen appears to set up your username and password.

### Docker Deployment (Self-hosted)

```bash
cd docker
docker compose up --build -d
```

Open http://localhost:8088 in your browser. The Nginx reverse proxy serves the frontend and proxies API requests to the Rust backend.

#### Data Persistence

All data (DuckDB database, config) is stored in a Docker named volume mapped to `/data/fit-dashboard` inside the container. Data persists across container restarts and image updates.

### Tauri Desktop App

```bash
npm install

# Development mode
npm run tauri:dev

# Production build
npm run tauri:build
```

The desktop app runs the Rust backend natively with Tauri IPC — no web server needed.

## Usage

1. **Import**: Open the sidebar Import section and select one or more `.fit` files
2. **Browse**: Activities appear in the sidebar, sorted by date. Use filters to narrow down
3. **Analyze**: Click an activity to view telemetry charts, map path, and performance insights
4. **Export**: Right-click an activity for single export, or use "Export filtered" for bulk export
5. **Overview**: Switch to the Overview tab for aggregate statistics across all activities

## Export Formats

| Format | Description |
|--------|-------------|
| **CSV** | Full time-series with all telemetry fields. Metadata JSON embedded in the first row. Speed in both m/s and km/h. |
| **JSON** | Structured export with activity metadata and full records array. Pretty-printed for readability. |
| **GPX** | Standard GPS Exchange Format with track segments. Extensions include heart rate, cadence, and power. |
| **KML** | Google Earth format with 3D line path using absolute altitude mode. |

**Single export**: Right-click → Export → choose format → browser download.

**Bulk export**: Click "Export filtered" → choose format → select destination folder → files are written one by one with progress overlay.

## Tech Stack

### Backend (Rust)

| Component | Purpose |
|-----------|---------|
| **Tauri v2** | Desktop application framework (feature-gated behind `tauri-app`) |
| **Axum** | Web REST API server for Docker/web deployment (feature-gated behind `web`) |
| **DuckDB** | Embedded analytical database — fast aggregations over millions of records |
| **fitparser** | Native FIT file parsing — no external tools required |
| **Argon2** | Password hashing for authentication |

### Frontend (React)

| Component | Purpose |
|-----------|---------|
| **React 18 + TypeScript** | UI framework |
| **Vite** | Build tool with HMR |
| **Zustand** | Lightweight state management |
| **ECharts** | Telemetry charts with synchronized zoom |
| **MapLibre GL** | Interactive map with cooperative gestures |
| **Vanilla CSS** | Custom design system with CSS variables, dark/light theming |

## Project Structure

```
fit-dashboard/
├── src-tauri/                   # RUST BACKEND
│   └── src/
│       ├── main.rs              # Entry point (feature-gated: Tauri or Axum)
│       ├── server.rs            # Axum REST API routes
│       ├── database.rs          # DuckDB schema, queries, downsampling
│       ├── fit_parser.rs        # FIT file parsing with fitparser crate
│       ├── models.rs            # Shared data structures
│       ├── auth.rs              # Password hashing & session management
│       ├── state.rs             # Shared application state
│       └── tauri_app.rs         # Tauri IPC command handlers
│
├── src/                         # REACT FRONTEND
│   ├── components/
│   │   ├── Dashboard.tsx        # Main layout — sidebar, header, content
│   │   ├── ActivityChart.tsx    # ECharts telemetry visualization
│   │   ├── ActivityMap.tsx      # MapLibre map with path coloring
│   │   ├── ActivityInsights.tsx # Derived statistics & heatmaps
│   │   ├── SettingsPanel.tsx    # Slide-over settings drawer
│   │   ├── Onboarding.tsx      # First-use setup flow
│   │   ├── UnlockScreen.tsx    # Password unlock screen
│   │   └── DonationBanner.tsx  # Support banner
│   ├── stores/
│   │   ├── activityStore.ts    # Activity data & selection state
│   │   └── settingsStore.ts    # Theme, units, map style settings
│   ├── lib/
│   │   ├── api.ts              # Backend adapter (Tauri IPC / Axios)
│   │   └── exportUtils.ts      # CSV/JSON/GPX/KML export builders
│   ├── types.ts                # TypeScript type definitions
│   ├── styles.css              # Complete design system
│   ├── App.tsx                 # Root component with auth flow
│   └── main.tsx                # React entry point
│
├── docker/                      # DOCKER CONFIG
│   ├── Dockerfile              # Combined backend + frontend image build
│   ├── docker-compose.yml      # Full-stack deployment
│   └── nginx.conf              # Reverse proxy config
│
├── public/                      # Static assets
├── index.html                   # HTML entry point
├── vite.config.ts               # Vite configuration
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Node.js dependencies
```

## API Reference

All endpoints require the `X-Session` header after authentication (except `/api/status`, `/api/onboard`, and `/api/unlock`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Server status and onboarding check |
| `POST` | `/api/onboard` | First-time user setup (username + password) |
| `POST` | `/api/unlock` | Authenticate and receive session token |
| `POST` | `/api/logout` | Invalidate current session |
| `POST` | `/api/import-fit` | Import FIT file (multipart form data) |
| `GET` | `/api/activities` | List all activities |
| `GET` | `/api/overview` | Aggregate statistics |
| `GET` | `/api/records/:id` | Telemetry records with `?resolution_ms=` downsampling |
| `PATCH` | `/api/activities/:id` | Rename activity |
| `DELETE` | `/api/activities/:id` | Delete activity |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Session TTL | 72 hours | Web session token lifetime. Desktop tokens persist until logout. |
| API Base | `http://localhost:8080` | Backend URL, configurable via `VITE_API_BASE` env var |
| Resolution | 10,000 ms | Default telemetry downsampling interval for chart queries |
| Export Resolution | 1,000 ms | Higher-resolution records used during export operations |

## Security

> **FIT Dashboard is designed as a local-first application.** The web/Docker mode does NOT include TLS/HTTPS.

- Passwords are hashed with **Argon2** before storage
- Session tokens are generated server-side and validated on every request
- Sessions are stored in-memory — a server restart invalidates all sessions
- For internet-facing deployments, use a reverse proxy (Nginx, Caddy, Traefik) with TLS termination

## Performance

Designed for up to ~1M records in DuckDB. Key optimizations:

- SQL-level downsampling reduces chart payload sizes by 10–100x
- Lazy loading — records are fetched only when an activity is selected
- Overview data uses aggressive downsampling (45s intervals) across sampled activities
- Export uses 1s resolution for full-fidelity output

## License

Copyright &copy; 2025 Arpan Ghosh. Licensed under the [GNU Affero General Public License v3.0](LICENSE).
