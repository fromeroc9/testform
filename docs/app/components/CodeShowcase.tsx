'use client';

import React, { useState } from 'react';

const TABS = [
  {
    id: 'feature',
    label: 'auth.case.feature',
    lang: 'gherkin',
    type: 'spec',
    content: `Feature: Control de Acceso y Autenticación
  Como usuario registrado de la aplicación
  Quiero autenticarme con credenciales válidas
  Para acceder al panel de control protegido

  Background:
    * field automate = apply

  @tc-auth-001 @high
  Scenario: Inicio de sesión exitoso en el portal
    Given el usuario navega a la URL "/login"
    When introduce el correo "admin@empresa.com"
    And introduce la contraseña "\${vars.admin_pass}"
    And pulsa el botón "Iniciar Sesión"
    Then el sistema debe redirigir a "/dashboard"
    And el banner muestra "Bienvenido, Administrador"`
  },
  {
    id: 'config',
    label: 'testform.yml',
    lang: 'yaml',
    type: 'config',
    content: `backend:
  local:
    path: "./testform.state"

providers:
  github:
    owner: "empresa"
    repo: "portal-web"

vars:
  admin_pass: "Secret123!"

outputs:
  total_scenarios: "\${testcase.*.count}"`
  },
  {
    id: 'plan',
    label: 'testform plan',
    lang: 'bash',
    type: 'cli',
    content: `Testform v1.0.17
Backend: local (testform.state)
Adquiriendo bloqueo de estado... [OK]

Calculando grafo DAG y plan de conciliación:

  + resource "testcase" "features/auth.case.feature::@tc-auth-001" {
      + title       = "Inicio de sesión exitoso en el portal"
      + feature     = "Control de Acceso y Autenticación"
      + priority    = "high"
      + automate    = "apply"
      + steps_count = 6
      + status      = "draft"
    }

Plan: 1 para agregar, 0 para cambiar, 0 para destruir.
Estado: sin drift detectado. Bloqueo liberado.`
  },
  {
    id: 'run',
    label: 'testform suite (Runners)',
    lang: 'bash',
    type: 'cli',
    content: `Ejecutando matriz de pruebas orquestadas...

  ✔ [E2E] Playwright: Login en React TodoMVC (1.42s)
  ✔ [API] Supertest: POST /auth/tokens [200 OK] (184ms)
  ✔ [PERF] K6: 100 reqs concurrentes - p95: 142ms < SLA (200ms)

Matriz: 3 suites ejecutadas, 3 aprobadas (100% verde)
Evidencias registradas en testform.state.`
  }
];

export function CodeShowcase() {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(TABS[activeTab].content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="showcase-window">
      {/* Top Window Bar */}
      <div className="showcase-header">
        <div className="showcase-dots">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>

        {/* Navigation Tabs */}
        <div className="showcase-tabs">
          {TABS.map((tab, idx) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(idx)}
              className={`showcase-tab ${activeTab === idx ? 'showcase-tab-active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Copy Button */}
        <button onClick={handleCopy} className="showcase-copy-btn" title="Copiar código">
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>

      {/* Code / Terminal Viewport */}
      <div className="showcase-body">
        <pre className="showcase-pre">
          <code>{TABS[activeTab].content}</code>
        </pre>
      </div>
    </div>
  );
}
