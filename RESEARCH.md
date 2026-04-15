# Research Documentation — Distributed Snapshot & Time-Travel Debugging System

## A. Architecture Overview

```mermaid
graph TB
    subgraph Frontend["🖥️ React Dashboard (port 5173)"]
        OV[Overview Tab]
        TL[Timeline Tab]
        CG[Causality DAG]
        SP[Snapshots Tab]
        RP[Replay Tab]
        FI[Fault Injection]
        BM[Benchmark Tab]
        VS[Validation Tab]
        VF[Verify Replay Tab]
    end

    subgraph Backend["⚙️ Node.js Backend (port 3001)"]
        API[REST API\n/api/*]
        WS[WebSocket\n/ws]
        
        subgraph Nodes["Edge Node Cluster"]
            N1[node-1]
            N2[node-2]
            N3[node-n]
        end
        
        MB[MessageBus\nasync routing]
        FC[FaultController\nSTORM·PARTITION\nCRASH·DELAY]
        
        subgraph Clocks["Logical Clocks"]
            LC[LamportClock]
            VC[VectorClock\nhappens-before]
        end
        
        subgraph Snapshot["Snapshot System"]
            CO[Coordinator\nChandy-Lamport]
            SV[SnapshotValidator\n4 invariants]
            SS[SnapshotStorage\ngzip+MongoDB]
        end
        
        subgraph ReplaySystem["Replay System"]
            RE[ReplayEngine v2\nStrict causal sort\nSHA-256 verify]
        end
        
        subgraph Benchmark["Benchmark System"]
            BR[BenchmarkRunner\n48 experiments]
        end
        
        EL[EventLogger\nRedis+MongoDB\n+in-memory]
        PM[Prometheus\nMetrics]
    end
    
    subgraph Databases["💾 Storage (optional)"]
        RD[(Redis\nFast event logs)]
        MG[(MongoDB\nPersistent store)]
    end

    Frontend -- REST+WebSocket --> Backend
    Nodes --> MB
    MB --> FC
    FC --> EL
    Nodes --> Clocks
    CO --> Nodes
    CO --> SS
    SV --> SS
    RE --> SS
    RE --> EL
    BR --> Nodes
    EL --> RD & MG
    SS --> MG
    API & WS --> PM
```

---

## B. Chandy-Lamport Snapshot Flow

```mermaid
sequenceDiagram
    participant C as Coordinator
    participant N1 as node-1
    participant N2 as node-2
    participant N3 as node-3
    
    Note over C: initiateSnapshot()
    C->>N1: MARKER (initiator)
    N1->>N1: Record local state
    N1->>N2: MARKER
    N1->>N3: MARKER
    
    N2->>N2: Record local state on 1st marker
    Note over N2: Start recording N1→N2 channel
    N2->>N3: Forward MARKER
    
    N3->>N3: Record local state on 1st marker  
    Note over N3: Start recording N1→N3, N2→N3 channels
    N3->>N2: Forward MARKER (N3→N2 channel done)
    
    N2->>N2: N3→N2 channel complete (0 in-transit msgs)
    N2-->>C: emit 'snapshotComplete' (node-2 state)
    
    N3-->>C: emit 'snapshotComplete' (node-3 state)
    N1-->>C: emit 'snapshotComplete' (node-1 state)
    
    Note over C: All nodes reported → assemble global snapshot
    C->>C: Save snapshot to SnapshotStorage
    C->>C: Broadcast snapshot via WebSocket
```

---

## C. Deterministic Replay Flow

```mermaid
flowchart TD
    A[Load Snapshot ID] --> B[Restore node states\nfrom snapshot]
    B --> C[Fetch all events\n after snapshot.initiatedAt]
    C --> D[Causal Sort\nPrimary: Vector Clock happens-before\nTiebreak 1: Lamport timestamp\nTiebreak 2: nodeId lexicographic\nTiebreak 3: wall-clock timestamp]
    D --> E{Replay Mode}
    E -->|play| F[setInterval\nstepForward every 500ms]
    E -->|step| G[Advance currentIndex by 1]
    E -->|jump| H[Set currentIndex = target]
    E -->|verify| I[Silent Replay Run 1\ncompute SHA-256 hash]
    I --> J[Silent Replay Run 2\ncompute SHA-256 hash]
    J --> K{hash1 == hash2?}
    K -->|yes| L[✅ Deterministic\nreturn hashes]
    K -->|no| M[❌ Non-Deterministic\nreturn mismatch details]
    F & G & H --> N[Broadcast replay event\nvia WebSocket]
```

