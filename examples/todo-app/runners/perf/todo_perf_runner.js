/**
 * Performance Test Runner - Mapeado a features/perf_todo.case.feature
 * Ejecuta carga concurrente contra el endpoint público y evalúa el SLA de latencia p95.
 */

async function runPerformanceTest() {
  console.log('\n======================================================');
  console.log('⚡ [PERFORMANCE RUNNER] Evaluando SLA y Latencia (p95)');
  console.log('======================================================');

  const concurrency = 15;
  const targetUrl = 'https://jsonplaceholder.typicode.com/todos';
  const slaThresholdMs = 1500;

  console.log(`[RUNNING] @tc-perf-001: Disparando ${concurrency} peticiones concurrentes a: ${targetUrl}`);
  
  const startTime = Date.now();
  const requests = Array.from({ length: concurrency }, async (_, i) => {
    const reqStart = Date.now();
    try {
      const res = await fetch(`${targetUrl}/${(i % 10) + 1}`);
      const latency = Date.now() - reqStart;
      return { success: res.status === 200, latency };
    } catch (err) {
      return { success: false, latency: Date.now() - reqStart, error: err.message };
    }
  });

  const rawResults = await Promise.all(requests);
  const totalElapsed = Date.now() - startTime;

  const latencies = rawResults.map(r => r.latency).sort((a, b) => a - b);
  const successCount = rawResults.filter(r => r.success).length;
  const errorCount = rawResults.filter(r => !r.success).length;

  // Cálculo de Percentil 95 (p95)
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Latency = latencies[p95Index] || latencies[latencies.length - 1];
  const minLatency = latencies[0];
  const maxLatency = latencies[latencies.length - 1];
  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  const passed = p95Latency <= slaThresholdMs && errorCount === 0;

  console.log('\n[PERFORMANCE RUNNER] Métricas de Rendimiento:');
  console.log(`  • Peticiones totales:     ${concurrency}`);
  console.log(`  • Éxitos:                 ${successCount} (100%)`);
  console.log(`  • Errores:                ${errorCount}`);
  console.log(`  • Latencia Mínima:        ${minLatency}ms`);
  console.log(`  • Latencia Promedio:      ${avgLatency}ms`);
  console.log(`  • Latencia Máxima:        ${maxLatency}ms`);
  console.log(`  • Latencia p95:           ${p95Latency}ms (Umbral SLA: ${slaThresholdMs}ms)`);
  console.log(`  • Tiempo total prueba:    ${totalElapsed}ms`);

  if (passed) {
    console.log(`\n  ✓ @tc-perf-001: PASSED (Cumple con SLA de ${slaThresholdMs}ms)`);
    return { id: '@tc-perf-001', status: 'passed', p95Latency, successCount };
  } else {
    console.log(`\n  ✗ @tc-perf-001: FAILED (Excedió el SLA o hubo errores de red)`);
    return { id: '@tc-perf-001', status: 'failed', p95Latency, errorCount };
  }
}

if (require.main === module) {
  runPerformanceTest();
}

module.exports = { runPerformanceTest };
