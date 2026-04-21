# LeTour Guide

Real-time, channel-based live audio broadcast and listening web app built with Astro + React + WebSockets.

## Project Purpose

LeTour Guide provides two primary experiences:

- Broadcast page: a tour guide streams live microphone audio to a selected channel.
- Listen page: guests choose a channel and hear that live stream in near real time.

The system includes a per-channel lock so only one broadcaster can transmit to a channel at a time.

## Current Status (Handoff Summary)

- Web app is functional for local development.
- Real-time audio transport is implemented through `GET /api/server` WebSocket upgrades.
- Locking and inactivity handling are implemented server-side.
- No authentication/authorization exists yet.
- Production container/deployment files need reconciliation with the current Astro server entry point (details below).

## High-Level Architecture

1. Broadcaster joins a channel with role `broadcaster`.
2. Listener joins a channel with role `listener`.
3. Server grants one broadcaster lock per channel.
4. Broadcaster microphone audio is captured in an AudioWorklet and sent as binary frames.
5. Server relays binary audio frames to listeners in the same channel.
6. Heartbeats + inactivity timers release stale locks and clean up inactive listeners.

## Quick Start

```bash
git clone https://github.com/BossDaily/letour-guide.git
cd letour-guide
npm install
npm run dev
```

Default local app URL: `http://localhost:4321`

## Available Scripts

- `npm run dev`: Start Astro dev server.
- `npm run build`: Build production output.
- `npm run preview`: Preview built app.
- `npm run astro`: Run Astro CLI directly.
- `npm run start`: Start built Astro server (`./dist/server/entry.mjs`).

## Broadcast Locking Behavior

Per channel, only one broadcaster can hold the lock.

- `lock_granted`: broadcaster can transmit.
- `lock_denied`: another broadcaster already owns the lock.
- `lock_owner`: informs clients who currently owns lock.
- `lock_released`: lock released due to disconnect or inactivity.

Timeouts currently implemented in server logic:

- Broadcaster inactivity timeout: `10000 ms`
- Listener inactivity timeout: `30000 ms`
- Listener cleanup scan interval: `5000 ms`

## Audio Frame Format (Current)

Broadcaster sends binary payload:

- First 4 bytes: `Uint32` sample rate (little endian)
- Remaining bytes: `Float32Array` PCM samples

Listener decodes frame, resamples if needed, then plays through WebAudio.

## Manual Verification

### 1. Browser Audio Test

1. Start app: `npm run dev`
2. Open `/broadcast` in one tab and `/listen` in another.
3. Select same channel on both pages.
4. Start mic on broadcaster and confirm listener receives audio.

### 2. Lock Logic Script Test

Run:

```bash
npm run dev
node tools/test-lock.js ws://localhost:4321/api/server
```

Expected behavior:

- Client A gets lock.
- Client B is denied while A owns lock.
- After inactivity timeout, lock is released.
- Client B can then acquire lock.

## If hosting on CS Lab

For cs-lab style manual deployment, prior team process was:

1. Bump version in environment/config as needed.
2. Create a new `public_html` version folder (example: `v0.04`).
3. Copy `dist/`, `public/`, `package.json`, and `package-lock.json`.

## Known Gaps and Risks

1. Security: no auth for broadcaster access; anyone can attempt to broadcast.
2. Audio quality: occasional clipping/glitch artifacts reported.
3. Monitoring: no logging aggregation, health checks, or alerting.
4. Testing: no automated test suite for websocket protocol/audio flow.

## Recommended Next Steps (Priority Order)

1. Add broadcaster authentication/authorization. Security is critical!
2. Improve audio buffering/jitter handling to reduce clipping.
3. Add observability basics (structured logs, health endpoint, uptime checks).

## Troubleshooting

- Microphone fails to start:
	- Verify browser mic permissions and HTTPS/localhost security context.
- No audio on listener:
	- Confirm broadcaster has lock and both clients are on same channel.
	- Check browser autoplay policies and volume.
- Lock never transfers:
	- Verify heartbeats/connection state and wait at least 10 seconds for inactivity release.
- Connected users count looks wrong:
	- Refresh channel subscriptions and verify stale clients are being disconnected.