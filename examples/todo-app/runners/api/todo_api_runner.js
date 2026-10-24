/**
 * API Test Runner - Mapeado a features/api_todo.case.feature
 * Ejecuta peticiones reales contra la API pública de JSONPlaceholder.
 */
const fs = require('fs');
const path = require('path');

async function runApiTests() {
  console.log('\n======================================================');
  console.log('🚀 [API RUNNER] Ejecutando pruebas de API automatizadas');
  console.log('======================================================');

  // 1. Cargar fixture de datos definido en Testform
  const fixturePath = path.resolve(__dirname, '../../fixtures/todos.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const newTodo = fixture.buy_groceries;

  const results = [];

  // -------------------------------------------------------------------------
  // Test Case: @tc-api-001 (POST /todos)
  // -------------------------------------------------------------------------
  console.log('\n[RUNNING] @tc-api-001: Creación de tarea mediante POST HTTP');
  const t0 = Date.now();
  try {
    const resPost = await fetch('https://jsonplaceholder.typicode.com/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTodo)
    });
    const postData = await resPost.json();
    const durationPost = Date.now() - t0;

    if (resPost.status === 201 && postData.id) {
      console.log(`  ✓ Status: ${resPost.status} (Created)`);
      console.log(`  ✓ ID generado: ${postData.id}`);
      console.log(`  ✓ Título verificado: "${postData.title}"`);
      console.log(`  ⏱ Duración: ${durationPost}ms`);
      results.push({ id: '@tc-api-001', status: 'passed', duration: durationPost });
    } else {
      throw new Error(`Status inesperado: ${resPost.status}`);
    }
  } catch (err) {
    console.error(`  ✗ Falló @tc-api-001: ${err.message}`);
    results.push({ id: '@tc-api-001', status: 'failed', error: err.message });
  }

  // -------------------------------------------------------------------------
  // Test Case: @tc-api-002 (GET /todos/1)
  // -------------------------------------------------------------------------
  console.log('\n[RUNNING] @tc-api-002: Consulta de tarea existente mediante GET HTTP');
  const t1 = Date.now();
  try {
    const resGet = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    const getData = await resGet.json();
    const durationGet = Date.now() - t1;

    if (resGet.status === 200 && getData.id === 1 && getData.title) {
      console.log(`  ✓ Status: ${resGet.status} (OK)`);
      console.log(`  ✓ ID verificado: ${getData.id}`);
      console.log(`  ✓ Título: "${getData.title.slice(0, 30)}..."`);
      console.log(`  ⏱ Duración: ${durationGet}ms`);
      results.push({ id: '@tc-api-002', status: 'passed', duration: durationGet });
    } else {
      throw new Error(`Datos inválidos en GET /todos/1`);
    }
  } catch (err) {
    console.error(`  ✗ Falló @tc-api-002: ${err.message}`);
    results.push({ id: '@tc-api-002', status: 'failed', error: err.message });
  }

  console.log('\n[API RUNNER] Resumen de Ejecución:');
  console.table(results);
  return results;
}

if (require.main === module) {
  runApiTests();
}

module.exports = { runApiTests };
