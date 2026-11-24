import { basename } from 'path';
import { matchesTestrunSelector } from '../../core/selector';
import { calculateRollupVerdict } from '../../core/utils';
import { calculatePlanRollup, getRunResourceStatus, getScenarioTrace, getScenarioEvidence } from '../../core/resources';

/**
 * Builds the local file body for a testcase using Gherkin code block syntax.
 */
export function buildLocalTestcaseBody(s: any): string {
    const steps = (s.steps || []).map((sp: any) => `${sp.keyword}${sp.text}`).join('\n');
    return '```gherkin\n' + steps + '\n```';
}

/**
 * Builds the local markdown body for a testrun linking child testcase issues.
 */
export function buildLocalTestrunBody(s: any, context?: any): string {
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
            return lowerRel.includes(ruleBaseName.toLowerCase()) || lowerAddr.includes(ruleBaseName.toLowerCase());
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

    let banner = `### ${verdictIcon} **${verdictLabel}** &nbsp;•&nbsp; **Execution Verdict**\n`;
    banner += `**Passed:** ${statusCounts.passed} &nbsp;|&nbsp; **Failed:** ${statusCounts.failed} &nbsp;|&nbsp; **Blocked:** ${statusCounts.blocked} &nbsp;|&nbsp; **Skipped:** ${statusCounts.skipped} &nbsp;|&nbsp; **Pending:** ${statusCounts.pending} &nbsp;|&nbsp; **Total:** ${uniqueResources.length}\n\n`;

    let body = banner;
    if (userDesc) {
        body += `${userDesc}\n\n`;
    }

    body += `### 📋 Test Cases\n`;

    const groupedByOrigin = new Map<string, any[]>();
    for (const tcResource of uniqueResources) {
        const originFile = tcResource.path ? basename(tcResource.path) : (tcResource.address ? basename(tcResource.address.slice(0, tcResource.address.lastIndexOf('.'))) : 'unknown');
        if (!groupedByOrigin.has(originFile)) {
            groupedByOrigin.set(originFile, []);
        }
        groupedByOrigin.get(originFile)!.push(tcResource);
    }

    for (const [origin, resources] of groupedByOrigin.entries()) {
        body += `\n**Origin:** ${origin}\n`;
        for (const tcResource of resources) {
            const tcIdentity = tcResource.address || tcResource.identity;
            const normTcId = (tcIdentity || '').replace(/\\/g, '/');
            const tcLastPart = normTcId.split('.').pop() || '';
            const safeName = tcLastPart.replace(/^@/, '') || '';
            const localStatus = resourceStatusMap.get(tcResource) || 'pending';
            const checkbox = localStatus === 'passed' ? '[x]' : '[ ]';
            const statusSuffix = ` - **${localStatus}**`;

            const idLabel = tcResource?.attributes?.issueNumber ? `#${tcResource.attributes.issueNumber}` : (tcResource?.attributes?.remoteId || tcIdentity);
            body += `- ${checkbox} ${safeName}: ${idLabel}${statusSuffix}\n`;
        }
    }

    if (notFoundTCs.length > 0) {
        body += `\n**Not Found in State**\n`;
        for (const tc of notFoundTCs) {
            const safeName = tc.split('.').pop()?.replace('@', '') || '';
            body += `- [ ] ${safeName}: (not found in state) - ${tc}\n`;
        }
    }

    return body.trim();
}

/**
 * Builds the local markdown body for a testplan linking child testrun issues.
 */
export function buildLocalTestplanBody(s: any, context?: any): string {
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

    let banner = `### ${verdictIcon} **${verdictLabel}** &nbsp;•&nbsp; **Plan Execution Verdict**\n`;
    banner += `**Total Runs:** ${resolvedRuns.length} &nbsp;|&nbsp; **Passed:** ${statusCounts.passed} &nbsp;|&nbsp; **Failed:** ${statusCounts.failed} &nbsp;|&nbsp; **Blocked:** ${statusCounts.blocked} &nbsp;|&nbsp; **Pending:** ${statusCounts.pending}\n\n`;

    let body = banner;
    if (userDesc) {
        body += `${userDesc}\n\n`;
    }

    body += `### 🚀 Test Runs\n`;
    for (const item of resolvedRuns) {
        const checkbox = item.status === 'passed' ? '[x]' : '[ ]';
        const statusSuffix = ` - **${item.status}**`;
        const idLabel = item.runResource?.attributes?.issueNumber ? `#${item.runResource.attributes.issueNumber}` : (item.runResource?.address || item.runResource?.identity || item.tr);
        body += `- ${checkbox} ${idLabel}${statusSuffix}\n`;
    }

    return body.trim();
}

/**
 * Builds the local markdown body for a bug / defect.
 */
export function buildLocalBugBody(s: any): string {
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
    return body.trim();
}
