# ✈ FlightSim — Browser-Based 3D Flight Simulator

A polished, realistic, modular browser flight simulator built with **Three.js** and **Node.js + Express**.

---

## 🚀 Quick Start

### 1. Install & run the backend

```bash
cd backend
npm install
npm start
```

The backend serves the frontend **and** handles the leaderboard API on `http://localhost:3001`.

### 2. Open in browser

Navigate to: **http://localhost:3001**

> No build step. No bundler. Pure ES modules loaded via browser importmap.

---

## 📁 Project Structure

```
flightsim/
├── frontend/
│   ├── index.html                  ← Entry point (full UI + game mount)
│   └── src/
│       ├── config.js               ← All game constants (aircraft, environments, physics)
│       ├── GameEngine.js           ← Main loop, fixed timestep, orchestration
│       ├── physics/
│       │   └── FlightPhysics.js    ← Lift, drag, gravity, turbulence
│       ├── aircraft/
│       │   ├── AircraftController.js ← Physics integration, collision, stall, boost
│       │   └── AircraftModels.js   ← Procedural 3D models for all 6 types
│       ├── camera/
│       │   └── CameraSystem.js     ← Follow / Free / Cockpit / Cinematic modes
│       ├── world/
│       │   ├── WorldManager.js     ← Terrain, sky, water, clouds, buildings, rings
│       │   └── noise.js            ← Perlin/FBM noise for terrain generation
│       └── ui/
│           ├── HUD.js              ← In-game heads-up display
│           ├── InputHandler.js     ← Keyboard + mouse + gamepad input
│           └── AudioSystem.js      ← Procedural engine/wind sounds
└── backend/
    ├── server.js                   ← Express API + static file server
    ├── package.json
    └── data/
        └── scores.json             ← Persisted leaderboard scores
```

---

## ✈ Aircraft

| Aircraft | Type | Top Speed | Agility | Notes |
|---|---|---|---|---|
| Cessna 172 | Prop | Low | Medium | Beginner-friendly |
| Learjet 45 | Jet | High | Medium | Stable cruiser |
| F-16 Falcon | Fighter | Very High | Max | Advanced, twitchy |
| ASW 28 | Glider | Low | Medium | Silent, long range |
| Pitts Special | Stunt | Medium | Max | Aerobatics king |
| C-130 Hercules | Cargo | Medium | Low | Massive & powerful |

---

## 🌍 Environments

- **Alpine Mountains** — Snowy peaks with green valleys
- **Sahara Desert** — Vast dunes and rocky plateaus  
- **Coastal Islands** — Tropical islands with turquoise water
- **Metro City** — Dense urban skyline with skyscrapers
- **Red Canyon** — Narrow canyons and towering mesas

---

## 🎮 Controls

| Key | Action |
|---|---|
| **W / ↑** | Pitch up |
| **S / ↓** | Pitch down |
| **A / ←** | Roll left |
| **D / →** | Roll right |
| **Q / E** | Yaw left / right |
| **Shift** | Throttle up |
| **Ctrl** | Throttle down |
| **F** | Boost (afterburner) |
| **B** | Air brake |
| **C** | Cycle camera mode |
| **M** | Toggle mouse steering |
| **H** | Toggle help overlay |
| **Esc** | Pause |
| **Free Cam** | Drag mouse to orbit |
| **Scroll** | Zoom (free cam) |

**Gamepad** (auto-detected): Left stick = roll/pitch, Right stick = yaw/zoom, A = boost, B = brake.

---

## 🔌 API

### `GET /api/leaderboard`
Returns scores sorted by highest first.

```json
[
  {
    "id": "uuid",
    "player_name": "Maverick",
    "aircraft_type": "fighter",
    "game_mode": "challenge",
    "environment": "canyon",
    "score": 8500,
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
]
```

### `POST /api/submit-score`

```json
{
  "player_name": "Maverick",
  "aircraft_type": "fighter",
  "game_mode": "challenge",
  "environment": "canyon",
  "score": 8500
}
```

