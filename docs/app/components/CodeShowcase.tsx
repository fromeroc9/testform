'use client';

import React, { useState } from 'react';

export interface CodeTab {
  id: string;
  label: string;
  lang: string;
  type: string;
  content: string;
}

const DEFAULT_TABS: CodeTab[] = [
  {
    id: 'feature',
    label: 'specs/auth.case.feature',
    lang: 'gherkin',
    type: 'spec',
    content: `@testcase
Feature: User Authentication & SSO
  As a registered platform user
  I want to securely authenticate into my account
  So that I can access the engineering dashboard

  @tc-auth-01 @smoke @critical
  Scenario: Valid enterprise OAuth login
    Given the user navigates to "\${local.login_url}"
    When the user submits credentials for "\${var.test_user}"
    Then the system redirects to "\${var.app_url}/dashboard"
    And the user role is verified as "Admin"`
  },
  {
    id: 'config',
    label: 'main.yml',
    lang: 'yaml',
    type: 'config',
    content: `testform:
  required_version: ">= 1.0.0"
  backend:
    local:
      path: "./testform.state"

provider:
  github:
    owner: "enterprise-org"
    repository: "core-platform"
    token_env: "GITHUB_TOKEN"

vars:
  app_url:
    type: string
    default: "https://app.enterprise.io"
  test_user:
    type: string
    default: "qa-automation@enterprise.io"

locals:
  login_url: "\${var.app_url}/auth/login"

scopes:
  testcase:
    directory: "specs/cases"
  testrun:
    directory: "specs/runs"`
  },
  {
    id: 'plan',
    label: 'testform plan',
    lang: 'bash',
    type: 'cli',
    content: `$ testform plan

Initializing the backend...
Successfully configured the backend "local"!

Testform will perform the following actions:

  # github_testcase.specs/cases/auth.case.feature.@tc-auth-01 will be created
  + resource "github_testcase" "specs/cases/auth.case.feature.@tc-auth-01" {
      + title       = "Valid enterprise OAuth login"
      + feature     = "User Authentication & SSO"
      + priority    = "critical"
      + labels      = ["smoke", "critical", "testcase"]
      + state_hash  = "a7f891b2c4e5d6..."
      + status      = "open"
    }

Plan: 1 to add, 0 to change, 0 to destroy.

─────────────────────────────────────────────────────────────────────────────
Note: You didn't use the -out option to save this plan, so Testform can't
guarantee that exactly these actions will be performed if you run "apply".`
  },
  {
    id: 'apply',
    label: 'testform apply',
    lang: 'bash',
    type: 'cli',
    content: `$ testform apply -auto-approve

Acquiring state lock... [OK]
github_testcase.specs/cases/auth.case.feature.@tc-auth-01: Creating...
github_testcase.specs/cases/auth.case.feature.@tc-auth-01: Creation complete after 1.2s [id=gh:1042]

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.

State lock released. State written to testform.state (SHA-256 verified).`
  },
  {
    id: 'drift',
    label: 'testform diff --remote',
    lang: 'bash',
    type: 'cli',
    content: `$ testform diff --remote -i

Refreshing state against GitHub Projects API...
Drift detected in: specs/cases/auth.case.feature.@tc-auth-01

  ~ title: "Valid enterprise OAuth login" -> "Updated OAuth via Web UI"
  ~ priority: "critical" -> "medium"

? Remote drift resolution strategy for @tc-auth-01:
  > 1. PULL      - Overwrite local .feature with remote changes
    2. OVERWRITE - Enforce Git authority (re-apply local truth to cloud)
    3. SKIP      - Ignore this discrepancy for now

✔ Decision: Enforcing Git authority on next apply. Zero drift maintained.`
  }
];

export function CodeShowcase({ tabs = DEFAULT_TABS }: { tabs?: CodeTab[] }) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(tabs[activeTab].content);
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
          {tabs.map((tab, idx) => (
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
        <button onClick={handleCopy} className="showcase-copy-btn" title="Copiar al portapapeles">
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>

      {/* Code / Terminal Viewport */}
      <div className="showcase-body">
        <pre className="showcase-pre">
          <code>{tabs[activeTab].content}</code>
        </pre>
      </div>
    </div>
  );
}