---

## D. Benchmark Results (Interpretation)

The benchmark matrix runs **48 experiments** (4 node counts × 3 message rates × 4 fault scenarios).

### Expected Trends

| Dimension | Expected Observation |
|-----------|---------------------|
| **Latency vs Node Count** | Super-linear growth due to O(n²) marker messages in Chandy-Lamport |
| **Latency with crash fault** | Higher variance; some snapshots may timeout and retry |
| **Latency with delay fault** | Linear increase proportional to injected delay × hop count |
| **Replay time vs rate** | Higher rates → more events to sort → O(n log n) replay time |
| **Memory usage** | Grows with event log size; in-memory fallback avoids GC pressure |

### Benchmark API

```bash
# Start full benchmark (background)
curl -X POST http://localhost:3001/api/benchmark/run

# Poll progress
curl http://localhost:3001/api/benchmark/status

# Fetch results with chart data
curl http://localhost:3001/api/benchmark/results

# Download CSV
curl http://localhost:3001/api/benchmark/csv -o results.csv

# Or run standalone CLI
node backend/scripts/runExperiments.js --quick
```

---

## E. System Guarantees

### Consistency Guarantees

| Guarantee | Mechanism | Verified By |
|-----------|-----------|-------------|
| **Cut consistency** | Chandy-Lamport marker protocol | SnapshotValidator |
| **No missing messages** | Channel recording between first marker and own marker | `CHANNEL_MSG_NO_SEND` check |
| **No duplicate messages** | Each channel recorded exactly once | `DUPLICATE_MESSAGE` check |
| **Causal ordering** | Vector clock happens-before + Lamport tiebreaker | ReplayEngine `_causalSort()` |

### Determinism Guarantees

> **Theorem**: Given the same initial snapshot S and event sequence E, the replay engine produces identical final state F every time.

This holds because:

1. **Initial state** is exactly reproduced from snapshot (deterministic deserialization)
2. **Event sequence** is sorted by a **total order** (VC → Lamport → **nodeId** → timestamp)
   - The nodeId tiebreaker is the critical addition that makes concurrent events deterministically ordered
3. **No runtime randomness** enters replay (all non-deterministic inputs occurred during original execution and are captured in event logs)
4. **Hash verification** (`POST /replay/verify`) proves determinism by running replay twice

### Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| In-process simulation | Not production gRPC/TCP | Replace MessageBus with gRPC adapter |
| Wall-clock timestamps for tiebreak | Machine clock skew | Use logical timestamps exclusively |
| Snapshot coordinator is centralized | Single point of failure | Extend with multi-coordinator leader election |
| No persistent benchmark history across restarts | Results lost if Redis down | Benchmark results written to disk JSON |
| D3 visualizations cap events at 500 for performance | Very long runs show partial timeline | Implement event windowing |

---

## F. API Quick Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/snapshot` | POST | Trigger Chandy-Lamport snapshot |
| `/api/snapshot/validate/:id` | POST | Validate invariants on snapshot |
| `/api/snapshot/validate-all` | GET | Validate all stored snapshots |
| `/api/replay/verify` | POST | SHA-256 determinism verification |
| `/api/faults/scenario` | POST | Activate STORM / CRASH_DURING_SNAPSHOT / DELAYED_MARKERS / PARTITION |
| `/api/benchmark/run` | POST | Launch full benchmark matrix |
| `/api/benchmark/results` | GET | Fetch results + chart data |
| `/api/benchmark/csv` | GET | Download results as CSV |
| `/api/benchmark/status` | GET | Current benchmark progress |

---

## G. Experiment Automation

```bash
# Full matrix (48 experiments, ~5-8 min)
node backend/scripts/runExperiments.js

# Quick matrix (8 experiments, ~1 min)
node backend/scripts/runExperiments.js --quick

# Output files:
# backend/data/experiment_results.json  — full JSON with chart data
# backend/data/results.csv              — CSV for Excel/Python plotting
# backend/data/benchmark_results.json  — used by API /benchmark/results
```

### Plotting with Python (example)

```python
import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv('backend/data/results.csv')

# Latency vs node count
df.groupby('nodeCount')['snapshotLatencyMs'].mean().plot(kind='bar', title='Snapshot Latency vs Nodes')
plt.show()

# Replay by fault scenario  
df.groupby('faultScenario')['replayTimeMs'].mean().plot(kind='bar', title='Replay Time by Fault')
plt.show()
```
