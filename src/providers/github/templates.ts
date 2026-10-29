import { basename } from 'path';

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

        const parts = tc.split('.');
        const scenarioName = parts.pop() || '';
        const cleanScenario = scenarioName.replace(/^@/, '').toLowerCase();
        const normTc = tc.replace(/\\/g, '/');
        const ruleName = parts.join('.');
        const baseRule = ruleName.replace('.case.feature', '').replace('.feature', '').replace(/\\/g, '/');
        const ruleBaseName = basename(baseRule);

        const tcResources = state.getResources('github_testcase').filter((r: any) => {
            const normId = (r.identity || '').replace(/\\/g, '/');
            const idLastPart = normId.split('.').pop()?.replace(/^@/, '').toLowerCase();

            // Must match rule / file path
            const matchesRule = normId.includes(baseRule) || normId.includes(ruleBaseName);
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
                const gsRule = gs.rule ? gs.rule.name.replace('.case.feature', '').replace('.feature', '').replace(/\\/g, '/') : '';
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
                    const gsRule = gs.rule ? gs.rule.name.replace('.case.feature', '').replace('.feature', '').replace(/\\/g, '/') : '';
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
            const trBase = normTr.endsWith('.run.feature') ? normTr : normTr + '.run.feature';
            const trFileName = basename(trBase);

            const runResources = state.getResources('github_testrun').filter((r: any) => {
                const normId = (r.identity || '').replace(/\\/g, '/');
                const lastDot = normId.lastIndexOf('.');
                const base = lastDot !== -1 ? normId.slice(0, lastDot) : normId;

                return base.endsWith(normTr) ||
                       normId.endsWith(normTr) ||
                       base.endsWith(trFileName) ||
                       normId.endsWith(trFileName) ||
                       base === normTr;
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
