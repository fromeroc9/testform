import { bold, cyan, dim, green, magenta } from 'chalk';
import { Parser } from '../core/parser';
import { IScope, ParserScenario } from '../core/types';
import { VariableParser } from '../core/variables';
import { DependencyResolver } from '../core/dependencies';
import { normalizeAddress, addressesMatch } from '../core/utils';
import { matchesScope, matchesTestrunSelector, matchesTarget } from '../core/selector';
import { basename } from 'path';

export interface GraphCmdOptions {
    dir?: string;
    scope?: IScope;
    drawCycles?: boolean;
    variables?: VariableParser;
    format?: 'dot' | 'mermaid' | 'tree';
    type?: string;
    plan?: string;
    moduleDepth?: number;
}

interface GraphNode {
    id: string;
    label: string;
    kind: 'testplan' | 'testrun' | 'testcase' | 'provider';
}

interface GraphEdge {
    from: string;
    to: string;
    kind: 'contains' | 'depends_on';
    label?: string;
}

interface TcItem {
    id: string;
    name: string;
    uri: string;
    tags: string[];
    identityTag?: string;
    scenario: ParserScenario;
    linkedToRun?: boolean;
}

interface RunSpec {
    ruleName?: string;
    scenarioName?: string;
    tags?: string[];
}

interface RunItem {
    id: string;
    name: string;
    uri: string;
    tags: string[];
    identityTag?: string;
    specs: RunSpec[];
    matchedTestcases: TcItem[];
    linkedToPlan?: boolean;
}

interface PlanItem {
    id: string;
    name: string;
    uri: string;
    tags: string[];
    identityTag?: string;
    testrunSelectors: string[];
    matchedTestruns: RunItem[];
}

function escapeDot(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toMermaidId(str: string): string {
    return 'node_' + str.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeMermaidLabel(str: string): string {
    return str.replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ');
}

function findCycleEdges(edges: Array<{ from: string; to: string }>): Set<string> {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from)!.push(e.to);
    }

    const visited = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: finished
    const cycleEdges = new Set<string>();

    function dfs(u: string, path: string[]) {
        visited.set(u, 1);
        path.push(u);

        for (const v of adj.get(u) || []) {
            const state = visited.get(v) || 0;
            if (state === 1) {
                cycleEdges.add(`${u}->${v}`);
                const idx = path.indexOf(v);
                if (idx !== -1) {
                    for (let i = idx; i < path.length - 1; i++) {
                        cycleEdges.add(`${path[i]}->${path[i + 1]}`);
                    }
                    cycleEdges.add(`${path[path.length - 1]}->${v}`);
                }
            } else if (state === 0) {
                dfs(v, path);
            }
        }

        path.pop();
        visited.set(u, 2);
    }

    for (const node of adj.keys()) {
        if ((visited.get(node) || 0) === 0) {
            dfs(node, []);
        }
    }

    return cycleEdges;
}