---

## 🛠 What Was Fixed / Added

### Bug Fixes
- ✅ **Aircraft stats not updating** — `stats` now read per-aircraft-type from config; HUD always shows correct speed/agility/stability for active aircraft
- ✅ **Camera drift** — Follow camera uses proper frame-rate-independent lerp (`1 - smoothing^(dt*60)`)
- ✅ **Two camera modes** — `follow` (locked) and `free` (orbit with mouse drag) fully implemented
- ✅ **Terrain collision** — Robust ground level with water floor, crash/landing detection
- ✅ **Obstacle collision** — Buildings registered as AABB obstacles; crash on contact

### New Features (Steps 3–9)
- 🎯 **Free orbit camera** — Right-click drag to orbit, scroll to zoom
- 🖥 **Full HUD** — Speed (kts), altitude (ft), V/S (fpm), heading, throttle bar, boost bar, G-force, stall warning, challenge timer
- 🌤 **Atmospheric sky shader** — Gradient sky dome with horizon haze
- ☁ **Cloud layer** — 60 billboard cloud clusters at ~1000m altitude  
- 💡 **Improved lighting** — Directional sun + hemisphere + ambient; sun tracks player
- 🏙 **City buildings** — 140 varied buildings with window strips and rooftop detail
- 📳 **Camera shake** — Intensity scales with speed fraction and stall
- 🎵 **Stall audio** — Low rumble added to engine + wind sounds
- 🏆 **Leaderboard** — Score submit modal with free-fly scoring formula
- 🎮 **Gamepad** — Full controller support via Gamepad API

---

## 🧱 Architecture Notes

- **No build step** — Uses browser `<script type="importmap">` with Three.js from jsDelivr CDN
- **Fixed timestep** — Physics runs at 60 Hz regardless of frame rate
- **ES modules** — All source files are clean ES modules; no webpack/React in production code
- **Backend unchanged** — Original Express leaderboard preserved exactly; only data path and static root corrected

---

## ✨ Visual FX (Added in Final Pass)

### Post-Processing Bloom
Manual 5-pass bloom pipeline (`src/fx/PostProcessor.js`):
- Scene rendered to WebGLRenderTarget
- Luminance threshold extracts bright pixels
- Horizontal + vertical Gaussian blur (4-tap kernel, half resolution)
- Additive composite back onto scene with Reinhard tone-mapping
- **Adaptive**: bloom strength increases at high speed and during boost/afterburner

### Contrail System (`src/fx/ContrailSystem.js`)
- Up to 1200 live particles using `THREE.Points` with custom GLSL shader
- Soft circular points with additive blending for volumetric feel
- Particles spawn from engine exhaust offset, expand and fade over 4.5 seconds
- Emission rate scales with speed; disabled at low throttle

### Speed Lines (`src/fx/SpeedLines.js`)
- Pure Canvas 2D radial streak overlay — zero GPU geometry cost
- 80 pre-seeded streak angles with random length/width/flicker
- Appears at >65% max speed, full intensity at 90%+
- Subtle flickering via sine-based per-line animation

### Weather System (`src/fx/WeatherSystem.js`)
- Rain: 2000 directional `PointsMaterial` particles with per-particle drift
- Snow: 800 particles with sinusoidal tumble and variable fall speed
- Storm: 4000-particle heavy rain mode
- Auto-assigned by environment (mountains→snow, city→rain)
- Switchable live via pause menu

### Instruments
- **Minimap** (`src/ui/Minimap.js`): Canvas radar showing aircraft position, heading vector, challenge rings numbered, world boundary, vignette
- **Attitude Indicator** (`src/ui/AttitudeIndicator.js`): Full artificial horizon — sky/ground gradient split by pitch, pitch ladder, bank triangle, fixed aircraft symbol drawn in canvas 2D

### Spawn Runway
- Asphalt strip at world origin (0,0) for every environment
- Centre-line dashes, threshold markings, orange edge lights
- Windsock pole as wind direction reference
