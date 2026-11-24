import { basename } from 'path';
import { matchesTestrunSelector } from '../../core/selector';
import { calculateRollupVerdict } from '../../core/utils';
import { calculatePlanRollup, getRunResourceStatus, getScenarioTrace, getScenarioEvidence } from '../../core/resources';

/**
 * Renders a clean Markdown table for custom metadata fields in GitLab issue body.
 */
export function formatGitLabMetadataSection(s: any, excludeKeys: string[] = []): string {
    const rawFields = { ...(s.custom?.fields || {}), ...(s.custom?.set || {}) };
    const defaultExcludes = new Set([
        'labels', 'assignees', 'assignee', 'milestone', 'evidence', 'attach',
        'trace', 'error', 'target', 'testcase', 'testrun', 'run',
        ...excludeKeys.map(k => k.toLowerCase())
    ]);

    const entries: [string, any][] = [];
    for (const [key, val] of Object.entries(rawFields)) {
        if (defaultExcludes.has(key.toLowerCase())) continue;
        if (val === undefined || val === null || val === '') continue;
        entries.push([key, val]);
    }

    if (entries.length === 0) return '';

    let out = '\n\n### 📋 Metadata\n\n';
    out += '| Field | Value |\n';
    out += '| :--- | :--- |\n';
    for (const [key, val] of entries) {
        const displayKey = key
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        const displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
        out += `| **${displayKey}** | ${displayVal} |\n`;
    }
    return out;
}

/**
 * Builds the GitLab issue description for a testcase using Gherkin code block syntax.
 */
export function buildGitLabTestcaseBody(s: any): string {
    const steps = (s.steps || []).map((sp: any) => `${sp.keyword}${sp.text}`).join('\n');
    let body = '```gherkin\n' + steps + '\n```';
    body += formatGitLabMetadataSection(s);
    return body.trim();
}

/**
 * Builds the GitLab issue description for a testrun linking child testcase issues.
 */