export const graphCmd = async (options: GraphCmdOptions = {}) => {
    const {
        dir = '.',
        scope = 'testcase',
        drawCycles = false,
        format = 'dot',
        type
    } = options;
    const vars = options.variables || new VariableParser(undefined, undefined, dir);
    const parser = new Parser(dir, vars);
    const scenarios = parser.content();
    const depResolver = new DependencyResolver(dir);

    // 1. Separate by scope
    const testcasesAll = scenarios.filter(s => matchesScope(s, 'testcase'));
    const testrunsAll = scenarios.filter(s => matchesScope(s, 'testrun'));
    const testplansAll = scenarios.filter(s => matchesScope(s, 'testplan'));

    if (testplansAll.length === 0 && testrunsAll.length === 0 && testcasesAll.length === 0) {
        console.log('No test configurations found.');
        return;
    }

    // 2. Build structured Testcases
    const testcaseItems: TcItem[] = testcasesAll.map(s => {
        const rawTags = ((s.tags || []) as any[]).map(t => typeof t === 'string' ? t : (t?.name || ''));
        const featureTags = ((s.feature?.tags || []) as any[]).map(t => typeof t === 'string' ? t : (t?.name || ''));
        const allTags = Array.from(new Set([...rawTags, ...featureTags]));
        const idTag = s.custom?.identity || allTags.find(t => /^@?tc-\d+$/i.test(t));

        return {
            id: `testcase.${s.name}`,
            name: s.name,
            uri: s.uri,
            tags: allTags,
            identityTag: idTag,
            scenario: s,
            linkedToRun: false
        };
    });

    // 3. Build structured Testruns (grouped by file URI)
    const runGroups = new Map<string, ParserScenario[]>();
    for (const r of testrunsAll) {
        if (!runGroups.has(r.uri)) runGroups.set(r.uri, []);
        runGroups.get(r.uri)!.push(r);
    }

    const testrunItems: RunItem[] = Array.from(runGroups.entries()).map(([uri, group]) => {
        const first = group[0];
        const runName = first.feature?.name || basename(uri).replace(/(\.(run|case|plan))?\.feature$/i, '');
        const allTags: string[] = [];
        for (const s of group) {
            for (const t of ((s.tags || []) as any[])) {
                allTags.push(typeof t === 'string' ? t : (t?.name || ''));
            }
            for (const t of ((s.feature?.tags || []) as any[])) {
                allTags.push(typeof t === 'string' ? t : (t?.name || ''));
            }
        }
        const uniqueTags = Array.from(new Set(allTags));
        const idTag = first.custom?.identity || uniqueTags.find(t => /^@?tr-\d+$/i.test(t));

        const specs: RunSpec[] = group.map(s => ({
            ruleName: s.rule?.name,
            scenarioName: s.name,
            tags: ((s.tags || []) as any[]).map(t => typeof t === 'string' ? t : (t?.name || ''))
        }));

        return {
            id: `testrun.${runName}`,
            name: runName,
            uri,
            tags: uniqueTags,
            identityTag: idTag,
            specs,
            matchedTestcases: [],
            linkedToPlan: false
        };
    });

    // 4. Build structured Testplans (grouped by file URI)
    const planGroups = new Map<string, ParserScenario[]>();
    for (const p of testplansAll) {
        if (!planGroups.has(p.uri)) planGroups.set(p.uri, []);
        planGroups.get(p.uri)!.push(p);
    }

    const testplanItems: PlanItem[] = Array.from(planGroups.entries()).map(([uri, group]) => {
        const first = group[0];
        const planName = first.feature?.name || basename(uri).replace(/(\.(run|case|plan))?\.feature$/i, '');
        const allTags: string[] = [];
        for (const s of group) {
            for (const t of ((s.tags || []) as any[])) {
                allTags.push(typeof t === 'string' ? t : (t?.name || ''));
            }
            for (const t of ((s.feature?.tags || []) as any[])) {
                allTags.push(typeof t === 'string' ? t : (t?.name || ''));
            }
        }
        const uniqueTags = Array.from(new Set(allTags));
        const idTag = first.custom?.identity || uniqueTags.find(t => /^@?tp-\d+$/i.test(t));

        const trSelectors = new Set<string>();
        for (const s of group) {
            if (s.rule?.name) trSelectors.add(s.rule.name);
            if (s.name && s.name !== '*') trSelectors.add(s.name);
        }

        return {
            id: `testplan.${planName}`,
            name: planName,
            uri,
            tags: uniqueTags,
            identityTag: idTag,
            testrunSelectors: Array.from(trSelectors),
            matchedTestruns: []
        };
    });

    // ─── Match Testruns -> Testcases ─────────────────────────────────────────
    for (const run of testrunItems) {
        const matched = new Set<TcItem>();

        for (const spec of run.specs) {
            const ruleName = spec.ruleName?.trim();
            const scName = spec.scenarioName?.trim();

            if (ruleName) {
                // Filter testcases by rule (feature file or directory)
                const normRule = ruleName.replace(/\\/g, '/').toLowerCase();
                const candidates = testcaseItems.filter(tc => {
                    const normUri = tc.uri.replace(/\\/g, '/').toLowerCase();
                    const baseUri = basename(normUri);
                    const baseRule = basename(normRule);
                    return (
                        normUri.endsWith(`/${normRule}`) ||
                        normUri.endsWith(normRule) ||
                        normUri.includes(normRule) ||
                        baseUri === baseRule ||
                        baseUri.replace(/(\.case)?\.feature$/i, '') === baseRule.replace(/(\.case)?\.feature$/i, '')
                    );
                });

                if (!scName || scName === '*') {
                    for (const c of candidates) matched.add(c);
                } else {
                    const lowerSc = scName.toLowerCase();
                    const cleanScTag = lowerSc.replace(/^@/, '');
                    for (const c of candidates) {
                        const lowerName = c.name.toLowerCase();
                        const cTag = (c.identityTag || '').toLowerCase().replace(/^@/, '');
                        const tags = c.tags.map(t => t.toLowerCase().replace(/^@/, ''));
                        const cTarget = c.identityTag ? `${c.uri}.${c.identityTag}` : `${c.uri}.${c.name}`;
                        if (
                            lowerName === lowerSc ||
                            lowerName.includes(lowerSc) ||
                            cTag === cleanScTag ||
                            tags.includes(cleanScTag) ||
                            matchesTarget(cTarget, scName, 'testcase') ||
                            matchesTarget(c.uri, scName, 'testcase')
                        ) {
                            matched.add(c);
                        }
                    }
                }
            } else if (scName && scName !== '*') {
                const lowerSc = scName.toLowerCase();
                const cleanScTag = lowerSc.replace(/^@/, '');
                for (const tc of testcaseItems) {
                    const lowerName = tc.name.toLowerCase();
                    const cTag = (tc.identityTag || '').toLowerCase().replace(/^@/, '');
                    const tags = tc.tags.map(t => t.toLowerCase().replace(/^@/, ''));
                    const tcTarget = tc.identityTag ? `${tc.uri}.${tc.identityTag}` : `${tc.uri}.${tc.name}`;
                    if (
                        lowerName === lowerSc ||
                        lowerName.includes(lowerSc) ||
                        cTag === cleanScTag ||
                        tags.includes(cleanScTag) ||
                        matchesTarget(tcTarget, scName, 'testcase') ||
                        matchesTarget(tc.uri, scName, 'testcase')
                    ) {
                        matched.add(tc);
                    }
                }
            }
        }

        run.matchedTestcases = Array.from(matched);
    }

    // ─── Match Testplans -> Testruns ─────────────────────────────────────────
    for (const plan of testplanItems) {
        const matched = new Set<RunItem>();

        for (const trSel of plan.testrunSelectors) {
            const found = testrunItems.find(r => {
                const runRes = {
                    identity: r.identityTag ? `${r.uri}.${r.identityTag}` : r.uri,
                    attributes: {
                        title: r.name,
                        tags: r.tags,
                        uri: r.uri
                    }
                };
                return (
                    matchesTestrunSelector(runRes, trSel) ||
                    addressesMatch(r.name, trSel) ||
                    r.uri.endsWith(trSel) ||
                    basename(r.uri).toLowerCase() === basename(trSel).toLowerCase()
                );
            });

            if (found) {
                matched.add(found);
                found.linkedToPlan = true;
            }
        }

        plan.matchedTestruns = Array.from(matched);
    }

    // Helper to get dependencies for a testcase
    function getTcDependencies(tc: ParserScenario): string[] {
        const tcTags = ((tc.tags || []) as any[]).map(t => typeof t === 'string' ? t : (t?.name || ''));
        const keysToCheck = [
            tc.name,
            `${tc.uri}.${tc.name}`,
            tc.custom?.identity,
            ...tcTags.map(t => `${tc.uri}.${t}`),
            ...tcTags.map(t => `${tc.uri}.@${t.replace(/^@/, '')}`),
            ...tcTags
        ].filter(Boolean) as string[];

        const allDeps = new Set<string>();
        for (const key of keysToCheck) {
            const deps = depResolver.getDependencies(key, tcTags);
            for (const d of deps) allDeps.add(d);
        }
        return Array.from(allDeps);
    }

    function findMatchingTcNode(dep: string): string {
        const norm = normalizeAddress(dep);
        for (const tc of testcaseItems) {
            const tcKey = tc.identityTag || `${tc.uri}.${tc.name}`;
            const tagAddresses = tc.tags.map(t => normalizeAddress(`${tc.uri}.${t}`));

            if (
                addressesMatch(tcKey, dep) ||
                addressesMatch(tc.name, dep) ||
                addressesMatch(tc.uri, dep) ||
                tagAddresses.some(ta => addressesMatch(ta, dep)) ||
                norm.endsWith(normalizeAddress(tc.name)) ||
                norm.endsWith(normalizeAddress(tcKey))
            ) {
                return `testcase.${tc.name}`;
            }
        }
        return `testcase.${dep}`;
    }

    const normFormat = (format || 'dot').toLowerCase();

    // ─── Tree Format (Terminal representation) ───────────────────────────────
    if (normFormat === 'tree') {
        renderTreeGraph({
            testplans: testplanItems,
            testruns: testrunItems,
            testcases: testcaseItems,
            scope,
            drawCycles,
            getTcDependencies
        });
        return;
    }

    // ─── Graph Model Generation (DOT / Mermaid) ──────────────────────────────
    // Hierarchy: testplan -> testrun -> testcase
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const typeSuffix = type ? ` (${type})` : '';

    const addTestCaseWithDeps = (tc: TcItem, parentRunId?: string) => {
        if (!nodes.has(tc.id)) {
            nodes.set(tc.id, { id: tc.id, label: `${tc.name}${typeSuffix}`, kind: 'testcase' });
        }
        if (parentRunId) {
            edges.push({ from: parentRunId, to: tc.id, kind: 'contains' });
            tc.linkedToRun = true;
        }

        const deps = getTcDependencies(tc.scenario);
        for (const dep of deps) {
            const depNodeId = findMatchingTcNode(dep);
            if (!nodes.has(depNodeId)) {
                nodes.set(depNodeId, { id: depNodeId, label: `${dep}${typeSuffix}`, kind: 'testcase' });
            }
            edges.push({ from: depNodeId, to: tc.id, kind: 'depends_on', label: 'depends_on' });
        }
    };

    const addTestRunWithCases = (run: RunItem, parentPlanId?: string) => {
        if (!nodes.has(run.id)) {
            nodes.set(run.id, { id: run.id, label: `${run.name}${typeSuffix}`, kind: 'testrun' });
        }
        if (parentPlanId) {
            edges.push({ from: parentPlanId, to: run.id, kind: 'contains' });
            run.linkedToPlan = true;
        }

        if (scope !== 'testplan') {
            for (const tc of run.matchedTestcases) {
                addTestCaseWithDeps(tc, run.id);
            }
        }
    };

    // 1. Process all Testplans (testplan -> testrun -> testcase)
    if (scope === 'testplan' || scope === 'testcase') {
        for (const plan of testplanItems) {
            if (!nodes.has(plan.id)) {
                nodes.set(plan.id, { id: plan.id, label: `${plan.name}${typeSuffix}`, kind: 'testplan' });
            }

            for (const run of plan.matchedTestruns) {
                addTestRunWithCases(run, plan.id);
            }
        }

        // 2. Orphaned Testruns (not attached to any testplan)
        const orphanedRuns = testrunItems.filter(r => !r.linkedToPlan);
        for (const run of orphanedRuns) {
            addTestRunWithCases(run);
        }

        // 3. Orphaned Testcases (not attached to any testrun)
        if (scope !== 'testplan') {
            const orphanedCases = testcaseItems.filter(tc => !tc.linkedToRun);
            for (const tc of orphanedCases) {
                addTestCaseWithDeps(tc);
            }
        }
    } else if (scope === 'testrun') {
        for (const run of testrunItems) {
            addTestRunWithCases(run);
        }
    }

    const cycleEdges = findCycleEdges(edges);

    if (normFormat === 'mermaid') {
        renderMermaidGraph({ nodes: Array.from(nodes.values()), edges, cycleEdges, drawCycles });
    } else {
        renderDotGraph({ nodes: Array.from(nodes.values()), edges, cycleEdges, drawCycles });
    }
};

