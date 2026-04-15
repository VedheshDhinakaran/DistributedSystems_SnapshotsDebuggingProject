# Distributed Snapshot & Time-Travel Debugging System for Edge Applications

A research-grade distributed debugging framework that simulates an edge computing environment with multiple independent nodes, captures consistent global snapshots using the **Chandy-Lamport algorithm**, tracks causality via **vector clocks**, and enables **deterministic time-travel replay** with an interactive dashboard.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│  React + D3.js Dashboard  (port 5173)               │
│  EventTimeline · NetworkGraph · CausalityGraph      │
│  ReplayControls · SnapshotPanel · FaultInjector     │
└──────────────┬──────────────────────────────────────┘
               │ WebSocket (ws://...:3001/ws)
               │ REST API  (http://...:3001/api)
┌──────────────▼──────────────────────────────────────┐
│  Node.js Backend  (port 3001)                       │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ EdgeNode │  │  Coordinator │  │ ReplayEngine  │ │
│  │ ×5 nodes │  │(Chandy-Lampt)│  │(Causal sort)  │ │
│  └────┬─────┘  └──────────────┘  └───────────────┘ │
│  ┌────▼─────┐  ┌──────────────┐  ┌───────────────┐ │
│  │MessageBus│  │ EventLogger  │  │FaultController│ │
│  │(in-proc) │  │Redis+MongoDB │  │ delay/drop    │ │
│  └──────────┘  └──────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────┘
     │              │
  Redis :6379    MongoDB :27017
  Prometheus :9090   Grafana :3000
```

---

## 🚀 Quick Start

### Option A — Local Development (No Docker)

**Requirements:** Node.js 18+

```bash
# Backend
cd backend
npm install
npm run dev    # starts on :3001

# Frontend (new terminal)
cd frontend
npm install
npm run dev    # starts on :5173
```

Open **http://localhost:5173**

> Redis and MongoDB are optional — the system automatically falls back to in-memory storage if they're unavailable.

### Option B — Docker Compose (Full Stack)

```bash
docker-compose up -d
```

| Service    | URL                      |
|------------|--------------------------|
| Dashboard  | http://localhost:5173    |
| Backend    | http://localhost:3001    |
| Prometheus | http://localhost:9090    |
| Grafana    | http://localhost:3000    |

---

## 🔬 Core Algorithms

### Chandy-Lamport Snapshot Algorithm
1. Coordinator sends `MARKER` to all nodes
2. Each node: on first marker → **record local state**, forward markers to all peers
3. Each node: record in-transit messages on each channel until marker from that channel arrives
4. When all nodes complete → assemble global consistent snapshot

### Vector Clocks
- Each node maintains `{ nodeId → logicalTime }` map
- **Send/internal:** increment own component
- **Receive:** element-wise max of received + local, then increment own
- **Happens-before:** `A → B` iff all `A[i] ≤ B[i]` and ∃j: `A[j] < B[j]`
- **Concurrent:** neither happens-before the other

### Replay Engine
1. Load snapshot → restore all node states
2. Fetch all events after snapshot timestamp
3. Topological sort by vector clock (Lamport fallback for concurrent events)
4. Replay step-by-step with play/pause/step/jump controls

---

## 📡 API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nodes` | GET | All node states |
| `/api/nodes/:id/crash` | POST | Crash a node |
| `/api/nodes/:id/recover` | POST | Recover a node |
| `/api/snapshot` | POST | Trigger Chandy-Lamport snapshot |
| `/api/snapshots` | GET | List all snapshots |
| `/api/snapshots/:id` | GET | Get snapshot detail |
| `/api/replay/:id/load` | POST | Load snapshot for replay |
| `/api/replay/play` | POST | Start replay |
| `/api/replay/pause` | POST | Pause replay |
| `/api/replay/step` | POST | Step one event forward |
| `/api/replay/jump/:target` | POST | Jump to event |
| `/api/events` | GET | Query event log |
| `/api/fault/:nodeId` | POST | Set fault config |
| `/api/fault/:nodeId` | DELETE | Clear fault config |
| `/metrics` | GET | Prometheus metrics |

**WebSocket:** `ws://localhost:3001/ws` — real-time event stream

---

## 🧪 Testing

```bash
cd backend
npm test
```

Test coverage:
- Lamport Clock: increment, update, ordering
- Vector Clock: increment, merge, happens-before, concurrent, equal, clone, no double counting
- Snapshot: complete with all nodes, store/load, metrics, event logging

---

## 📊 Metrics (Prometheus)

| Metric | Description |
|--------|-------------|
| `snapshot_latency_seconds` | Histogram of snapshot completion time |
| `snapshot_total` | Total snapshots taken |
| `events_logged_total` | Events by node and type |
| `messages_sent_total` | Total messages across nodes |
| `messages_dropped_total` | Dropped messages (fault injection) |
| `active_nodes` | Currently active nodes |

---

## 📁 Project Structure

```
dbs-project/
├── backend/
│   ├── src/
│   │   ├── clocks/          # LamportClock, VectorClock
│   │   ├── node/            # EdgeNode, MessageBus
│   │   ├── snapshot/        # Coordinator (Chandy-Lamport), SnapshotStorage
│   │   ├── logging/         # EventLogger (Redis+MongoDB+in-memory)
│   │   ├── replay/          # ReplayEngine
│   │   ├── faultInjection/  # FaultController
│   │   ├── metrics/         # Prometheus metrics
│   │   ├── api/             # REST routes
│   │   ├── db/              # Mongoose models
│   │   └── server.js        # Entry point
│   └── tests/               # Unit + integration tests
├── frontend/
│   └── src/
│       ├── components/      # NetworkGraph, EventTimeline, CausalityGraph,
│       │                    # ReplayControls, SnapshotPanel, FaultInjector
│       └── App.jsx
├── docker-compose.yml
├── prometheus.yml
└── README.md
```
