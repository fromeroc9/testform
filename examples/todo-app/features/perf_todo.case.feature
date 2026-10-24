@testcase @performance
Feature: Prueba de Carga y Rendimiento en Endpoint de Todos
  Como ingeniero de confiabilidad (SRE)
  Quiero evaluar la latencia y concurrencia de la API
  Para asegurar que cumple con el SLA definido

  @tc-perf-001 @load
  Scenario: Evaluación de latencia bajo peticiones concurrentes
    Given el endpoint objetivo "${var.api_base_url}/todos"
    When se ejecutan 15 peticiones concurrentes
    Then la latencia máxima p95 es inferior a ${var.perf_max_latency_ms} ms
    And la tasa de éxito de respuestas es del 100%
