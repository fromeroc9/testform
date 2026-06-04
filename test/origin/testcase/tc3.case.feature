Feature: Configuración y Maestros del Sistema
  Como Administrador de la plataforma HT360
  Quiero configurar los parámetros maestros (Puestos, Áreas, etc.)
  Para que estén disponibles en el resto de los módulos

  Background:
    * field automate = not apply

  @[1] @low
  Scenario: Verificación de información legal en el footer 2
    Given Ingreso al portal de agentes de Hiring Talent 360
    When me desplazo hacia la parte inferior de la página
    Then verifico que aparece el texto "© 2024 Caja Arequipa - RUC 20100209641"
    And verifico que aparece el texto "Todos los derechos reservados."
    And verifico que aparece el texto "Caja Municipal de Ahorro y Crédito de Arequipa S.A"

  @[2] @medium
  Scenario: Verificar apertura del modal Editar Puesto 2
    Given selecciono la pestaña "Puestos"
    When en el listado de puestos selecciono "Editar" en el primer registro
    Then se abre el modal "Editar Puesto"
    And los datos del puesto actual se muestran cargados en el formulario

  @[3] @high
  Scenario: Validar guardado de un nuevo puesto sin errores 2
    Given selecciono la pestaña "Puestos"
    When presiono el botón "Nuevo Puesto"
    And ingreso "Desarrollador Full Stack Senior" en el campo "Nombre del Puesto"
    And selecciono "Tecnología de la Información" en el campo "Área"
    And presiono "Guardar"
    Then el sistema muestra "Puesto creado correctamente"
    And el nuevo puesto aparece en la tabla de resultados
