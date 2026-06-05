import { State } from "../core/state";
import { bold, green, red, yellow } from "chalk";
import fs from "fs";
import { StateResource } from "../types";
import { Config } from "../core/config";
import { GitHubAdapter } from "../adapters/github";

interface ReportCmdOptions {
    dir: string;
    type: string;
    format: string;
    filter: string[];
    out?: string;
    groupBy?: string;
    statePath?: string;
    apply?: boolean;
    fields?: string[];
}

export function resolvePath(obj: any, path: string): any {
    if (!path) return undefined;
    const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.');
    let current = obj;
    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    return current;
}

interface FlatData {
    id: string;
    type: string;
    title: string;
    status: string;
    labels: string[];
    assignees: string[];
    milestone: string;
    testRunId: string;
    testPlanId: string;
    issueNumber: number;
    issueUrl: string;
    custom_fields: Record<string, string>;
    createdAt: string;
    updatedAt: string;
    originalResource?: StateResource;
}

export const reportCmd = async (options: ReportCmdOptions) => {
    const { dir, type, format, filter, out, groupBy, statePath, apply, fields } = options;

    const stateObj = new State(dir, statePath);
    await stateObj.init();

    // 1. Extract data into a unified FlatData array
    const testcases = stateObj.getResources('github_testcase');
    const testruns = stateObj.getResources('github_testrun');
    const testplans = stateObj.getResources('github_testplan');

    // Build map for quick access
    const runMap = new Map<string, StateResource>();
    for (const r of testruns) runMap.set(r.identity, r);

    // Flat data array
    let data: FlatData[] = [];

    // Since testcases might be executed in multiple testruns, we iterate testruns -> testcases
    // But we also want unexecuted testcases.
    const executedTestcases = new Set<string>();

    for (const run of testruns) {
        const statuses = run.attributes.testcaseStatuses as Record<string, string> || {};

        for (const [tcIdentity, status] of Object.entries(statuses)) {
            const tc = testcases.find(t => t.identity === tcIdentity);
            if (!tc) continue;

            executedTestcases.add(tcIdentity);

            data.push({
                id: tcIdentity,
                type: 'github_testcase',
                title: String(tc.attributes.title || ''),
                status: status || 'pending',
                labels: Array.isArray(tc.attributes.labels) ? tc.attributes.labels.map(String) : [],
                assignees: Array.isArray(tc.attributes.assignees) ? tc.attributes.assignees.map(String) : [],
                milestone: String(tc.attributes.milestone || ''),
                testRunId: run.identity,
                testPlanId: '', // To be mapped if needed
                issueNumber: Number(tc.attributes.issueNumber || 0),
                issueUrl: `https://github.com/issues/${tc.attributes.issueNumber}`,
                custom_fields: (tc.attributes.custom_fields as any) || {},
                createdAt: String(tc.attributes.createdAt || tc.lastApplied || new Date().toISOString()),
                updatedAt: String(tc.attributes.updatedAt || tc.lastApplied || new Date().toISOString()),
                originalResource: tc
            });
        }
    }

    // Add testcases that are not in any run
    for (const tc of testcases) {
        if (!executedTestcases.has(tc.identity)) {
            data.push({
                id: tc.identity,
                type: 'github_testcase',
                title: String(tc.attributes.title || ''),
                status: 'unexecuted',
                labels: Array.isArray(tc.attributes.labels) ? tc.attributes.labels.map(String) : [],
                assignees: Array.isArray(tc.attributes.assignees) ? tc.attributes.assignees.map(String) : [],
                milestone: String(tc.attributes.milestone || ''),
                testRunId: '',
                testPlanId: '',
                issueNumber: Number(tc.attributes.issueNumber || 0),
                issueUrl: `https://github.com/issues/${tc.attributes.issueNumber}`,
                custom_fields: (tc.attributes.custom_fields as any) || {},
                createdAt: String(tc.attributes.createdAt || tc.lastApplied || new Date().toISOString()),
                updatedAt: String(tc.attributes.updatedAt || tc.lastApplied || new Date().toISOString()),
                originalResource: tc
            });
        }
    }

    // 2. Apply Filters
    for (const f of filter) {
        const [key, val] = f.split('=');
        if (!key || !val) continue;

        data = data.filter(item => {
            const itemVal = (item as any)[key] || item.custom_fields[key];
            if (Array.isArray(itemVal)) {
                return itemVal.includes(val);
            }
            return String(itemVal) === val;
        });
    }

    // 3. Generate Report
    let content = '';

    if (format === 'json') {
        content = JSON.stringify(data, null, 2);
    } else if (format === 'csv') {
        const headers = ['ID', 'Title', 'Status', 'Labels', 'Assignees', 'Milestone', 'TestRun', 'IssueNumber'];
        const rows = data.map(d => [
            d.id,
            `"${d.title.replace(/"/g, '""')}"`,
            d.status,
            `"${d.labels.join(' ')}"`,
            `"${d.assignees.join(' ')}"`,
            `"${d.milestone}"`,
            d.testRunId,
            d.issueNumber
        ]);
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    } else {
        // Markdown format
        const config = new Config(dir);
        content = generateMarkdownReport(type, data, groupBy, config, testruns, testplans);
    }

    // Output
    if (out) {
        const path = require('path');
        const resolvedOut = path.resolve(dir, out);
        fs.writeFileSync(resolvedOut, content, 'utf-8');
        console.log(green(`Report saved to ${out}`));
    } else if (!apply) {
        console.log(content);
    }

    // Apply to GitHub
    if (apply) {
        if (format !== 'md') {
            console.log(yellow('Warning: Uploading to GitHub is recommended in "md" format. Currently using ' + format));
        }

        const config = new Config(dir);

        const ghConfig = config.getGitHub();
        if (!ghConfig) {
            console.error(red('Error: GitHub configuration not found in testform.json'));
            process.exit(1);
        }

        const reportFields = config.getFields('testreport');
        const customFieldsMap: Record<string, string> = {};
        let assignees: string[] = [];
        let milestone: string | undefined = undefined;
        let issueLabels: string[] = ['testreport'];

        // Parse --field arguments
        for (const f of fields || []) {
            let parsedField: Record<string, string> = {};
            if (f.trim().startsWith('{')) {
                try {
                    parsedField = JSON.parse(f);
                } catch (e) {
                    console.log(yellow(`Warning: Could not parse field JSON: ${f}`));
                    continue;
                }
            } else {
                const parts = f.split('=');
                if (parts.length >= 2) {
                    parsedField[parts[0]] = parts.slice(1).join('=');
                } else {
                    console.log(yellow(`Warning: Invalid field format: ${f}. Expected key=value or JSON`));
                    continue;
                }
            }

            for (const [k, v] of Object.entries(parsedField)) {
                const def = reportFields.find(df => df.name.toLowerCase() === k.toLowerCase());
                if (k.toLowerCase() === 'assignees') {
                    assignees = assignees.concat(v.split(',').map(s => s.trim().replace(/^@/, '')));
                } else if (k.toLowerCase() === 'milestone') {
                    milestone = v;
                } else if (def?.type === 'tags') {
                    issueLabels.push(v);
                } else {
                    customFieldsMap[k] = v;
                }
            }
        }

        const github = new GitHubAdapter(ghConfig);

        const dateStr = new Date().toISOString().split('T')[0];
        const titleType = type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ');
        const issueTitle = `${titleType} - ${dateStr}`;

        console.log(`Uploading report to GitHub...`);
        const result = await github.createIssue({
            title: issueTitle,
            body: content,
            labels: [...new Set(issueLabels)],
            assignees: assignees.length > 0 ? assignees : undefined,
            milestone: milestone ? parseInt(milestone, 10) : undefined
        });

        console.log(green(`✅ Report successfully created: https://github.com/${ghConfig.owner}/${ghConfig.repository}/issues/${result.number}`));

        if (result.node_id && ghConfig.projectId) {
            try {
                const itemId = await github.addToProject(result.node_id!);
                if (itemId) {
                    console.log(green(`✅ Issue added to GitHub Project.`));
                    if (Object.keys(customFieldsMap).length > 0) {
                        console.log(`Setting custom fields...`);
                        await github.updateProjectItemFields(itemId, customFieldsMap);
                        console.log(green(`✅ Custom fields updated successfully.`));
                    }
                }
            } catch (e: any) {
                console.log(yellow(`Warning: Could not add to project or update custom fields. ${e.message}`));
            }
        }
    }
};

