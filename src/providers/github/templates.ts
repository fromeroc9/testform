import { basename } from 'path';
import { matchesTestrunSelector } from '../../core/selector';
import { calculateRollupVerdict } from '../../core/utils';
import { calculatePlanRollup } from '../../core/resources';

export interface GitHubCommentResult {
    identity: string;
    status: string;
    body: string;
    title: string;
}

/**
 * GitHub-specific template generator for testrun comments with HTML tables.
 * This resolves GitHub's limitation where sub-issues cannot have multiple parents.
 */
export function generateGitHubTestrunComment(
    originFile: string,
    safeScenario: string,
    tcTitle: string,
    localStatus: string
): string {
    return `**Origin:** ${originFile}\n<table border="1" width="100%">
                <tr>
                    <th colspan="3">Feature Name</th>
                </tr>
                <tr>
                    <td>${safeScenario}</td>
                    <td>${tcTitle}</td>
                    <td>${localStatus}</td>
                </tr>
                <tr>
                    <td colspan="3"><br/></td>
                </tr>
                </table>`;
}

/**
 * Evaluates comments for GitHub testrun issues linking child testcases.
 */
export function evaluateGitHubTestrunComments(s: any, context?: any): GitHubCommentResult[] {
    const testcases = s.custom?.testcases || [];
    if (testcases.length === 0 || !context?.state) return [];

    const state = context.state;
    const result: GitHubCommentResult[] = [];
    const seenIdentities = new Set<string>();

    const sortedTestcases = [...testcases].sort((a: string, b: string) => {
        const aName = a.split('.').pop()?.replace('@', '') || '';
        const bName = b.split('.').pop()?.replace('@', '') || '';
        return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
    });

    for (const tc of sortedTestcases) {
        const tagMatch = tc.match(/@?(tc-[a-zA-Z0-9_-]+)/i);
        const tag = tagMatch ? tagMatch[1].toLowerCase() : null;

        const normTc = tc.replace(/\\/g, '/');
        let ruleName = '';
        let scenarioName = '';
        const featIdx = normTc.indexOf('.feature.');
        if (featIdx !== -1) {
            ruleName = normTc.slice(0, featIdx + 8);
            scenarioName = normTc.slice(featIdx + 9);
        } else {
            const parts = normTc.split('.');
            scenarioName = parts.pop() || '';
            ruleName = parts.join('.');
        }

        const cleanScenario = scenarioName.replace(/^@/, '').toLowerCase();
        const baseRule = ruleName.replace(/\.[a-zA-Z0-9_-]+\.feature$/i, '').replace(/\.feature$/i, '').replace(/\\/g, '/');
        const ruleBaseName = basename(baseRule);

        const tcResources = state.getResources('testcase').filter((r: any) => {
            const normAddr = (r.address || r.identity || '').replace(/\\/g, '/');
            const relPath = (r.path || '').replace(/\\/g, '/');
            const idLastPart = (r.tag || normAddr.split('.').pop() || '').replace(/^@/, '').toLowerCase();

            // Must match rule / file path (or scope directory)
            const matchesRule = !baseRule || relPath.includes(baseRule) || normAddr.includes(baseRule) || relPath.includes(ruleBaseName) || normAddr.includes(ruleBaseName);
            if (!matchesRule) return false;

            // Match by scenario name, tag or wildcard
            if (cleanScenario === '*' || idLastPart === cleanScenario || (tag && idLastPart === tag)) {
                return true;
            }

            // Match by title
            const normTitle = (r.attributes?.title || '').toLowerCase();
            if (normTitle && (normTitle === cleanScenario || normTitle === scenarioName.toLowerCase())) {
                return true;
            }

            return false;
        });

        const distinctFiles = new Set(tcResources.map((r: any) => {
            return r.path || (r.address || r.identity || '').replace(/\\/g, '/');
        }));
        let validResources = tcResources;

        if (distinctFiles.size > 1) {
            if (context?.testDirectory) {
                const normalizedTestDir = context.testDirectory.replace(/^\.\//, '').replace(/\\/g, '/');
                validResources = tcResources.filter((r: any) => (r.path || r.address || r.identity || '').replace(/\\/g, '/').startsWith(normalizedTestDir));
            } else {
                continue;
            }
        }

        validResources.sort((a: any, b: any) => {
            const aName = (a.tag || a.address || a.identity).split('.').pop()?.replace('@', '') || '';
            const bName = (b.tag || b.address || b.identity).split('.').pop()?.replace('@', '') || '';
            return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        });

        for (const tcResource of validResources) {
            const tcIdentity = tcResource.address || tcResource.identity;
            const normTc = tcIdentity.replace(/\\/g, '/');
            const lastTc = normTc.split('.').pop()?.replace(/^@/, '').toLowerCase() || '';

            let groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                if (!gs.name) return false;
                const cleanGsName = gs.name.replace(/^@/, '').toLowerCase();
                const gsRule = gs.rule ? gs.rule.name.replace(/\.[a-zA-Z0-9_-]+\.feature$/i, '').replace(/\.feature$/i, '').replace(/\\/g, '/') : '';
                const matchesRule = !gsRule || normTc.includes(gsRule) || normTc.includes(basename(gsRule));
                if (!matchesRule) return false;

                if (cleanGsName === '*' || cleanGsName === lastTc) {
                    return true;
                }
                const tcTitle = (tcResource.attributes?.title || '').toLowerCase();
                if (tcTitle && cleanGsName === tcTitle) {
                    return true;
                }
                return false;
            });

            if (!groupScenario) {
                groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                    if (!gs.name) return false;
                    const cleanGsName = gs.name.replace(/^@/, '').toLowerCase();
                    const gsRule = gs.rule ? gs.rule.name.replace(/\.[a-zA-Z0-9_-]+\.feature$/i, '').replace(/\.feature$/i, '').replace(/\\/g, '/') : '';
                    const matchesRule = !gsRule || normTc.includes(gsRule) || normTc.includes(basename(gsRule));
                    return matchesRule && cleanGsName === '*';
                });
            }

            const localStatus = groupScenario?.custom?.set?.status ||
                groupScenario?.custom?.fields?.status ||
                context?.existingAttributes?.testcaseStatuses?.[tcIdentity] ||
                context?.existingAttributes?.testcaseStatuses?.[normTc] ||
                'pending';
            const tcTitle = tcResource.attributes?.title || tcIdentity;

            const lastDot = tcIdentity.lastIndexOf('.');
            const safeBaseRule = lastDot !== -1 ? tcIdentity.slice(0, lastDot) : tcIdentity;
            const safeScenarioName = lastDot !== -1 ? tcIdentity.slice(lastDot + 1) : '';
            const originFile = basename(safeBaseRule || '');
            const safeScenario = safeScenarioName ? safeScenarioName.replace('@', '') : '';

            const commentBody = generateGitHubTestrunComment(originFile, safeScenario, tcTitle, localStatus);

            if (!seenIdentities.has(tcIdentity)) {
                seenIdentities.add(tcIdentity);
                result.push({ identity: tcIdentity, status: localStatus, body: commentBody, title: tcTitle });
            }
        }
    }
    return result;
}

