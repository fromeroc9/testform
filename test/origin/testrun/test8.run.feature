@medium
Feature: Ejecución Dinámica con Examples
  Este testrun demuestra el uso de @unique y Examples para generar llamadas a múltiples casos de prueba de forma paramétrica.

  Background:
    * field descripcion = "Ejecución usando tabla de Examples"

  Rule: tc2.feature

  @unique
  Scenario: @[2-<rol>]

    Examples:
      | rol                 |
      | Desarrollador Java  |
      | Analista QA         |
      | Gerente de Proyecto |