export function buildGitLabTestrunBody(s: any, context?: any): string {
    const testcases = s.custom?.testcases || [];
    const userDesc = s.feature?.description ? s.feature.description.trim() : '';

    if (testcases.length === 0 || !context?.state) {
        return userDesc || '### 🚀 Test Run Execution\n\nNo test cases linked to this run.';
    }

    const state = context.state;
    const existingRun = state.getResources('testrun').find((r: any) =>
        r.address === s.uri || (r.path && r.path === s.uri) ||
        r.address?.includes(s.uri) || (r.identity && r.identity === s.uri)
    );
    const existingStatuses = existingRun?.attributes?.testcases || existingRun?.attributes?.testcaseStatuses || {};

    const sortedTestcases = [...testcases].sort((a: string, b: string) => {
        const aName = a.split('.').pop()?.replace('@', '') || '';
        const bName = b.split('.').pop()?.replace('@', '') || '';
        return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
    });

    const allValidResources: any[] = [];
    const notFoundTCs: string[] = [];

    for (const tc of sortedTestcases) {
        const parts = tc.split('.');
        const scenarioName = parts.pop() || '';
        const ruleName = parts.join('.');
        const baseRule = ruleName.replace(/\.[a-zA-Z0-9_-]+\.feature$/i, '').replace(/\.feature$/i, '').replace(/\\/g, '/');
        const ruleBaseName = basename(baseRule);
        const cleanScenario = scenarioName.replace(/^@/, '').toLowerCase();

        const normBaseSlash = baseRule.replace(/\./g, '/').toLowerCase();
        const normBaseDot = baseRule.replace(/\//g, '.').toLowerCase();
        const lowerBaseRule = baseRule.toLowerCase();
        const lowerRuleBase = ruleBaseName.toLowerCase();
        const isQualified = baseRule.includes('/') || (baseRule.includes('.') && !baseRule.endsWith('.feature'));

        const tcResources = state.getResources('testcase').filter((r: any) => {
            const normAddr = (r.address || r.identity || '').replace(/\\/g, '/');
            const relPath = (r.path || '').replace(/\\/g, '/');
            const idLastPart = (r.tag || normAddr.split('.').pop() || '').replace(/^@/, '').toLowerCase();

            let matchesScenario = false;
            if (cleanScenario === '*' || idLastPart === cleanScenario) {
                matchesScenario = true;
            } else {
                const normTitle = (r.attributes?.title || '').toLowerCase();
                if (normTitle && (normTitle === cleanScenario || normTitle === scenarioName.toLowerCase())) {
                    matchesScenario = true;
                }
            }
            if (!matchesScenario) return false;

            const lowerRel = relPath.toLowerCase();
            const lowerAddr = normAddr.toLowerCase();
            const ns = (r.namespace || '').toLowerCase();

            if (isQualified) {
                const matchesNs = ns && (normBaseSlash.startsWith(ns + '/') || normBaseDot.startsWith(ns + '.') || normBaseSlash === ns);
                const matchesQualified =
                    lowerRel.includes(normBaseSlash) ||
                    lowerAddr.includes(normBaseSlash) ||
                    lowerAddr.includes(normBaseDot) ||
                    lowerRel.includes(lowerBaseRule) ||
                    lowerAddr.includes(lowerBaseRule);

                if (matchesNs && (lowerRel.includes(lowerRuleBase) || lowerAddr.includes(lowerRuleBase))) {
                    return true;
                }
                return matchesQualified;
            }

            return lowerRel.includes(lowerRuleBase) || lowerAddr.includes(lowerRuleBase);
        });

        if (tcResources.length > 0) {
            allValidResources.push(...tcResources);
        } else {
            notFoundTCs.push(tc);
        }
    }

    const uniqueResourcesMap = new Map();
    for (const r of allValidResources) {
        const key = r.address || r.identity;
        if (!uniqueResourcesMap.has(key)) {
            uniqueResourcesMap.set(key, r);
        }
    }
    const uniqueResources = Array.from(uniqueResourcesMap.values());

    const statusCounts: Record<string, number> = {
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
        pending: 0,
    };
    const allStatuses: string[] = [];
    const resourceStatusMap = new Map<any, string>();
    const resourceScenarioMap = new Map<any, any>();

    for (const tcResource of uniqueResources) {
        const tcIdentity = tcResource.address || tcResource.identity;
        const normTcId = (tcIdentity || '').replace(/\\/g, '/');
        const tcLastPart = normTcId.split('.').pop() || '';
        const cleanIdTag = tcLastPart.replace(/^@/, '').toLowerCase();

        let groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
            if (!gs.rule || !gs.name) return false;
            const gsBaseRule = gs.rule.name.replace(/\.[a-zA-Z0-9_-]+\.feature$/i, '').replace(/\.feature$/i, '').replace(/\\/g, '/');
            const cleanGsName = gs.name.replace(/^@/, '').toLowerCase();
            const matchesRule = normTcId.includes(gsBaseRule) || normTcId.includes(basename(gsBaseRule));
            return matchesRule && (cleanIdTag === cleanGsName || cleanGsName === '*');
        });

        if (!groupScenario) {
            groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                if (!gs.rule || !gs.name) return false;
                const gsBaseRule = gs.rule.name.replace(/\.[a-zA-Z0-9_-]+\.feature$/i, '').replace(/\.feature$/i, '').replace(/\\/g, '/');
                const matchesRule = normTcId.includes(gsBaseRule) || normTcId.includes(basename(gsBaseRule));
                return matchesRule && gs.name === '*';
            });
        }

        if (groupScenario) {
            resourceScenarioMap.set(tcResource, groupScenario);
        }

        const localStatus = (groupScenario?.custom?.set?.status || groupScenario?.custom?.fields?.status || existingStatuses[tcIdentity] || existingStatuses[normTcId] || 'pending').toLowerCase();
        resourceStatusMap.set(tcResource, localStatus);
        allStatuses.push(localStatus);
        if (statusCounts[localStatus] !== undefined) {
            statusCounts[localStatus]++;
        } else {
            statusCounts['pending']++;
        }
    }

    const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === 'status');
    const explicitStatus = explicitEntry ? String(explicitEntry[1]).trim().toLowerCase() : undefined;
    const rollupVerdict = (explicitStatus && explicitStatus !== '') ? explicitStatus : calculateRollupVerdict(allStatuses);
    const ICONS: Record<string, string> = {
        passed: '🟢',
        failed: '🔴',
        blocked: '🚫',
        skipped: '🟡',
        pending: '⏳',
        undefined: '⚪',
        ambiguous: '⚠️',
    };
    const verdictIcon = ICONS[rollupVerdict.toLowerCase()] || '⚪';
    const verdictLabel = rollupVerdict.toUpperCase();

    const formatStatusBadge = (st: string) => {
        const lower = (st || 'pending').toLowerCase();
        switch (lower) {
            case 'passed': return '🟢 Passed';
            case 'failed': return '🔴 Failed';
            case 'ambiguous': return '⚠️ Ambiguous';
            case 'blocked': return '🚫 Blocked';
            case 'skipped': return '🟡 Skipped';
            case 'undefined': return '⚪ Undefined';
            default: return '⏳ Pending';
        }
    };

    // 1. Verdict Banner with summary count table (matching GitHub layout)
    let banner = `### ${verdictIcon} **${verdictLabel}** &nbsp;•&nbsp; **Execution Verdict**\n`;
    banner += `| 🟢 Passed | 🔴 Failed | ⚠️ Ambiguous | 🚫 Blocked | 🟡 Skipped | ⏳ Pending | 📊 Total |\n`;
    banner += `| :-: | :-: | :-: | :-: | :-: | :-: | :-: |\n`;
    banner += `| **${statusCounts.passed}** | **${statusCounts.failed}** | **0** | **${statusCounts.blocked}** | **${statusCounts.skipped}** | **${statusCounts.pending}** | **${uniqueResources.length}** |\n\n`;

    let body = banner;

    // 2. Metadata in 2nd position
    const metadataSection = formatGitLabMetadataSection(s);
    if (metadataSection) {
        body += metadataSection.trim() + '\n\n';
    }

    if (userDesc) {
        body += `${userDesc}\n\n`;
    }

    // 3. Test Cases Execution table (similar to GitHub in attached image)
    body += `### 📋 Test Cases Execution\n\n`;
    body += `| Status | ID | Test Case | Origin |\n`;
    body += `| :---: | :---: | :--- | :--- |\n`;

    const tracesList: { id: string; origin: string; status: string; trace?: string; evidence?: string[] }[] = [];

    for (const tcResource of uniqueResources) {
        const tcIdentity = tcResource.address || tcResource.identity;
        const normTcId = (tcIdentity || '').replace(/\\/g, '/');
        const tcLastPart = normTcId.split('.').pop() || '';
        const safeName = tcLastPart.replace(/^@/, '') || '';
        const localStatus = resourceStatusMap.get(tcResource) || 'pending';
        const statusBadge = formatStatusBadge(localStatus);
        const originFile = tcResource.path ? basename(tcResource.path) : (tcResource.address ? basename(tcResource.address.slice(0, tcResource.address.lastIndexOf('.'))) : 'unknown');
        const tcTitle = (tcResource.attributes?.title || tcResource.name || '').replace(/\|/g, '\\|').trim();
        const issueNum = tcResource.attributes?.issueNumber;

        const testCaseCell = issueNum
            ? `#${issueNum}${tcTitle ? ` ${tcTitle}` : ''}`
            : (tcTitle ? `${tcTitle}` : `(known after apply)`);

        body += `| ${statusBadge} | \`@${safeName}\` | ${testCaseCell} | \`${originFile}\` |\n`;

        const groupScenario = resourceScenarioMap.get(tcResource);
        const trace = groupScenario ? (groupScenario.custom?.set?.trace || groupScenario.custom?.fields?.trace || groupScenario.custom?.set?.error || groupScenario.custom?.fields?.error) : undefined;
        const rawEv = groupScenario ? (groupScenario.custom?.set?.attach || groupScenario.custom?.fields?.attach || groupScenario.custom?.set?.evidence || groupScenario.custom?.fields?.evidence) : undefined;
        const evidence = rawEv ? (Array.isArray(rawEv) ? rawEv : [rawEv]) : undefined;

        if (trace || (evidence && evidence.length > 0)) {
            tracesList.push({
                id: issueNum ? `#${issueNum} @${safeName}` : `@${safeName}`,
                origin: originFile,
                status: localStatus,
                trace: trace ? String(trace).trim() : undefined,
                evidence: evidence ? evidence.map(String) : undefined
            });
        }
    }

    if (notFoundTCs.length > 0) {
        for (const tc of notFoundTCs) {
            const safeName = tc.split('.').pop()?.replace('@', '') || '';
            const originPart = tc.includes('.') ? tc.split('.')[0] : 'unknown';
            body += `| ❓ Missing | \`@${safeName}\` | *(not found in state)* | \`${originPart}\` |\n`;
        }
    }

    // 4. Failure Traces & Evidence
    if (tracesList.length > 0) {
        body += '\n### 🚨 Failure Traces & Evidence\n\n';
        for (const t of tracesList) {
            body += `#### ${t.id} (\`${t.origin}\`) - **${t.status.toUpperCase()}**\n`;
            if (t.trace) {
                body += '```text\n' + t.trace + '\n```\n';
            }
            if (t.evidence && t.evidence.length > 0) {
                for (const ev of t.evidence) {
                    const isImg = /\.(png|jpe?g|gif|webp|svg)($|\?)/i.test(ev);
                    if (isImg) {
                        body += `![Evidence](${ev})\n`;
                    } else {
                        body += `📎 **Attachment:** \`${ev}\`\n`;
                    }
                }
            }
            body += '\n';
        }
    }

    return body.trim();
}

