# Distributed Snapshot & Time-Travel Debugging System — Project Guide

This document provides a comprehensive and detailed explanation of the project's features, functionality, and the specific role of each file in the system.

---

## 🌟 Project Overview

The **Distributed Snapshot & Time-Travel Debugging System** is a research-grade framework designed to simulate, monitor, and debug edge computing environments. It addresses the fundamental challenges of observability in distributed systems: **consistency**, **causality**, and **reproducibility**.

### Core Objectives
1.  **Consistent Global State**: Capturing a "snapshot" of the entire system (all nodes and in-transit messages) without stopping execution.
2.  **Causality Tracking**: Understanding the "happens-before" relationship between events across different nodes.
3.  **Deterministic Replay**: Stepping back in time to a specific snapshot and re-executing events in the exact order they originally occurred to debug complex race conditions or faults.

---

## 🛠️ Key Features & Functionality

### 1. Chandy-Lamport Snapshot Algorithm
The system implements the classic **Chandy-Lamport algorithm** to capture consistent global states.
-   **Markers**: A special control message (`MARKER`) is used to delineate "before" and "after" states.
-   **Channel Recording**: Nodes record incoming messages on channels where they have not yet received a marker, capturing "in-transit" data.
-   **Non-Blocking**: The entire operation happens while the system continues to process application-level messages.

### 2. Logical Clocks (Lamport & Vector)
To track time and causality without relying on synchronized physical clocks:
-   **Lamport Clocks**: Provide a partial ordering of events. Each event gets a monotonically increasing integer timestamp.
-   **Vector Clocks**: Provide a full causal "happens-before" relationship. Each node maintains a vector of timestamps (one for every node in the system). This allows the system to detect if two events were concurrent or if one caused the other.

### 3. Deterministic Replay Engine
This is the "Time-Travel" part of the system.
-   **State Restoration**: The engine can "teleport" all nodes back to their exact state at any previously captured snapshot.
-   **Causal Sorting**: Events are replayed using a strict total order:
    1.  Vector Clock (Happens-before relation).
    2.  Lamport Timestamp (Tiebreaker).
    3.  Node ID (Lexicographic Tiebreaker for concurrent events).
    4.  Wall-clock Timestamp (Final fallback).
-   **Determinism Verification**: Use SHA-256 hashing to prove that replaying the same events from the same snapshot always results in the same final state.

### 4. Fault Injection System
Simulates real-world distributed system failures:
-   **CRASH**: Nodes stop processing and responding.
-   **DELAY**: Messages are slowed down, simulating network latency.
-   **DROP**: Messages are lost, simulating unreliable links.
-   **PARTITION**: Nodes are split into groups that cannot communicate with each other.

### 5. Benchmark Matrix
A dedicated system that runs automated experiments (48 variants) to measure:
-   Snapshot latency across different node counts.
-   The impact of faults on system consistency.
-   Replay performance and determinism overhead.

---

## 📂 Backend File-by-File Functionality (`backend/src/`)

### 🛰️ Node & Messaging (`/node`)
-   **`edgeNode.js`**: The heart of the simulation. Each instance represents an independent actor. It contains the logic for autonomous behavior (randomly sending messages), clock management, and the local implementation of the Chandy-Lamport marker protocol.
-   **`messageBus.js`**: An asynchronous, in-process routing layer. It delivers messages between nodes and provides the "infrastructure" for the coordinator to send markers and nodes to report snapshot completion.

### ⏰ Logical Clocks (`/clocks`)
-   **`lamportClock.js`**: A simple integer clock that increments on every event and merges on receive.
-   **`vectorClock.js`**: Implements the `happensBefore` and `merge` logic. It is fundamental for sorting events during replay and visualizing causality in the frontend.