const ICONS: Record<string, string> = {
    passed: '✅',
    failed: '❌',
    pending: '⏳',
    blocked: '⚠️',
    skipped: '⏭️',
    unexecuted: '❔'
};

function generateMarkdownReport(type: string, data: FlatData[], groupBy: string = 'labels', config: Config, testruns: StateResource[] = [], testplans: StateResource[] = []): string {
    const lines: string[] = [];

    if (type === 'testcase-summary') {
        lines.push('# Informe de Casos de Prueba');
        lines.push('');
        lines.push('| ID | Título | Etiquetas | Estado |');
        lines.push('|---|---|---|---|');
        data.forEach(d => {
            const icon = ICONS[d.status.toLowerCase()] || ICONS.unexecuted;
            lines.push(`| ${d.id} | ${d.title} | ${d.labels.join(', ')} | ${icon} ${d.status} |`);
        });
    }
    else if (type === 'testrun-summary') {
        lines.push('# Test Run Summary');
        lines.push('');

        const totalRuns = testruns.length;
        const activeRuns = testruns.filter(r => r.attributes.state === 'open').length;
        const closedRuns = testruns.filter(r => r.attributes.state === 'closed').length;
        const totalTestCases = new Set(data.filter(d => d.testRunId).map(d => d.id)).size;
        const requirementsCount = new Set(data.filter(d => d.testRunId).map(d => d.id.split('::')[0])).size;
        const failuresCount = data.filter(d => d.testRunId && ['failed', 'blocked'].includes(d.status.toLowerCase())).length;

        // 1. Chart: Total Test Runs (Half Doughnut)
        const runsChartObj = {
            type: 'doughnut',
            data: {
                labels: ['Active', 'Closed'],
                datasets: [{ data: [activeRuns, closedRuns], backgroundColor: ['#f39c12', '#3498db'] }]
            },
            options: {
                rotation: 270,
                circumference: 180,
                plugins: { doughnutlabel: { labels: [{ text: totalRuns.toString(), font: { size: 40 } }, { text: 'Test Runs' }] }, legend: { position: 'right' } }
            }
        };
        const runsChartUrl = `https://quickchart.io/chart?w=400&h=200&c=${encodeURIComponent(JSON.stringify(runsChartObj))}`;

        // 2. Chart: Test Case Break-up
        const stats = getStats(data.filter(d => d.testRunId));
        const tcBreakupObj = {
            type: 'doughnut',
            data: {
                labels: ['Passed', 'Failed', 'Blocked', 'Pending', 'Skipped'],
                datasets: [{ data: [stats.passed, stats.failed, stats.blocked, stats.pending, stats.skipped], backgroundColor: ['#2ea043', '#f85149', '#58a6ff', '#e3b341', '#8b949e'] }]
            },
            options: {
                plugins: { doughnutlabel: { labels: [{ text: totalTestCases.toString(), font: { size: 30 } }, { text: 'Total Test Cases' }] }, legend: { position: 'right' } }
            }
        };
        const tcBreakupUrl = `https://quickchart.io/chart?w=400&h=200&c=${encodeURIComponent(JSON.stringify(tcBreakupObj))}`;

        // 3. Chart: Test Runs Break-up (Bar chart over time)
        const dateCounts: Record<string, number> = {};
        for (const run of testruns) {
            const date = (run.createdAt || run.lastApplied || new Date().toISOString()).split('T')[0];
            dateCounts[date] = (dateCounts[date] || 0) + 1;
        }
        const dates = Object.keys(dateCounts).sort();
        const counts = dates.map(d => dateCounts[d]);
        const barChartObj = {
            type: 'bar',
            data: { labels: dates.length ? dates : ['No Data'], datasets: [{ label: 'Test Runs', data: counts.length ? counts : [0], backgroundColor: '#3498db' }] },
            options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
        };
        const barChartUrl = `https://quickchart.io/chart?w=400&h=200&c=${encodeURIComponent(JSON.stringify(barChartObj))}`;

        // HTML Layout
        lines.push('<table width="100%">');
        lines.push('<tr><td width="50%">');
        lines.push('<h3>Total Test Runs</h3>');
        lines.push(`<img src="${runsChartUrl}" />`);
        lines.push('</td><td width="50%" valign="top">');
        lines.push('<h3>Total Test Cases</h3>');
        lines.push(`<h1>${totalTestCases}</h1><br>`);
        lines.push('<h3>Total Linked Requirements</h3>');
        lines.push(`<h1>${requirementsCount}</h1>`);
        lines.push('</td></tr>');
        lines.push('</table>');

        lines.push('<table width="100%">');
        lines.push('<tr><td width="50%">');
        lines.push('<h3>Test Case Break-up</h3>');
        lines.push(`<img src="${tcBreakupUrl}" />`);
        lines.push('</td><td width="50%">');
        lines.push('<h3>Test Runs Break-up</h3>');
        lines.push(`<img src="${barChartUrl}" />`);
        lines.push('</td></tr>');
        lines.push('</table>');

        lines.push('<table width="100%">');
        lines.push('<tr><td width="50%">');
        lines.push('<h3>Defects Linked with Test Results</h3>');
        lines.push(`<h1>${failuresCount}</h1>`);
        lines.push('</td><td width="50%">');
        lines.push('<h3>Requirements Linked with Test Runs</h3>');
        lines.push(`<h1>${requirementsCount}</h1>`);
        lines.push('</td></tr>');
        lines.push('</table>');
    }
    else if (type === 'testrun-detailed') {
        lines.push('# Test Run Detailed Report');
        lines.push('');

        const totalRuns = testruns.length;
        const activeRuns = testruns.filter(r => r.attributes.state === 'open').length;
        const closedRuns = testruns.filter(r => r.attributes.state === 'closed').length;
        const totalTestCases = new Set(data.filter(d => d.testRunId).map(d => d.id)).size;
        const requirementsCount = new Set(data.filter(d => d.testRunId).map(d => d.id.split('::')[0])).size;

        // Chart: Trend line over specific test runs
        const runCounts: Record<string, number> = {};
        for (const d of data.filter(d => d.testRunId)) {
            runCounts[d.testRunId!] = (runCounts[d.testRunId!] || 0) + 1;
        }
        const runLabels = Object.keys(runCounts).sort();
        const runData = runLabels.map(r => runCounts[r]);
        const trendChartObj = {
            type: 'line',
            data: { labels: runLabels.length ? runLabels : ['No Data'], datasets: [{ label: 'Test Cases', data: runData.length ? runData : [0], borderColor: '#3498db', fill: false }] },
            options: { plugins: { legend: { display: false } } }
        };
        const trendChartUrl = `https://quickchart.io/chart?w=500&h=200&c=${encodeURIComponent(JSON.stringify(trendChartObj))}`;

        lines.push('<table width="100%">');
        lines.push('<tr><td width="60%">');
        lines.push('<h3>Test run performance</h3>');
        lines.push(`<h1>${totalTestCases}</h1> <small>Test Cases trend over Specific Test Runs</small><br/>`);
        lines.push(`<img src="${trendChartUrl}" />`);
        lines.push('</td><td width="40%" valign="top">');
        
        lines.push('<table width="100%"><tr><td>');
        lines.push('<h3>Active Test Runs</h3>');
        lines.push(`<h2>${activeRuns} / ${totalRuns}</h2>`);
        lines.push('</td><td>');
        lines.push('<h3>Closed Test Runs</h3>');
        lines.push(`<h2>${closedRuns} / ${totalRuns}</h2>`);
        lines.push('</td></tr><tr><td>');
        lines.push('<h3>Total Test Cases</h3>');
        lines.push(`<h2>${totalTestCases}</h2>`);
        lines.push('</td><td>');
        lines.push('<h3>Total Linked Issues</h3>');
        lines.push(`<h2>${requirementsCount}</h2>`);
        lines.push('</td></tr></table>');
        
        lines.push('</td></tr>');
        lines.push('</table>');

        lines.push('');
        lines.push(`### ${totalTestCases} Test cases included in this report`);
        lines.push('');
        lines.push('| TEST RUN | TEST CASE | TEST RUN LATEST STATUS | TEST CASE PRIORITY |');
        lines.push('|---|---|---|---|');

        const priorityPath = config.getReportMapping('priority') || 'attributes.custom_fields.priority';
        
        for (const d of data.filter(d => d.testRunId)) {
            let priority = resolvePath(d.originalResource, priorityPath);
            if (priority === undefined) priority = 'Medium';
            const icon = ICONS[d.status.toLowerCase()] || ICONS.unexecuted;
            lines.push(`| ${d.testRunId} | **${d.id}**<br/>${d.title} | ${icon} ${d.status} | ${priority} |`);
        }
    }
    else if (type === 'testplan-summary') {
        lines.push('# Test Plan Summary');
        lines.push('');

        const linkedTestRunIds = new Set<string>();
        for (const plan of testplans) {
            const planRuns = plan.attributes.testruns as string[] || [];
            for (const r of planRuns) {
                const matchingRun = testruns.find(tr => tr.identity.endsWith(r));
                if (matchingRun) linkedTestRunIds.add(matchingRun.identity);
            }
        }

        const planData = data.filter(d => d.testRunId && linkedTestRunIds.has(d.testRunId));
        const totalPlanTestCases = planData.length;

        const stats = getStats(planData);
        const planProgressObj = {
            type: 'doughnut',
            data: {
                labels: ['Passed', 'Failed', 'Blocked', 'Pending', 'Skipped'],
                datasets: [{ data: [stats.passed, stats.failed, stats.blocked, stats.pending, stats.skipped], backgroundColor: ['#2ea043', '#f85149', '#58a6ff', '#e3b341', '#8b949e'] }]
            },
            options: {
                plugins: { doughnutlabel: { labels: [{ text: totalPlanTestCases.toString(), font: { size: 30 } }, { text: 'Total Test Cases' }] }, legend: { position: 'right' } }
            }
        };
        const planProgressUrl = `https://quickchart.io/chart?w=400&h=200&c=${encodeURIComponent(JSON.stringify(planProgressObj))}`;

        const runResults: Record<string, {passed: number, failed: number}> = {};
        for (const d of planData) {
            if (!runResults[d.testRunId!]) runResults[d.testRunId!] = {passed: 0, failed: 0};
            if (d.status.toLowerCase() === 'passed') runResults[d.testRunId!].passed++;
            if (d.status.toLowerCase() === 'failed') runResults[d.testRunId!].failed++;
        }
        const runLabels = Object.keys(runResults).sort();
        const passedData = runLabels.map(r => runResults[r].passed);
        const failedData = runLabels.map(r => runResults[r].failed);
        const planBarObj = {
            type: 'bar',
            data: { 
                labels: runLabels.length ? runLabels : ['No Data'], 
                datasets: [
                    { label: 'Passed', data: passedData.length ? passedData : [0], backgroundColor: '#2ea043' },
                    { label: 'Failed', data: failedData.length ? failedData : [0], backgroundColor: '#f85149' }
                ] 
            },
            options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
        };
        const planBarUrl = `https://quickchart.io/chart?w=400&h=200&c=${encodeURIComponent(JSON.stringify(planBarObj))}`;

        lines.push('<table width="100%">');
        lines.push('<tr><td width="50%">');
        lines.push('<h3>Overall Test Plan Progress</h3>');
        lines.push(`<img src="${planProgressUrl}" />`);
        lines.push('</td><td width="50%">');
        lines.push('<h3>Results from All Linked Test Runs</h3>');
        lines.push(`<img src="${planBarUrl}" />`);
        lines.push('</td></tr>');
        lines.push('</table>');

        lines.push('');
        lines.push(`### ${linkedTestRunIds.size} test runs linked to these test plans`);
        lines.push('');
        lines.push('| RUNS | TESTS | TESTS STATUS |');
        lines.push('|---|---|---|');
        for (const runId of Array.from(linkedTestRunIds)) {
            const runItems = planData.filter(d => d.testRunId === runId);
            const rStats = getStats(runItems);
            lines.push(`| **${runId}** | ${runItems.length} | 🟢 ${rStats.passed} 🔴 ${rStats.failed} ⏳ ${rStats.pending} |`);
        }

        lines.push('');
        lines.push('<details><summary><b>Linked Test Cases</b></summary>');
        lines.push('');
        lines.push('| TEST RUN | ID | TITLE | PRIORITY | TYPE OF TEST | STATUS |');
        lines.push('|---|---|---|---|---|---|');
        const priorityPath = config.getReportMapping('priority') || 'attributes.custom_fields.priority';
        const typePath = config.getReportMapping('type') || 'attributes.custom_fields.type';
        
        for (const d of planData) {
            let priority = resolvePath(d.originalResource, priorityPath) || '--';
            let testType = resolvePath(d.originalResource, typePath) || '--';
            const icon = ICONS[d.status.toLowerCase()] || ICONS.unexecuted;
            lines.push(`| ${d.testRunId} | ${d.id} | ${d.title} | ${priority} | ${testType} | ${icon} ${d.status} |`);
        }
        lines.push('');
        lines.push('</details>');
    }
    else if (type === 'defects') {
        lines.push('# Informe de Defectos');
        lines.push('');
        const failures = data.filter(d => ['failed', 'blocked'].includes(d.status.toLowerCase()));
        if (failures.length === 0) {
            lines.push('🎉 No hay defectos reportados.');
        } else {
            lines.push('| Run | Test Case | Título | Issue |');
            lines.push('|---|---|---|---|');
            failures.forEach(d => {
                lines.push(`| ${d.testRunId} | ${d.id} | ${d.title} | [#${d.issueNumber}](${d.issueUrl}) |`);
            });
        }
    }
    else if (type === 'traceability') {
        lines.push('# Requirement Traceability Report');
        lines.push('');

        let byGroup: Record<string, FlatData[]> = {};
        if (groupBy && groupBy !== 'labels') {
            // Si el usuario pasa explícitamente un --groupBy, lo respetamos (ej. milestone, attributes.custom_fields.sprint)
            byGroup = groupByField(data, groupBy);
        } else {
            // Por defecto, agrupamos por el archivo .feature (Requisito) extrayéndolo del ID
            for (const d of data) {
                const featurePath = d.id.split('::')[0] || 'Unknown';
                if (!byGroup[featurePath]) byGroup[featurePath] = [];
                byGroup[featurePath].push(d);
            }
        }

        const totalReqs = Object.keys(byGroup).length;
        lines.push(`[![Total Reqs](https://img.shields.io/badge/Total_Requirements-${totalReqs}-blue?style=for-the-badge)]()`);
        lines.push('');

        for (const [reqName, items] of Object.entries(byGroup)) {
            const stats = getStats(items);
            const total = items.length;
            const pct = total > 0 ? Math.round((stats.passed / total) * 100) : 0;
            
            let color = 'red';
            if (pct === 100) color = 'success';
            else if (pct > 50) color = 'yellow';

            lines.push('<details>');
            lines.push(`<summary><b>${reqName}</b> <img src="https://img.shields.io/badge/Coverage-${pct}%25-${color}"></summary>`);
            lines.push('<br>');
            lines.push('<table width="100%">');
            lines.push('  <tr><th>Test Case</th><th>Status</th><th>Assignee</th></tr>');
            
            items.forEach(d => {
                const icon = ICONS[d.status.toLowerCase()] || ICONS.unexecuted;
                const assignee = d.assignees[0] ? `@${d.assignees[0]}` : 'Unassigned';
                lines.push(`  <tr>`);
                lines.push(`    <td><code>${d.id}</code><br>${d.title}</td>`);
                lines.push(`    <td align="center">${icon} ${d.status}</td>`);
                lines.push(`    <td align="center">${assignee}</td>`);
                lines.push(`  </tr>`);
            });
            lines.push('</table>');
            lines.push('</details>');
            lines.push('');
        }
    }
    else if (type === 'coverage') {
        lines.push('# Informe de Cobertura');
        lines.push('');
        const byTag = groupByTags(data);
        lines.push('| Etiqueta | Total | ✅ Passed | ❌ Failed | Cobertura % |');
        lines.push('|---|---|---|---|---|');
        for (const [tag, items] of Object.entries(byTag)) {
            const stats = getStats(items);
            const total = items.length;
            const pct = total > 0 ? Math.round((stats.passed / total) * 100) : 0;
            lines.push(`| ${tag} | ${total} | ${stats.passed} | ${stats.failed} | ${pct}% |`);
        }
    }
    else if (type === 'two-dimensional') {
        lines.push('# Informe Bidimensional');
        lines.push('');
        const byTag = groupByTags(data);
        const allStatuses = ['passed', 'failed', 'pending', 'blocked', 'skipped', 'unexecuted'];

        // Header
        const header = ['Etiqueta', ...allStatuses.map(s => `${ICONS[s]} ${s}`)];
        lines.push(`| ${header.join(' | ')} |`);
        lines.push(`|${header.map(() => '---').join('|')}|`);

        for (const [tag, items] of Object.entries(byTag)) {
            const stats = getStats(items);
            const row = [tag];
            for (const s of allStatuses) {
                row.push(String((stats as any)[s] || 0));
            }
            lines.push(`| ${row.join(' | ')} |`);
        }
    }
    else if (type === 'test-case-activity') {
        lines.push('# Test Case Activity');
        lines.push('');

        // 1. Calculate Summary
        const total = data.length;
        const updated = data.filter(d => d.updatedAt && d.createdAt && d.updatedAt !== d.createdAt).length;
        const deleted = 0; // Not tracked in state currently

        lines.push(`[![Created](https://img.shields.io/badge/Created-${total}-2ea043?style=for-the-badge)]() [![Updated](https://img.shields.io/badge/Updated-${updated}-1f6feb?style=for-the-badge)]() [![Deleted](https://img.shields.io/badge/Deleted-${deleted}-f85149?style=for-the-badge)]()`);
        lines.push('');

        const autoField = config.getReportMapping('automation') || 'attributes.custom_fields.automate';

        // 2. Automation Coverage (Doughnut Chart via QuickChart)
        let autoNotReq = 0, automated = 0, notAutomated = 0, cannotBeAutomated = 0;
        for (const d of data) {
            const valFromPath = resolvePath(d.originalResource, autoField) || resolvePath(d.originalResource, 'attributes.custom_fields.automation');
            const automateValue = String(valFromPath || '').toLowerCase();
            if (automateValue === 'true' || automateValue === 'yes' || automateValue === 'automated') {
                automated++;
            } else if (automateValue === 'not required') {
                autoNotReq++;
            } else if (automateValue === 'cannot be automated') {
                cannotBeAutomated++;
            } else {
                notAutomated++;
            }
        }

        const autoChartData = {
            type: 'doughnut',
            data: {
                labels: ['Not Required', 'Automated', 'Not Automated', 'Cannot Be'],
                datasets: [{ data: [autoNotReq, automated, notAutomated, cannotBeAutomated], backgroundColor: ['#2ea043', '#1f6feb', '#d29922', '#f85149'], borderWidth: 0 }]
            },
            options: { plugins: { datalabels: { display: false }, legend: { labels: { fontSize: 14 } } } }
        };
        const autoChartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(autoChartData))}&w=600&h=300`;

        const trendMap: Record<string, number> = {};
        for (const d of data) {
            const dateStr = d.createdAt ? d.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
            trendMap[dateStr] = (trendMap[dateStr] || 0) + 1;
        }
        const sortedDates = Object.keys(trendMap).sort();
        const trendCounts = sortedDates.map(date => trendMap[date]);

        let trendChartUrl = '';
        if (sortedDates.length > 0) {
            const trendChartData = {
                type: 'bar',
                data: {
                    labels: sortedDates,
                    datasets: [{ label: 'Created', data: trendCounts, backgroundColor: '#8957e5', borderRadius: 4 }]
                },
                options: {
                    plugins: { legend: { display: false } },
                    scales: {
                        xAxes: [{ gridLines: { display: false } }],
                        yAxes: [{ ticks: { stepSize: 1, beginAtZero: true }, gridLines: { color: '#e1e4e8' } }]
                    }
                }
            };
            trendChartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(trendChartData))}&w=600&h=300`;
        }

        // Layout Charts Stacked Vertically
        lines.push('### Automation Coverage');
        lines.push(`<img src="${autoChartUrl}" width="100%">`);
        lines.push('');
        if (trendChartUrl) {
            lines.push('### Trend of Test Cases');
            lines.push(`<img src="${trendChartUrl}" width="100%">`);
            lines.push('');
        }

        // 3. Top 5 Creators (HTML Table)
        const creators: Record<string, number> = {};
        for (const d of data) {
            const creator = d.assignees[0] || 'Unassigned';
            creators[creator] = (creators[creator] || 0) + 1;
        }
        const topCreators = Object.entries(creators).sort((a, b) => b[1] - a[1]).slice(0, 5);

        lines.push('### 🏆 Top 5 Test Case Creators');
        lines.push('<table width="100%">');
        lines.push('  <tr><th width="10%">#</th><th width="70%">Assignee</th><th width="20%">Count</th></tr>');
        topCreators.forEach(([creator, count], idx) => {
            lines.push(`  <tr><td align="center">${idx + 1}</td><td><img src="https://github.com/${creator}.png?size=24" width="24" style="border-radius:50%; vertical-align:middle;"> <b>@${creator}</b></td><td align="center">${count}</td></tr>`);
        });
        lines.push('</table>');
        lines.push('');

        // 5. Test Cases List (HTML Table)
        const priorityField = config.getReportMapping('priority') || 'attributes.custom_fields.priority';
        const typeField = config.getReportMapping('type') || 'attributes.custom_fields.type';
        const creatorField = config.getReportMapping('creator') || 'attributes.assignees[0]';

        lines.push('### 📋 Test Cases included in this report');
        lines.push('<table width="100%">');
        lines.push('  <tr><th>ID</th><th>Title</th><th>Priority</th><th>Type</th><th>Updated</th><th>Assignee</th></tr>');
        const sortedData = [...data].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)).slice(0, 5);
        for (const d of sortedData) {
            const priority = resolvePath(d.originalResource, priorityField) || 'Medium';
            const typeValue = resolvePath(d.originalResource, typeField) || 'General';
            const creator = resolvePath(d.originalResource, creatorField) || d.assignees[0] || 'Unassigned';
            const updatedStr = d.updatedAt ? d.updatedAt.replace('T', ' ').replace('Z', '') : 'N/A';
            lines.push(`  <tr>`);
            lines.push(`    <td><code>${d.id}</code></td>`);
            lines.push(`    <td>${d.title}</td>`);
            lines.push(`    <td align="center">${priority}</td>`);
            lines.push(`    <td align="center">${typeValue}</td>`);
            lines.push(`    <td align="center">${updatedStr.split(' ')[0]}</td>`);
            lines.push(`    <td align="center">@${creator}</td>`);
            lines.push(`  </tr>`);
        }
        lines.push('</table>');
    }
    else if (type === 'raw') {
        lines.push('# Raw Data Export');
        lines.push('> Note: Use --format json or --format csv for structured data.');
    }
    else {
        lines.push(`Unknown report type: ${type}`);
    }

    return lines.join('\n');
}

function groupByField(data: FlatData[], field: string): Record<string, FlatData[]> {
    const result: Record<string, FlatData[]> = {};
    for (const item of data) {
        let valStr = '';
        if (field in item) {
            valStr = String(item[field as keyof FlatData] || '');
        } else {
            valStr = String(resolvePath(item.originalResource, field) || '');
        }
        if (!result[valStr]) result[valStr] = [];
        result[valStr].push(item);
    }
    return result;
}

function groupByTags(data: FlatData[]): Record<string, FlatData[]> {
    const result: Record<string, FlatData[]> = {};
    for (const item of data) {
        for (const tag of item.labels) {
            if (!result[tag]) result[tag] = [];
            result[tag].push(item);
        }
        if (item.labels.length === 0) {
            if (!result['untagged']) result['untagged'] = [];
            result['untagged'].push(item);
        }
    }
    return result;
}

function getStats(data: FlatData[]) {
    const stats: Record<string, number> = {
        passed: 0, failed: 0, pending: 0, blocked: 0, skipped: 0, unexecuted: 0
    };
    for (const item of data) {
        const s = item.status.toLowerCase();
        if (stats[s] !== undefined) {
            stats[s]++;
        } else {
            stats[s] = 1;
        }
    }
    return stats;
}
