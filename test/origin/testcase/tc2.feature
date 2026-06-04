@testcase
Feature: Gestión de Candidatos y Postulaciones
  Como Administrador del sistema
  Quiero gestionar a los candidatos
  Para evaluar sus perfiles y avanzar en el proceso de contratación

  Background:
    * field automate = apply

  @high @[1]
  Scenario: Creación de un nuevo perfil de candidato 2
    Given he iniciado sesión como "Administrador"
    When navego a la sección "Candidatos"
    And hago clic en el botón "Agregar Candidato"
    And completo el formulario con los datos personales y el CV del candidato
    And presiono "Guardar Perfil"
    Then el sistema muestra el mensaje "Candidato registrado exitosamente"
    And el candidato aparece en la lista de candidatos activos

  @medium @[2-<rol>] @unique
  Scenario Outline: Filtrar candidatos por rol <rol> 2
    Given me encuentro en la vista de "Candidatos"
    When selecciono el filtro de rol "<rol>"
    And presiono "Buscar"
    Then la tabla de resultados solo muestra candidatos con el perfil de "<rol>"

    Examples:
      | rol                 |
      | Desarrollador Java  |
      | Analista QA         |
      | Gerente de Proyecto |
