@testcase @e2e
Feature: Gestión de Tareas en Aplicación Web TodoMVC
  Como usuario de la aplicación
  Quiero gestionar mi lista de tareas
  Para organizar mis actividades diarias

  @tc-e2e-001 @smoke
  Scenario: Creación de una nueva tarea en TodoMVC
    Given el navegador abre la URL "${var.e2e_app_url}"
    When el usuario ingresa la tarea "Aprender Testform y Test-as-Code"
    And presiona la tecla Enter
    Then la lista de tareas contiene 1 elemento
    And el texto de la tarea es "Aprender Testform y Test-as-Code"

  @tc-e2e-002 @regression
  @depends_on("features/e2e_todo.case.feature.@tc-e2e-001")
  Scenario: Marcar tarea como completada
    Given existe al menos 1 tarea en la lista
    When el usuario hace clic en el checkbox de la tarea
    Then el estado de la tarea cambia a completada
    And el contador de tareas pendientes se actualiza a 0