/**
 * Builds the GitLab issue description for a testplan linking child testrun issues.
 */
export function buildGitLabTestplanBody(s: any, context?: any): string {
    const testruns = s.custom?.testruns || [];
    const userDesc = s.feature?.description ? s.feature.description.trim() : '';

    if (testruns.length === 0 || !context?.state) {
        return userDesc || '### 📋 Test Plan Execution\n\nNo test runs defined in this plan.';
    }

    const state = context.state;
    const runResources = state.getResources('testrun');
    const resolvedRuns: { runResource?: any; tr: string; status: string }[] = [];
    const allStatuses: string[] = [];
    const statusCounts: Record<string, number> = {
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
        pending: 0,
    };

    for (const tr of testruns) {
        const normTr = tr.replace(/\\/g, '/');
        const matches = (runResources || []).filter((r: any) => matchesTestrunSelector(r, normTr));
        if (matches.length > 0) {
            for (const runResource of matches) {
                const runStatus = getRunResourceStatus(runResource);
                resolvedRuns.push({ runResource, tr, status: runStatus });
                allStatuses.push(runStatus);
                if (statusCounts[runStatus] !== undefined) {
                    statusCounts[runStatus]++;
                } else {
                    statusCounts['pending']++;
                }
            }
        } else {
            resolvedRuns.push({ tr, status: 'pending' });
            allStatuses.push('pending');
            statusCounts['pending']++;
        }
    }

    const planVerdict = calculatePlanRollup(s, context);
    const ICONS: Record<string, string> = {
        passed: '🟢',
        failed: '🔴',
        blocked: '🚫',
        skipped: '🟡',
        pending: '⏳',
        undefined: '⚪',
        ambiguous: '⚠️',
    };
    const verdictIcon = ICONS[planVerdict.toLowerCase()] || '⚪';
    const verdictLabel = planVerdict.toUpperCase();

    const formatPlanStatusBadge = (st: string) => {
        const lower = (st || 'pending').toLowerCase();
        switch (lower) {
            case 'passed': return '🟢 Passed';
            case 'failed': return '🔴 Failed';
            case 'ambiguous': return '⚠️ Ambiguous';
            case 'blocked': return '🚫 Blocked';
            case 'skipped': return '🟡 Skipped';
            case 'undefined': return '⚪ Undefined';
            default: return '⏳ Pending';
        }
    };

    // 1. Verdict Banner with summary count table
    let banner = `### ${verdictIcon} **${verdictLabel}** &nbsp;•&nbsp; **Plan Execution Verdict**\n`;
    banner += `| 🟢 Passed | 🔴 Failed | ⚠️ Ambiguous | 🚫 Blocked | 🟡 Skipped | ⏳ Pending | 📊 Total |\n`;
    banner += `| :-: | :-: | :-: | :-: | :-: | :-: | :-: |\n`;
    banner += `| **${statusCounts.passed}** | **${statusCounts.failed}** | **0** | **${statusCounts.blocked}** | **${statusCounts.skipped}** | **${statusCounts.pending}** | **${resolvedRuns.length}** |\n\n`;

    let body = banner;

    // 2. Metadata in 2nd position
    const metadataSection = formatGitLabMetadataSection(s);
    if (metadataSection) {
        body += metadataSection.trim() + '\n\n';
    }

    if (userDesc) {
        body += `${userDesc}\n\n`;
    }

    // 3. Test Runs Table
    body += `### 🚀 Test Runs Execution\n\n`;
    body += `| Status | Test Run | Target / Origin |\n`;
    body += `| :---: | :--- | :--- |\n`;

    for (const item of resolvedRuns) {
        const statusBadge = formatPlanStatusBadge(item.status);
        const originDisplay = `\`${item.tr}\``;
        if (item.runResource?.attributes?.issueNumber) {
            const runTitle = (item.runResource.attributes.title || '').replace(/\|/g, '\\|').trim();
            body += `| ${statusBadge} | #${item.runResource.attributes.issueNumber}${runTitle ? ` ${runTitle}` : ''} | ${originDisplay} |\n`;
        } else if (item.runResource) {
            const runAddr = item.runResource.address || item.runResource.identity;
            body += `| ${statusBadge} | *(known after apply)* - ${runAddr} | ${originDisplay} |\n`;
        } else {
            body += `| ${statusBadge} | *(not found in state)* | ${originDisplay} |\n`;
        }
    }

    return body.trim();
}