/**
 * Renders Graphviz DOT format compatible with Terraform graph.
 */
function renderDotGraph(params: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    cycleEdges: Set<string>;
    drawCycles: boolean;
}): void {
    const { nodes, edges, cycleEdges, drawCycles } = params;
    const lines: string[] = [];

    lines.push('digraph G {');
    lines.push('  compound = "true";');
    lines.push('  newrank = "true";');
    lines.push('  subgraph "root" {');

    for (const node of nodes) {
        const rootId = `[root] ${node.id}`;
        lines.push(`    "${escapeDot(rootId)}" [label = "${escapeDot(node.label)}", shape = "box"];`);
    }

    for (const edge of edges) {
        const fromId = `[root] ${edge.from}`;
        const toId = `[root] ${edge.to}`;
        const edgeKey = `${edge.from}->${edge.to}`;
        const isCycle = cycleEdges.has(edgeKey);

        if (isCycle && drawCycles) {
            lines.push(`    "${escapeDot(fromId)}" -> "${escapeDot(toId)}" [color = "red", penwidth = 2.0];`);
        } else if (edge.label) {
            lines.push(`    "${escapeDot(fromId)}" -> "${escapeDot(toId)}" [label = "${escapeDot(edge.label)}"];`);
        } else {
            lines.push(`    "${escapeDot(fromId)}" -> "${escapeDot(toId)}";`);
        }
    }

    lines.push('  }');
    lines.push('}');

    console.log(lines.join('\n'));
}

