@testcase @api
Feature: API Pública de Tareas (JSONPlaceholder REST)
  Como servicio consumidor de la API de Todos
  Quiero interactuar con los endpoints REST
  Para sincronizar tareas en el backend

  @tc-api-001 @smoke
  Scenario: Creación de tarea mediante POST HTTP
    Given el endpoint REST es "${var.api_base_url}/todos"
    When envío un POST con el título "${data.todos_fixture.buy_groceries.title}"
    Then la API responde con código de estado HTTP 201
    And la respuesta contiene un ID numérico generado

  @tc-api-002 @regression
  Scenario: Consulta de tarea existente mediante GET HTTP
    Given el endpoint de consulta es "${var.api_base_url}/todos/1"
    When realizo una petición GET
    Then el código de respuesta HTTP es 200
    And el campo "id" es 1
    And el campo "title" no está vacío
