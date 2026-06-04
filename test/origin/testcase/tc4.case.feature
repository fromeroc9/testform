@testcase @high
Feature: Variables Test

  @[4]
  Scenario: Test variable replacement
    Given the environment is "${var.ambiente}"
    When I run the test
    * field automate = apply
    Then the result should be "${var.resultado}"