/**
 * Renders Mermaid diagram format.
 */
function renderMermaidGraph(params: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    cycleEdges: Set<string>;
    drawCycles: boolean;
}): void {
    const { nodes, edges, cycleEdges, drawCycles } = params;
    const lines: string[] = [];

    lines.push('graph TD');
    lines.push('  subgraph root');

    for (const node of nodes) {
        const mId = toMermaidId(node.id);
        const icon = node.kind === 'testplan' ? '📦 ' : node.kind === 'testrun' ? '📂 ' : '📄 ';
        lines.push(`    ${mId}["${icon}${escapeMermaidLabel(node.label)} (${node.kind})"]`);
    }

    for (const edge of edges) {
        const fromId = toMermaidId(edge.from);
        const toId = toMermaidId(edge.to);
        const edgeKey = `${edge.from}->${edge.to}`;
        const isCycle = cycleEdges.has(edgeKey);

        if (isCycle && drawCycles) {
            lines.push(`    ${fromId} -.->|cycle| ${toId}`);
            lines.push(`    style ${fromId} stroke:#ff0000,stroke-width:2px;`);
            lines.push(`    style ${toId} stroke:#ff0000,stroke-width:2px;`);
        } else if (edge.label) {
            lines.push(`    ${fromId} -->|${edge.label}| ${toId}`);
        } else {
            lines.push(`    ${fromId} --> ${toId}`);
        }
    }

    lines.push('  end');

    console.log(lines.join('\n'));
}

