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

    const sortedTestcases = [...testcases].sort((a: string, b: string) => {
        const aName = a.split('::').pop()?.replace('@', '') || '';
        const bName = b.split('::').pop()?.replace('@', '') || '';
        return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
    });

    for (const tc of sortedTestcases) {
        const parts = tc.split('::');
        const scenarioName = parts.pop();
        const ruleName = parts.pop() || '';
        const baseRule = ruleName.replace('.case.feature', '').replace('.feature', '');

        const tcResources = state.getResources('github_testcase').filter((r: any) =>
            r.identity.includes(baseRule) && (scenarioName === '*' || r.identity.endsWith(`::${scenarioName}`))
        );

        const distinctFiles = new Set(tcResources.map((r: any) => r.identity.split('::')[0]));
        let validResources = tcResources;

        if (distinctFiles.size > 1) {
            if (context?.testDirectory) {
                const normalizedTestDir = context.testDirectory.replace(/^\.\//, '');
                validResources = tcResources.filter((r: any) => r.identity.startsWith(normalizedTestDir));
            } else {
                continue;
            }
        }

        validResources.sort((a: any, b: any) => {
            const aName = a.identity.split('::').pop()?.replace('@', '') || '';
            const bName = b.identity.split('::').pop()?.replace('@', '') || '';
            return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        });

        for (const tcResource of validResources) {
            const tcIdentity = tcResource.identity;

            let groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                if (!gs.rule || !gs.name) return false;
                const gsBaseRule = gs.rule.name.replace('.case.feature', '').replace('.feature', '');
                return tcIdentity.includes(gsBaseRule) && tcIdentity.endsWith(`::${gs.name}`);
            });

            if (!groupScenario) {
                groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                    if (!gs.rule || !gs.name) return false;
                    const gsBaseRule = gs.rule.name.replace('.case.feature', '').replace('.feature', '');
                    return tcIdentity.includes(gsBaseRule) && gs.name === '*';
                });
            }

            const localStatus = groupScenario?.custom?.fields?.status || context?.existingAttributes?.testcaseStatuses?.[tcIdentity] || 'pending';
            const tcTitle = tcResource.attributes?.title || tcIdentity;

            const [safeBaseRule, safeScenarioName] = tcIdentity.split('::');
            const originFile = basename(safeBaseRule || '');
            const safeScenario = safeScenarioName ? safeScenarioName.replace('@', '') : '';

            const commentBody = generateGitHubTestrunComment(originFile, safeScenario, tcTitle, localStatus);

            result.push({ identity: tcIdentity, status: localStatus, body: commentBody, title: tcTitle });
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
            const runResources = state.getResources('github_testrun').filter((r: any) =>
                r.identity.split('::')[0].endsWith(tr)
            );

            const distinctFiles = new Set(runResources.map((r: any) => r.identity.split('::')[0]));
            let validResources = runResources;

            if (distinctFiles.size > 1) {
                if (context?.testDirectory) {
                    const normalizedTestDir = context.testDirectory.replace(/^\.\//, '');
                    validResources = runResources.filter((r: any) => r.identity.startsWith(normalizedTestDir));
                    const distinctValid = new Set(validResources.map((r: any) => r.identity.split('::')[0]));
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
