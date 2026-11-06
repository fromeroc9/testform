import { basename } from 'path';
import { matchesTestrunSelector } from '../../core/selector';

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
            const normId = (r.identity || '').replace(/\\/g, '/');
            const idLastPart = normId.split('.').pop()?.replace(/^@/, '').toLowerCase();

            // Must match rule / file path (or scope directory)
            const matchesRule = !baseRule || normId.includes(baseRule) || normId.includes(ruleBaseName);
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
            const normId = (r.identity || '').replace(/\\/g, '/');
            const lastDot = normId.lastIndexOf('.');
            return lastDot !== -1 ? normId.slice(0, lastDot) : normId;
        }));
        let validResources = tcResources;

        if (distinctFiles.size > 1) {
            if (context?.testDirectory) {
                const normalizedTestDir = context.testDirectory.replace(/^\.\//, '').replace(/\\/g, '/');
                validResources = tcResources.filter((r: any) => (r.identity || '').replace(/\\/g, '/').startsWith(normalizedTestDir));
            } else {
                continue;
            }
        }

        validResources.sort((a: any, b: any) => {
            const aName = a.identity.split('.').pop()?.replace('@', '') || '';
            const bName = b.identity.split('.').pop()?.replace('@', '') || '';
            return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        });

        for (const tcResource of validResources) {
            const tcIdentity = tcResource.identity;
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

            const localStatus = groupScenario?.custom?.fields?.status ||
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
    let body = s.feature?.description || '';
    const testruns = s.custom?.testruns || [];
    if (testruns.length > 0 && context?.state) {
        body += '\n\n### Test Runs\n';
        const state = context.state;
        for (const tr of testruns) {
            const normTr = tr.replace(/\\/g, '/');
            const trExt = context?.config?.getScopeExtension?.('testrun') || '.run.feature';
            const trBase = normTr.endsWith('.feature') ? normTr : (normTr.endsWith(trExt) ? normTr : normTr + trExt);
            const trFileName = basename(trBase);

            const runResources = state.getResources('testrun').filter((r: any) => {
                return matchesTestrunSelector(r, normTr);
            });

            const distinctFiles = new Set(runResources.map((r: any) => {
                const normId = (r.identity || '').replace(/\\/g, '/');
                const lastDot = normId.lastIndexOf('.');
                return lastDot !== -1 ? normId.slice(0, lastDot) : normId;
            }));
            let validResources = runResources;

            if (distinctFiles.size > 1) {
                if (context?.testDirectory) {
                    const normalizedTestDir = context.testDirectory.replace(/^\.\//, '').replace(/\\/g, '/');
                    validResources = runResources.filter((r: any) => (r.identity || '').replace(/\\/g, '/').startsWith(normalizedTestDir));
                    const distinctValid = new Set(validResources.map((r: any) => {
                        const normId = (r.identity || '').replace(/\\/g, '/');
                        const lastDot = normId.lastIndexOf('.');
                        return lastDot !== -1 ? normId.slice(0, lastDot) : normId;
                    }));
                    if (distinctValid.size > 1) {
                        throw new Error(`Multiple testruns found for rule "${tr}". Please specify a more exact path or use -test-directory to limit the scope.`);
                    }
                } else {
                    throw new Error(`Multiple testruns found for rule "${tr}". Please specify a more exact path or use -test-directory to limit the scope.`);
                }
            }

            if (validResources.length > 0) {
                for (const runResource of validResources) {
                    if (runResource?.attributes?.issueNumber) {
                        body += `- [ ] #${runResource.attributes.issueNumber}\n`;
                    } else {
                        body += `- [ ] (known after apply) - ${runResource.identity}\n`;
                    }
                }
            } else {
                body += `- [ ] (not found in state) - ${tr}\n`;
            }
        }
    }
    return body.trim();
}

/**
 * Builds the GitHub issue body for a testrun linking child testcase issues.
 */
export function buildGitHubTestrunBody(s: any, context?: any): string {
    let body = s.feature?.description || '### 🚀 Test Run Execution\n\nThis issue serves as the central hub for tracking the execution of this Test Run. All associated test cases are linked below as tasks.\n\n**Instructions:**\n- Execution results for each test case will be recorded dynamically as comments on this issue.\n- Click on individual test case links to view their details or attach evidence.';

    const testcases = s.custom?.testcases || [];
    if (testcases.length > 0 && context?.state) {
        const state = context.state;

        const runIdentity = s.custom?.identity && s.custom.identity !== s.uri ? `${s.uri}.${s.custom.identity}` : s.uri;
        const existingRun = state.getResources('testrun').find((r: any) => r.identity === runIdentity);
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
                const normId = (r.identity || '').replace(/\\/g, '/');
                const idLastPart = normId.split('.').pop()?.replace(/^@/, '').toLowerCase();

                // Rule path matching: either relative path matches or basename matches
                const matchesRule = normId.includes(baseRule) || normId.includes(ruleBaseName);
                if (!matchesRule) return false;

                // Scenario matching: wildcard, exact tag, or matching title
                if (cleanScenario === '*' || idLastPart === cleanScenario) return true;

                const normTitle = (r.attributes?.title || '').toLowerCase();
                if (normTitle && (normTitle === cleanScenario || normTitle === scenarioName.toLowerCase())) return true;

                return false;
            });

            const distinctFiles = new Set(tcResources.map((r: any) => {
                const normId = (r.identity || '').replace(/\\/g, '/');
                const lastDot = normId.lastIndexOf('.');
                return lastDot !== -1 ? normId.slice(0, lastDot) : normId;
            }));
            let validResources = tcResources;

            if (distinctFiles.size > 1) {
                if (context?.testDirectory) {
                    const normalizedTestDir = context.testDirectory.replace(/^\.\//, '').replace(/\\/g, '/');
                    validResources = tcResources.filter((r: any) => (r.identity || '').replace(/\\/g, '/').startsWith(normalizedTestDir));
                    const distinctValid = new Set(validResources.map((r: any) => {
                        const normId = (r.identity || '').replace(/\\/g, '/');
                        const lastDot = normId.lastIndexOf('.');
                        return lastDot !== -1 ? normId.slice(0, lastDot) : normId;
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
            if (!uniqueResourcesMap.has(r.identity)) {
                uniqueResourcesMap.set(r.identity, r);
            }
        }
        const uniqueResources = Array.from(uniqueResourcesMap.values());

        uniqueResources.sort((a: any, b: any) => {
            const aName = a.identity.split('.').pop()?.replace('@', '') || '';
            const bName = b.identity.split('.').pop()?.replace('@', '') || '';
            return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        });

        const groupedByOrigin = new Map<string, any[]>();
        for (const tcResource of uniqueResources) {
            const normId = (tcResource.identity || '').replace(/\\/g, '/');
            const lastDot = normId.lastIndexOf('.');
            const baseRule = lastDot !== -1 ? normId.slice(0, lastDot) : normId;
            const originFile = basename(baseRule || '');
            if (!groupedByOrigin.has(originFile)) {
                groupedByOrigin.set(originFile, []);
            }
            groupedByOrigin.get(originFile)!.push(tcResource);
        }

        for (const [origin, resources] of groupedByOrigin.entries()) {
            body += `\n\n**Origin:** ${origin}\n`;
            for (const tcResource of resources) {
                const tcIdentity = tcResource.identity;
                const normTcId = (tcIdentity || '').replace(/\\/g, '/');
                const tcLastPart = normTcId.split('.').pop() || '';
                const cleanIdTag = tcLastPart.replace(/^@/, '').toLowerCase();
                const safeName = tcLastPart.replace(/^@/, '') || '';

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

                const localStatus = groupScenario?.custom?.fields?.status || existingStatuses[tcIdentity] || existingStatuses[normTcId] || 'pending';
                const checkbox = localStatus === 'passed' ? '[x]' : '[ ]';

                if (tcResource?.attributes?.issueNumber) {
                    body += `- ${checkbox} ${safeName}: #${tcResource.attributes.issueNumber}\n`;
                } else {
                    body += `- ${checkbox} ${safeName}: (known after apply) - ${tcIdentity}\n`;
                }
            }
        }

        if (notFoundTCs.length > 0) {
            body += `\n\n**Not Found in State**\n`;
            for (const tc of notFoundTCs) {
                const safeName = tc.split('.').pop()?.replace('@', '') || '';
                body += `- [ ] ${safeName}: (not found in state) - ${tc}\n`;
            }
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
    const rawEvidence = s.custom?.fields?.evidence;
    const evidenceList = Array.isArray(rawEvidence) ? rawEvidence : (rawEvidence ? [rawEvidence] : []);
    if (evidenceList.length > 0) {
        body += '### 📸 Evidence\n';
        for (const ev of evidenceList) {
            body += `- ![Evidence](${ev})\n`;
        }
        body += '\n';
    }
    return body.trim();
}