/**
 * Builds the GitLab issue description for a bug / defect.
 */
export function buildGitLabBugBody(s: any): string {
    let body = '';
    const description = s.description ? s.description.trim() : '';
    if (description) {
        body += `### 📝 Description\n${description}\n\n`;
    }

    const gherkinSteps = s.steps?.map((sp: any) => `${sp.keyword}${sp.text}`).join('\n');
    if (gherkinSteps) {
        body += `### 🐾 Steps to Reproduce\n\`\`\`gherkin\n${gherkinSteps}\n\`\`\`\n\n`;
    }

    const target = s.custom?.set?.target || s.custom?.fields?.target || s.custom?.fields?.testcase || (s.rule?.name ? s.rule.name : '');
    const testrun = s.custom?.set?.run || s.custom?.fields?.run || s.custom?.fields?.testrun || '';
    body += '### 🔗 Context\n';
    body += `- **Testcase:** \`${target || 'Not applicable'}\`\n`;
    body += `- **Testrun:** \`${testrun || 'Not applicable'}\`\n\n`;

    const trace = getScenarioTrace(s);
    if (trace) {
        body += '### 🚨 Trace\n```text\n' + trace + '\n```\n\n';
    }

    const evidenceList = getScenarioEvidence(s) || [];
    if (evidenceList.length > 0) {
        body += '### 📸 Evidence / Attachments\n';
        for (const ev of evidenceList) {
            const isImg = /\.(png|jpe?g|gif|webp|svg)($|\?)/i.test(ev);
            if (isImg) {
                body += `![Evidence](${ev})\n`;
            } else {
                body += `📎 **Attachment:** \`${ev}\`\n`;
            }
        }
        body += '\n';
    }

    body += formatGitLabMetadataSection(s);
    return body.trim();
}
