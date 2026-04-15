#!/usr/bin/env node
/**
 * runExperiments.js — CLI automation script for benchmark experiments.
 * 
 * Usage:
 *   node scripts/runExperiments.js              -- run full matrix
 *   node scripts/runExperiments.js --quick      -- 2 nodes, low rate, no fault only
 *   node scripts/runExperiments.js --json       -- output JSON to stdout
 *   node scripts/runExperiments.js --csv        -- write CSV to data/results.csv
 */
const path = require('path');
const fs = require('fs');

// Bootstrap in-process environment
const MessageBus = require('../src/node/messageBus');
const EdgeNode = require('../src/node/edgeNode');
const FaultController = require('../src/faultInjection/faultController');
const EventLogger = require('../src/logging/eventLogger');
const SnapshotStorage = require('../src/snapshot/snapshotStorage');
const SnapshotCoordinator = require('../src/snapshot/coordinator');
const ReplayEngine = require('../src/replay/replayEngine');
const BenchmarkRunner = require('../src/benchmark/benchmarkRunner');

const args = process.argv.slice(2);
const isQuick = args.includes('--quick');
const outputJson = args.includes('--json');
const outputCsv = args.includes('--csv');

async function main() {
  console.log('\n🔬 DistDebug Experiment Runner\n' + '─'.repeat(50));

  const bus = new MessageBus();
  const fc = new FaultController();
  const logger = new EventLogger();
  const storage = new SnapshotStorage();
  const coordinator = new SnapshotCoordinator(bus, storage, logger);
  const replay = new ReplayEngine(storage, logger, [], () => {});

  const runner = new BenchmarkRunner(bus, coordinator, storage, logger, replay, fc, null);

  const opts = isQuick
    ? {
        nodeCounts: [2, 5],
        messageRates: { low: 0.15, medium: 0.45 },
        faultScenarios: ['none', 'delay'],
      }
    : undefined; // Run full matrix

  const total = isQuick ? (2 * 2 * 2) : (4 * 3 * 4);
  console.log(`📋 Running ${total} experiments (${isQuick ? 'quick mode' : 'full matrix'})...\n`);

  let lastPct = -1;
  const progressInterval = setInterval(() => {
    const p = runner.getProgress();
    const pct = total > 0 ? Math.floor((p.current / total) * 100) : 0;
    if (pct !== lastPct && p.experiment) {
      console.log(`  [${String(p.current).padStart(3)}/${total}] ${pct}% — n=${p.experiment.nodeCount} rate=${p.experiment.rateName} fault=${p.experiment.fault}`);
      lastPct = pct;
    }
  }, 500);

  const results = await runner.runAll(opts);
  clearInterval(progressInterval);

  console.log(`\n✅ Completed ${results.length} experiments\n`);

  // Summary table
  const chartData = runner.getChartData();
  console.log('📊 Snapshot Latency vs Node Count:');
  for (const { nodeCount, avgLatencyMs } of chartData.latencyVsNodes) {
    const bar = '█'.repeat(Math.min(40, Math.floor(avgLatencyMs / 5)));
    console.log(`  n=${String(nodeCount).padEnd(3)} ${bar} ${avgLatencyMs}ms`);
  }

  console.log('\n💥 Latency by Fault Scenario:');
  for (const { fault, avgLatencyMs } of chartData.latencyVsFault) {
    console.log(`  ${String(fault).padEnd(24)} ${avgLatencyMs}ms`);
  }

  console.log('\n⏮️  Replay Time by Message Rate:');
  for (const { rate, avgReplayMs } of chartData.replayVsRate) {
    console.log(`  ${String(rate).padEnd(10)} ${avgReplayMs}ms`);
  }

  // Data directory
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // JSON output
  const jsonPath = path.join(dataDir, 'experiment_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ results, chartData }, null, 2));
  console.log(`\n💾 JSON → ${jsonPath}`);

  // CSV output
  const csvPath = path.join(dataDir, 'results.csv');
  fs.writeFileSync(csvPath, runner.exportCSV());
  console.log(`📄 CSV  → ${csvPath}`);

  if (outputJson) {
    process.stdout.write(JSON.stringify({ results, chartData }, null, 2));
  }

  console.log('\n🏁 Done.\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