/**
 * Builds the GitHub issue body for a testplan linking referenced testrun issues.
 */
export function buildGitHubTestplanBody(s: any, context?: any): string {
    const testruns = s.custom?.testruns || [];
    let userDesc = s.feature?.description ? s.feature.description.trim() : '';

    if (testruns.length === 0 || !context?.state) {
        return userDesc || '### 📋 Test Plan Execution\n\nNo test runs linked to this plan.';
    }

    const state = context.state;
    let runResources = state.getResources('testrun');
    if (!runResources || runResources.length === 0) {
        runResources = state.getResources('github_testrun');
    }

    const resolvedRuns: { runResource?: any; tr: string; status: string }[] = [];
    const allStatuses: string[] = [];
    const statusCounts: Record<string, number> = {
        passed: 0,
        failed: 0,
        ambiguous: 0,
        blocked: 0,
        skipped: 0,
        pending: 0,
    };

    for (const tr of testruns) {
        const normTr = tr.replace(/\\/g, '/');
        const matches = (runResources || []).filter((r: any) => matchesTestrunSelector(r, normTr));

        let valid = matches;
        const distinctFiles = new Set(matches.map((r: any) => r.path || (r.address || r.identity || '').replace(/\\/g, '/')));
        if (distinctFiles.size > 1 && context?.testDirectory) {
            const normalizedTestDir = context.testDirectory.replace(/^\.\//, '').replace(/\\/g, '/');
            const dirFiltered = matches.filter((r: any) => (r.path || r.address || r.identity || '').replace(/\\/g, '/').startsWith(normalizedTestDir));
            if (dirFiltered.length > 0) valid = dirFiltered;
        }

        if (valid.length > 0) {
            for (const runResource of valid) {
                const runStatus = (runResource.attributes?.status || runResource.attributes?.status_run || 'pending').toLowerCase();
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

    let banner = `### ${verdictIcon} **${verdictLabel}** &nbsp;•&nbsp; **Plan Execution Verdict**\n>\n`;
    banner += `| 🟢 Passed | 🔴 Failed | ⚠️ Ambiguous | 🚫 Blocked | 🟡 Skipped | ⏳ Pending | 📊 Total |\n`;
    banner += `| :-: | :-: | :-: | :-: | :-: | :-: | :-: |\n`;
    banner += `| **${statusCounts.passed}** | **${statusCounts.failed}** | **${statusCounts.ambiguous || 0}** | **${statusCounts.blocked}** | **${statusCounts.skipped || 0}** | **${statusCounts.pending}** | **${resolvedRuns.length}** |\n\n`;

    let body = banner;
    if (userDesc) {
        body += `${userDesc}\n\n`;
    }

    body += `### 🚀 Test Runs Execution\n\n`;
    body += `| Status | Test Run | Target / Origin |\n`;
    body += `| :---: | :--- | :--- |\n`;
    for (const item of resolvedRuns) {
        const statusBadge = formatPlanStatusBadge(item.status);
        if (item.runResource?.attributes?.issueNumber) {
            const title = (item.runResource.attributes.title || '').replace(/\|/g, '\\|').trim();
            body += `| ${statusBadge} | #${item.runResource.attributes.issueNumber}${title ? ` ${title}` : ''} | \`${item.runResource.path || item.tr}\` |\n`;
        } else if (item.runResource) {
            const title = (item.runResource.attributes?.title || item.runResource.address || '').replace(/\|/g, '\\|').trim();
            body += `| ${statusBadge} | (known after apply) ${title} | \`${item.runResource.path || item.tr}\` |\n`;
        } else {
            body += `| ❓ Missing | *(not found in state)* | \`${item.tr}\` |\n`;
        }
    }

    return body.trim();
}

/**
 * Builds the GitHub issue body for a testrun linking child testcase issues.
 */
export function buildGitHubTestrunBody(s: any, context?: any): string {
    const testcases = s.custom?.testcases || [];
    let userDesc = s.feature?.description ? s.feature.description.trim() : '';

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

        // Match testcase resources with strict specificity:
        // If baseRule has a directory path or namespace (e.g. Magento/cart or magento.cart),
        // it must only match resources belonging to that path/namespace, NOT unrelated files with the same basename.
        const normBaseSlash = baseRule.replace(/\./g, '/').toLowerCase();
        const normBaseDot = baseRule.replace(/\//g, '.').toLowerCase();
        const lowerBaseRule = baseRule.toLowerCase();
        const lowerRuleBase = ruleBaseName.toLowerCase();
        const isQualified = baseRule.includes('/') || (baseRule.includes('.') && !baseRule.endsWith('.feature'));

        const tcResources = state.getResources('testcase').filter((r: any) => {
            const normAddr = (r.address || r.identity || '').replace(/\\/g, '/');
            const relPath = (r.path || '').replace(/\\/g, '/');
            const idLastPart = (r.tag || normAddr.split('.').pop() || '').replace(/^@/, '').toLowerCase();

            // 1. Scenario matching: wildcard, exact tag, or matching title
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

            // 2. Rule matching:
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

            // Unqualified fallback (only when rule had no directory or namespace qualifier)
            return lowerRel.includes(lowerRuleBase) || lowerAddr.includes(lowerRuleBase);
        });

        const distinctFiles = new Set(tcResources.map((r: any) => {
            return r.path || (r.address || r.identity || '').replace(/\\/g, '/');
        }));
        let validResources = tcResources;

        if (distinctFiles.size > 1) {
            if (context?.testDirectory) {
                const normalizedTestDir = context.testDirectory.replace(/^\.\//, '').replace(/\\/g, '/');
                validResources = tcResources.filter((r: any) => (r.path || r.address || r.identity || '').replace(/\\/g, '/').startsWith(normalizedTestDir));
                const distinctValid = new Set(validResources.map((r: any) => {
                    return r.path || (r.address || r.identity || '').replace(/\\/g, '/');
                }));
                if (distinctValid.size > 1) {
                    throw new Error(`Multiple testcases found for rule "${ruleName}". Please specify a more exact path or use -test-directory to limit the scope.`);
                }
            } else {
                throw new Error(`Multiple testcases found for rule "${ruleName}". Please specify a more exact path or use -test-directory to limit the scope.`);
            }
        }

        if (validResources.length > 0) {
            allValidResources.push(...validResources);
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

    uniqueResources.sort((a: any, b: any) => {
        const aName = (a.tag || a.address || a.identity).split('.').pop()?.replace('@', '') || '';
        const bName = (b.tag || b.address || b.identity).split('.').pop()?.replace('@', '') || '';
        return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Compute status counts and map
    const statusCounts: Record<string, number> = {
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
        pending: 0,
        ambiguous: 0,
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

        const localStatus = (groupScenario?.custom?.set?.status || groupScenario?.custom?.fields?.status || existingStatuses[tcIdentity] || existingStatuses[normTcId] || 'pending').toLowerCase();
        resourceStatusMap.set(tcResource, localStatus);
        if (groupScenario) {
            resourceScenarioMap.set(tcResource, groupScenario);
        }
        allStatuses.push(localStatus);
        if (statusCounts[localStatus] !== undefined) {
            statusCounts[localStatus]++;
        } else {
            statusCounts['pending']++;
        }
    }

    const rollupVerdict = calculateRollupVerdict(allStatuses);
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

    let banner = `### ${verdictIcon} **${verdictLabel}** &nbsp;•&nbsp; **Execution Verdict**\n>\n`;
    banner += `| 🟢 Passed | 🔴 Failed | ⚠️ Ambiguous | 🚫 Blocked | 🟡 Skipped | ⏳ Pending | 📊 Total |\n`;
    banner += `| :-: | :-: | :-: | :-: | :-: | :-: | :-: |\n`;
    banner += `| **${statusCounts.passed}** | **${statusCounts.failed}** | **${statusCounts.ambiguous}** | **${statusCounts.blocked}** | **${statusCounts.skipped}** | **${statusCounts.pending}** | **${uniqueResources.length}** |\n\n`;

    let body = banner;
    if (userDesc) {
        body += `${userDesc}\n\n`;
    }

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

    if (tracesList.length > 0) {
        body += `\n### 🚨 Execution Traces & Evidence\n\n`;
        for (const t of tracesList) {
            body += `<details open>\n`;
            body += `<summary><b>${t.id}</b> (<code>${t.origin}</code>) &nbsp;•&nbsp; ${formatStatusBadge(t.status)}</summary>\n\n`;
            if (t.trace) {
                body += `\`\`\`text\n${t.trace}\n\`\`\`\n`;
            }
            if (t.evidence && t.evidence.length > 0) {
                body += `\n` + t.evidence.map(ev => `- 📎 **Evidence:** \`${ev}\``).join('\n') + `\n`;
            }
            body += `</details>\n\n`;
        }
    }

    return body.trim();
}

/**
 * Builds the GitHub issue body for a bug / defect.
 */
export function buildGitHubBugBody(s: any): string {
    let body = '';
    const gherkinSteps = s.steps?.map((sp: any) => `${sp.keyword}${sp.text}`).join('\n');
    if (gherkinSteps) {
        body += '```gherkin\n' + gherkinSteps + '\n```\n\n';
    }
    const target = s.custom?.fields?.target || s.custom?.fields?.testcase || '';
    const testrun = s.feature?.name || s.custom?.fields?.testrun || '';
    if (target || testrun) {
        body += '### 🔗 Context\n';
        if (target) body += `- **Testcase:** \`${target}\`\n`;
        if (testrun) body += `- **Testrun:** \`${testrun}\`\n`;
        body += '\n';
    }
    const trace = s.custom?.fields?.trace || s.custom?.fields?.error || '';
    if (trace) {
        body += '### 🚨 Trace\n```text\n' + trace + '\n```\n\n';
    }
    const rawEvidence = s.custom?.fields?.evidence ?? s.custom?.fields?.attach;
    const evidenceList = Array.isArray(rawEvidence) ? rawEvidence : (rawEvidence ? [rawEvidence] : []);
    if (evidenceList.length > 0) {
        body += '### 📸 Evidence / Attachments\n';
        for (const ev of evidenceList) {
            body += `- ![Evidence](${ev})\n`;
        }
        body += '\n';
    }
    return body.trim();
}

/**
 * Builds the GitHub issue body for a testcase using Markdown Gherkin block syntax.
 */
export function buildGitHubTestcaseBody(s: any): string {
    const steps = (s.steps || []).map((sp: any) => `${sp.keyword}${sp.text}`).join('\n');
    return '```gherkin\n' + steps + '\n```';
}