/**
 * Renders terminal ASCII/Unicode tree representation.
 */
function renderTreeGraph(params: {
    testplans: PlanItem[];
    testruns: RunItem[];
    testcases: TcItem[];
    scope: IScope;
    drawCycles: boolean;
    getTcDependencies: (tc: ParserScenario) => string[];
}): void {
    const { testplans, testruns, testcases, scope, drawCycles, getTcDependencies } = params;

    console.log(bold('Test Infrastructure Graph\n'));
    const link = (str: string) => drawCycles ? magenta(str) : str;

    if (scope === 'testplan' || scope === 'testcase') {
        // 1. Hierarchy from Testplans
        for (const plan of testplans) {
            console.log(`📦 ${cyan(bold(plan.name))} ${dim(`(testplan)`)}`);

            const runs = plan.matchedTestruns;
            if (runs.length === 0 && plan.testrunSelectors.length > 0) {
                for (const sel of plan.testrunSelectors) {
                    console.log(`   └── 📂 ${dim(sel + ' (Not found)')}`);
                }
            } else {
                for (let i = 0; i < runs.length; i++) {
                    const run = runs[i];
                    const isLastRun = i === runs.length - 1;
                    const runPrefix = isLastRun ? '└── ' : '├── ';
                    console.log(`   ${link(runPrefix)}📂 ${green(run.name)} ${dim(`(testrun)`)}`);

                    if (scope === 'testcase') {
                        const tcs = run.matchedTestcases;
                        const runIndent = isLastRun ? '    ' : '│   ';

                        for (let j = 0; j < tcs.length; j++) {
                            const tc = tcs[j];
                            const isLastTc = j === tcs.length - 1;
                            const tcPrefix = isLastTc ? '└── ' : '├── ';
                            console.log(`   ${runIndent}${link(tcPrefix)}📄 ${tc.name} ${dim(`(testcase)`)}`);

                            const deps = getTcDependencies(tc.scenario);
                            if (deps.length > 0) {
                                const depIndent = isLastTc ? '    ' : '│   ';
                                console.log(`   ${runIndent}${depIndent}└── 🔗 ${cyan('depends_on:')} ${dim(deps.join(', '))}`);
                            }
                        }
                    }
                }
            }
            console.log('');
        }

        // 2. Orphaned Test Runs
        const orphanedRuns = testruns.filter(r => !r.linkedToPlan);
        if (orphanedRuns.length > 0) {
            console.log(bold('Orphaned Test Runs (Not linked to any testplan)\n'));
            for (const run of orphanedRuns) {
                console.log(`📂 ${green(bold(run.name))} ${dim(`(testrun)`)}`);

                if (scope === 'testcase') {
                    const tcs = run.matchedTestcases;
                    for (let j = 0; j < tcs.length; j++) {
                        const tc = tcs[j];
                        const isLastTc = j === tcs.length - 1;
                        const tcPrefix = isLastTc ? '└── ' : '├── ';
                        console.log(`   ${link(tcPrefix)}📄 ${tc.name} ${dim(`(testcase)`)}`);

                        const deps = getTcDependencies(tc.scenario);
                        if (deps.length > 0) {
                            const depIndent = isLastTc ? '    ' : '│   ';
                            console.log(`   ${depIndent}└── 🔗 ${cyan('depends_on:')} ${dim(deps.join(', '))}`);
                        }
                    }
                }
                console.log('');
            }
        }

        // 3. Orphaned Testcases
        if (scope === 'testcase') {
            const orphanedCases = testcases.filter(tc => !tc.linkedToRun);
            if (orphanedCases.length > 0) {
                console.log(bold('Orphaned Test Cases (Not linked to any testrun)\n'));
                for (const tc of orphanedCases) {
                    console.log(`📄 ${tc.name} ${dim(`(testcase)`)}`);
                    const deps = getTcDependencies(tc.scenario);
                    if (deps.length > 0) {
                        console.log(`   └── 🔗 ${cyan('depends_on:')} ${dim(deps.join(', '))}`);
                    }
                }
                console.log('');
            }
        }
    } else if (scope === 'testrun') {
        for (const run of testruns) {
            console.log(`📂 ${green(bold(run.name))} ${dim(`(testrun)`)}`);
            const tcs = run.matchedTestcases;
            for (let j = 0; j < tcs.length; j++) {
                const tc = tcs[j];
                const isLastTc = j === tcs.length - 1;
                const tcPrefix = isLastTc ? '└── ' : '├── ';
                console.log(`   ${link(tcPrefix)}📄 ${tc.name} ${dim(`(testcase)`)}`);
            }
            console.log('');
        }
    }
}
