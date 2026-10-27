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
        const aName = a.split('.').pop()?.replace('@', '') || '';
        const bName = b.split('.').pop()?.replace('@', '') || '';
        return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
    });

    for (const tc of sortedTestcases) {
        const tagMatch = tc.match(/@?(tc-[a-zA-Z0-9_-]+)/i);
        const tag = tagMatch ? tagMatch[1].toLowerCase() : null;

        const parts = tc.split('.');
        const scenarioName = parts.pop() || '';
        const normTc = tc.replace(/\\/g, '/');

        const tcResources = state.getResources('github_testcase').filter((r: any) => {
            const normId = (r.identity || '').replace(/\\/g, '/');
            const normTitle = (r.attributes?.title || '').toLowerCase();
            const idLastPart = normId.split('.').pop()?.replace(/^@/, '').toLowerCase();

            // Match by tag if present
            if (tag && (idLastPart === tag || normId.toLowerCase().includes(`@${tag}`) || normId.toLowerCase().includes(`.${tag}`))) {
                const ruleContext = normTc.split('.case.feature')[0];
                const fileBase = ruleContext.split('/').pop();
                if (!fileBase || normId.includes(fileBase)) {
                    return true;
                }
            }

            // Match by title
            if (normTitle && (normTitle === scenarioName.toLowerCase() || normTc.toLowerCase().includes(normTitle))) {
                return true;
            }

            // Match by exact end part or wildcard
            if (scenarioName === '*' || (idLastPart && idLastPart === scenarioName.replace(/^@/, '').toLowerCase())) {
                return true;
            }

            return false;
        });

        const distinctFiles = new Set(tcResources.map((r: any) => {
            const lastDot = r.identity.lastIndexOf('.');
            return lastDot !== -1 ? r.identity.slice(0, lastDot) : r.identity;
        }));
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
            const aName = a.identity.split('.').pop()?.replace('@', '') || '';
            const bName = b.identity.split('.').pop()?.replace('@', '') || '';
            return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        });

        for (const tcResource of validResources) {
            const tcIdentity = tcResource.identity;

            let groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                if (!gs.name) return false;
                const normTc = tcIdentity.replace(/\\/g, '/');
                const lastTc = normTc.split('.').pop() || '';
                const gsTagMatch = gs.name.match(/@?(tc-[a-zA-Z0-9_-]+)/i);
                if (gsTagMatch && lastTc && gsTagMatch[1].toLowerCase() === lastTc.replace(/^@/, '').toLowerCase()) {
                    return true;
                }
                if (normTc.endsWith(`.${gs.name}`) || gs.name.endsWith(`.${lastTc}`) || lastTc === gs.name) {
                    return true;
                }
                const tcTitle = (tcResource.attributes?.title || '').toLowerCase();
                if (tcTitle && gs.name.toLowerCase() === tcTitle) {
                    return true;
                }
                return false;
            });

            if (!groupScenario) {
                groupScenario = s.custom?.groupScenarios?.find((gs: any) => {
                    return gs.name === '*';
                });
            }

            const localStatus = groupScenario?.custom?.fields?.status || context?.existingAttributes?.testcaseStatuses?.[tcIdentity] || 'pending';
            const tcTitle = tcResource.attributes?.title || tcIdentity;

            const lastDot = tcIdentity.lastIndexOf('.');
            const safeBaseRule = lastDot !== -1 ? tcIdentity.slice(0, lastDot) : tcIdentity;
            const safeScenarioName = lastDot !== -1 ? tcIdentity.slice(lastDot + 1) : '';
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
            const runResources = state.getResources('github_testrun').filter((r: any) => {
                const lastDot = r.identity.lastIndexOf('.');
                const base = lastDot !== -1 ? r.identity.slice(0, lastDot) : r.identity;
                return base.endsWith(tr) || r.identity.endsWith(tr);
            });

            const distinctFiles = new Set(runResources.map((r: any) => {
                const lastDot = r.identity.lastIndexOf('.');
                return lastDot !== -1 ? r.identity.slice(0, lastDot) : r.identity;
            }));
            let validResources = runResources;

            if (distinctFiles.size > 1) {
                if (context?.testDirectory) {
                    const normalizedTestDir = context.testDirectory.replace(/^\.\//, '');
                    validResources = runResources.filter((r: any) => r.identity.startsWith(normalizedTestDir));
                    const distinctValid = new Set(validResources.map((r: any) => {
                        const lastDot = r.identity.lastIndexOf('.');
                        return lastDot !== -1 ? r.identity.slice(0, lastDot) : r.identity;
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
