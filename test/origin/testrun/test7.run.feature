@high
Feature: Ejecución Nocturna
  Este testrun se ejecuta por la noche. Incluye todo el módulo de login y un par de casos de maestros.

  Background:
    * field descripcion = "Nightly Run - Login y Maestros parcial"

  Rule: tc1.case.feature

  Rule: tc3.case.feature

  Scenario: @[2]

  Scenario: @[3]
