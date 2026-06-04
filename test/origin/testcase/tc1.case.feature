Feature: Funcionalidad de Login y Acceso
  Como usuario del sistema Hiring Talent 360
  Quiero iniciar sesión de forma segura
  Para poder acceder a las funciones de reclutamiento y gestión

  @high @[1]
  Scenario: Inicio de sesión exitoso como Reclutador 1
    * field automate = apply
    Given me encuentro en la página de inicio de sesión de Hiring Talent 360
    When ingreso mis credenciales válidas de rol "Reclutador"
    And presiono el botón de "Iniciar Sesión"
    Then el sistema me redirige al "Dashboard de Reclutamiento"
    And el mensaje de bienvenida "Hola, Reclutador" es visible

  @high @[2]
  Scenario: Inicio de sesión con credenciales inválidas 2
    * field automate = not apply
    Given me encuentro en la página de inicio de sesión de Hiring Talent 360
    When ingreso un correo electrónico "invalido@empresa.com"
    And ingreso una contraseña incorrecta
    And presiono el botón de "Iniciar Sesión"
    Then el sistema muestra el mensaje de error "Usuario o contraseña incorrectos"
    And permanezco en la página de inicio de sesión