### 📸 Snapshot System (`/snapshot`)
-   **`coordinator.js`**: Orchestrates the global snapshot process. It generates unique snapshot IDs, sends initial markers, collects local contributions from nodes, and assembles the final "Global Snapshot" object.
-   **`snapshotStorage.js`**: Handles persistence. It saves snapshots to MongoDB (if available) or falls back to an in-memory storage manager.
-   **`snapshotValidator.js`**: Checks captured snapshots for consistency invariants (e.g., no missing messages, no duplicates, valid cuts).

### 🎞️ Replay & Causality (`/replay` & `/causality`)
-   **`replayEngine.js`**: Manages the time-travel state machine. It handles `play`, `pause`, `step`, and `jump` actions. It features the `_causalSort` algorithm which is the "brain" of the deterministic replay.
-   **`causalityGraph.js`**: A utility that converts raw event logs into a Directed Acyclic Graph (DAG) structure used by the frontend for visualization.

### 📁 Logging & Storage (`/logging` & `/db`)
-   **`eventLogger.js`**: A centralized sink for all system events (SEND, RECEIVE, INTERNAL, CRASH, etc.). Supports Redis for high-speed logging and MongoDB for long-term storage.
-   **`logTypes.js`**: Defines the constants for all types of events logged by the system.
-   **`models.js`**: Mongoose schemas for Snapshot and Event records.

### 🧪 Research Tools (`/faultInjection` & `/benchmark`)
-   **`faultController.js`**: Implements the fault injection logic. It intercepts messages in the `MessageBus` and applies delays or drops based on the active configuration or "Scenario" (e.g., STORM, PARTITION).
-   **`benchmarkRunner.js`**: A scriptable engine that automates the execution of multiple system runs with varying parameters to generate research data.

### 🚦 Infrastructure (`/metrics` & `/api`)
-   **`prometheusMetrics.js`**: Integration with Prometheus. It exports histograms and counters for snapshot latency, message counts, and fault occurrences.
-   **`routes.js`**: The REST API layer. Exposes endpoints for triggering snapshots, controlling replay, injecting faults, and fetching metrics.
-   **`server.js`**: The main entry point. Initializes the Express server, WebSocket server, Database connections, and wires all components together.

---

## 🎨 Frontend File-by-File Functionality (`frontend/src/`)

### 🏠 Core Application
-   **`App.jsx`**: The main layout and state manager. It routes between different "Tabs" (Overview, Timeline, Replay, Benchmark) and manages the global WebSocket connection to the backend.
-   **`index.css`**: Contains the design system, including Glassmorphism effects, animations, and the dark-mode aesthetic.

### 🧩 Components (`/components`)
-   **`NetworkGraph.jsx`**: A real-time D3.js visualization of nodes and the messages flying between them.
-   **`EventTimeline.jsx`**: A horizontal Gantt-style chart showing events (circles) and causality links (arrows) across different "swimlanes" (one per node).
-   **`CausalityGraph.jsx`**: A complex DAG visualization that lets users hover over events to see their "Causal Parents" (what happened before them).
-   **`ReplayControls.jsx`**: The UI for the Time-Travel feature (Play, Pause, Step, Progress bar).
-   **`SnapshotPanel.jsx`**: Displays a list of captured snapshots and allows users to "teleport" to them.
-   **`FaultInjector.jsx`**: A dashboard to manually crash nodes or trigger complex fault scenarios like "Network Partition".
-   **`BenchmarkChart.jsx`**: Visualizes the results from the benchmark engine using Chart.js.
-   **`ReplayVerifier.jsx`**: UI for proving determinism. Shows the SHA-256 hashes of different replay runs.
-   **`SnapshotValidatorPanel.jsx`**: Provides a deep-dive into snapshot internals, showing if the state is consistent and where in-transit messages were captured.

---

## ⚙️ Configuration
-   **`docker-compose.yml`**: Defines the full stack (Backend, Frontend, Redis, MongoDB, Prometheus, Grafana).
-   **`prometheus.yml`**: Configures Prometheus to scrape metrics from the backend's `/metrics` endpoint.
-   **.env**: Environment variables for database URLs and port configurations.
