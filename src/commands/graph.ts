import { bold, cyan, dim, green, magenta } from 'chalk';
import { Parser } from '../core/parser';
import { IScope, ParserScenario } from '../core/types';
import { VariableParser } from '../core/variables';
import { DependencyResolver } from '../core/dependencies';
import { normalizeAddress, addressesMatch } from '../core/utils';

export interface GraphCmdOptions {
    dir?: string;
    scope?: IScope;
    drawCycles?: boolean;
    variables?: VariableParser;
    format?: 'dot' | 'mermaid' | 'tree' | string;
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

    const visited = new Map<string, number>(); // 0: unvisited, 1: visiting (in stack), 2: finished
    const cycleEdges = new Set<string>();

    function dfs(u: string, path: string[]) {
        visited.set(u, 1);
        path.push(u);

        for (const v of adj.get(u) || []) {
            const state = visited.get(v) || 0;
            if (state === 1) {
                // Back-edge found! u -> v forms a cycle
                cycleEdges.add(`${u}->${v}`);
                // All edges on the path from v to u are also part of the cycle
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

    const testcases = scenarios.filter(s => !s.uri.endsWith('.run.feature') && !s.uri.endsWith('.plan.feature'));
    const testrunsAll = scenarios.filter(s => s.uri.endsWith('.run.feature'));
    const testplansAll = scenarios.filter(s => s.uri.endsWith('.plan.feature'));

    // Group testplans by URI
    const testplansMap = new Map<string, { name: string, testruns: string[] }>();
    for (const p of testplansAll) {
        if (!testplansMap.has(p.uri)) {
            testplansMap.set(p.uri, { name: p.feature?.name || 'Unnamed Plan', testruns: [] });
        }
        if (p.rule?.name) testplansMap.get(p.uri)!.testruns.push(p.rule.name);
    }
    const testplans = Array.from(testplansMap.values());

    // Group testruns by URI
    const testrunsMap = new Map<string, { name: string, testcases: string[], identity: string, uri: string }>();
    for (const r of testrunsAll) {
        if (!testrunsMap.has(r.uri)) {
            testrunsMap.set(r.uri, { name: r.feature?.name || 'Unnamed Run', testcases: [], identity: r.custom?.identity || r.feature?.name || '', uri: r.uri });
        }
        if (r.rule?.name) testrunsMap.get(r.uri)!.testcases.push(r.rule.name);
        else if (r.name) testrunsMap.get(r.uri)!.testcases.push(`${r.feature?.name}.${r.name}`);
    }
    const testruns = Array.from(testrunsMap.values());

    if (testplans.length === 0 && testruns.length === 0 && testcases.length === 0) {
        console.log('No test configurations found.');
        return;
    }

    function findTcs(tcId: string) {
        let scenarioName = '*';
        let ruleName = tcId;
        if (tcId.includes('.feature.')) {
            const idx = tcId.indexOf('.feature.');
            ruleName = tcId.substring(0, idx + 8);
            scenarioName = tcId.substring(idx + 9);
        } else if (tcId.endsWith('.feature')) {
            ruleName = tcId;
            scenarioName = '*';
        } else if (tcId.includes('.')) {
            const parts = tcId.split('.');
            scenarioName = parts.pop() || '*';
            ruleName = parts.join('.');
        }
        const matches = testcases.filter(r => {
            const matchesFile = !ruleName || r.uri.endsWith(ruleName) || r.uri.includes(ruleName);
            const matchesScenario = scenarioName === '*' || r.name === scenarioName || r.name.includes(scenarioName) || r.custom?.identity === scenarioName;
            return matchesFile && matchesScenario;
        });

        // Detect duplicates
        const uris = Array.from(new Set(matches.map(tc => tc.uri)));
        if (uris.length > 1) {
            if (scenarioName !== '*') {
                const { logger } = require('../core/logger');
                logger.error(`Ambiguous reference for Scenario '${scenarioName}' under Rule '${ruleName}'. It matches multiple files:\n` + uris.map(u => `  - ${u}`).join('\n') + `\nPlease specify the full file path in your Rule to disambiguate.`);
            } else {
                const { logger } = require('../core/logger');
                logger.warn(`Rule '${ruleName}' matches multiple feature files. Processing all of them:\n` + uris.map(u => `  - ${u}`).join('\n') + `\nIf this was unintentional, specify the full file path.`);
            }
        }
        return matches;
    }

    function findMatchingTcNode(dep: string): string {
        const norm = normalizeAddress(dep);
        for (const tc of testcases) {
            const tcKey = tc.custom?.identity || `${tc.uri}.${tc.name}`;
            const tcTags = tc.tags ? tc.tags.map(t => typeof t === 'string' ? t : (t as any).name) : [];
            const tagAddresses = tcTags.map(t => normalizeAddress(`${tc.uri}.${t}`));

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

    function getTcDependencies(tc: ParserScenario): string[] {
        const tcTags = tc.tags ? tc.tags.map(t => typeof t === 'string' ? t : (t as any).name) : [];
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

    // If tree format is explicitly requested, render terminal ASCII tree
    if (format === 'tree') {
        renderTreeGraph({ testplans, testruns, testcases, scope, drawCycles, depResolver, findTcs, getTcDependencies });
        return;
    }

    // Build model of nodes and edges for structured graph output (DOT / Mermaid)
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    const typeSuffix = type ? ` (${type})` : '';

    if (scope === 'testplan' || scope === 'testcase') {
        for (const plan of testplans) {
            const planId = `testplan.${plan.name}`;
            nodes.set(planId, { id: planId, label: `${plan.name}${typeSuffix}`, kind: 'testplan' });

            for (const trId of plan.testruns) {
                const normTrId = normalizeAddress(trId);
                const run = testruns.find(r =>
                    addressesMatch(r.identity, trId) ||
                    r.name === trId ||
                    r.name.endsWith(trId) ||
                    trId.endsWith(r.name) ||
                    normalizeAddress(r.uri).endsWith(normTrId)
                );

                if (run) {
                    const runId = `testrun.${run.name}`;
                    nodes.set(runId, { id: runId, label: `${run.name}${typeSuffix}`, kind: 'testrun' });
                    edges.push({ from: planId, to: runId, kind: 'contains' });

                    if (scope !== 'testplan') {
                        for (const tcId of run.testcases) {
                            const tcs = findTcs(tcId);
                            for (const tc of tcs) {
                                const tcIdNode = `testcase.${tc.name}`;
                                nodes.set(tcIdNode, { id: tcIdNode, label: `${tc.name}${typeSuffix}`, kind: 'testcase' });
                                edges.push({ from: runId, to: tcIdNode, kind: 'contains' });

                                const deps = getTcDependencies(tc);
                                for (const dep of deps) {
                                    const depNodeId = findMatchingTcNode(dep);
                                    if (!nodes.has(depNodeId)) {
                                        nodes.set(depNodeId, { id: depNodeId, label: `${dep}${typeSuffix}`, kind: 'testcase' });
                                    }
                                    edges.push({ from: depNodeId, to: tcIdNode, kind: 'depends_on', label: 'depends_on' });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Orphaned test runs when scope includes testcases
        if (scope !== 'testplan') {
            const referencedRuns = new Set(testplans.flatMap(p => p.testruns || []));
            const orphanedRuns = testruns.filter(r => {
                return !Array.from(referencedRuns).some(ref =>
                    addressesMatch(r.identity, ref) ||
                    r.name === ref ||
                    normalizeAddress(r.uri).endsWith(normalizeAddress(ref)) ||
                    ref.endsWith(r.name)
                );
            });

            for (const run of orphanedRuns) {
                const runId = `testrun.${run.name}`;
                nodes.set(runId, { id: runId, label: `${run.name}${typeSuffix}`, kind: 'testrun' });
                for (const tcId of run.testcases) {
                    const tcs = findTcs(tcId);
                    for (const tc of tcs) {
                        const tcIdNode = `testcase.${tc.name}`;
                        nodes.set(tcIdNode, { id: tcIdNode, label: `${tc.name}${typeSuffix}`, kind: 'testcase' });
                        edges.push({ from: runId, to: tcIdNode, kind: 'contains' });

                        const deps = getTcDependencies(tc);
                        for (const dep of deps) {
                            const depNodeId = findMatchingTcNode(dep);
                            if (!nodes.has(depNodeId)) {
                                nodes.set(depNodeId, { id: depNodeId, label: `${dep}${typeSuffix}`, kind: 'testcase' });
                            }
                            edges.push({ from: depNodeId, to: tcIdNode, kind: 'depends_on', label: 'depends_on' });
                        }
                    }
                }
            }
        }
    } else if (scope === 'testrun') {
        for (const run of testruns) {
            const runId = `testrun.${run.name}`;
            nodes.set(runId, { id: runId, label: `${run.name}${typeSuffix}`, kind: 'testrun' });
            for (const tcId of run.testcases) {
                const tcs = findTcs(tcId);
                for (const tc of tcs) {
                    const tcIdNode = `testcase.${tc.name}`;
                    nodes.set(tcIdNode, { id: tcIdNode, label: `${tc.name}${typeSuffix}`, kind: 'testcase' });
                    edges.push({ from: runId, to: tcIdNode, kind: 'contains' });

                    const deps = getTcDependencies(tc);
                    for (const dep of deps) {
                        const depNodeId = findMatchingTcNode(dep);
                        if (!nodes.has(depNodeId)) {
                            nodes.set(depNodeId, { id: depNodeId, label: `${dep}${typeSuffix}`, kind: 'testcase' });
                        }
                        edges.push({ from: depNodeId, to: tcIdNode, kind: 'depends_on', label: 'depends_on' });
                    }
                }
            }
        }
    }

    // Detect cycle edges for highlighting
    const cycleEdges = findCycleEdges(edges);

    if (format === 'mermaid') {
        renderMermaidGraph({ nodes: Array.from(nodes.values()), edges, cycleEdges, drawCycles });
    } else {
        // Default: DOT (Graphviz)
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
    testplans: Array<{ name: string; testruns: string[] }>;
    testruns: Array<{ name: string; testcases: string[]; identity: string; uri: string }>;
    testcases: ParserScenario[];
    scope: IScope;
    drawCycles: boolean;
    depResolver: DependencyResolver;
    findTcs: (tcId: string) => ParserScenario[];
    getTcDependencies: (tc: ParserScenario) => string[];
}): void {
    const { testplans, testruns, scope, drawCycles, depResolver, findTcs, getTcDependencies } = params;

    console.log(bold('Test Infrastructure Graph\n'));

    const link = (str: string) => drawCycles ? magenta(str) : str;

    if (scope === 'testplan' || scope === 'testcase') {
        for (const plan of testplans) {
            const planName = plan.name;
            console.log(`📦 ${cyan(bold(planName))} ${dim(`(testplan)`)}`);

            const trIds = plan.testruns;
            for (const [i, trId] of trIds.entries()) {
                const isLastRun = i === trIds.length - 1;
                const runPrefix = isLastRun ? '└── ' : '├── ';

                const normTrId = normalizeAddress(trId);
                const run = testruns.find(r =>
                    addressesMatch(r.identity, trId) ||
                    r.name === trId ||
                    r.name.endsWith(trId) ||
                    trId.endsWith(r.name) ||
                    normalizeAddress(r.uri).endsWith(normTrId)
                );

                if (run) {
                    const runName = run.name;
                    console.log(`   ${link(runPrefix)}📂 ${green(runName)} ${dim(`(testrun)`)}`);

                    if (scope === 'testcase') {
                        const tcIds = run.testcases;
                        for (let j = 0; j < tcIds.length; j++) {
                            const tcId = tcIds.at(j)!;
                            const isLastTc = j === tcIds.length - 1;
                            const tcPrefix = isLastRun ? '    ' : '│   ';

                            const tcs = findTcs(tcId);

                            if (tcs.length > 0) {
                                for (let k = 0; k < tcs.length; k++) {
                                    const tc = tcs.at(k)!;
                                    const tcIsLast = isLastTc && k === tcs.length - 1;
                                    const tcFinalConnector = tcIsLast ? '└── ' : '├── ';
                                    console.log(`   ${tcPrefix}${link(tcFinalConnector)}📄 ${tc.name} ${dim(`(testcase)`)}`);

                                    const deps = getTcDependencies(tc);
                                    if (deps.length > 0) {
                                        const depPrefix = tcIsLast ? '       ' : '│      ';
                                        console.log(`   ${tcPrefix}${depPrefix}└── 🔗 ${cyan('depends_on:')} ${dim(deps.join(', '))}`);
                                    }
                                }
                            } else {
                                const tcConnector = isLastTc ? '└── ' : '├── ';
                                console.log(`   ${tcPrefix}${link(tcConnector)}📄 ${dim(tcId + ' (Not found)')}`);
                            }
                        }
                    }
                } else {
                    console.log(`   ${link(runPrefix)}📂 ${dim(trId + ' (Not found)')}`);
                }
            }
            console.log('');
        }

        if (scope === 'testcase') {
            const referencedRuns = new Set(testplans.flatMap(p => p.testruns || []));
            const orphanedRuns = testruns.filter(r => {
                return !Array.from(referencedRuns).some(ref =>
                    addressesMatch(r.identity, ref) ||
                    r.name === ref ||
                    normalizeAddress(r.uri).endsWith(normalizeAddress(ref)) ||
                    ref.endsWith(r.name)
                );
            });

            if (orphanedRuns.length > 0) {
                console.log(bold('Orphaned Test Runs (Not linked to any testplan)\n'));
                for (const run of orphanedRuns) {
                    const runName = run.name;
                    console.log(`📂 ${green(runName)} ${dim(`(testrun)`)}`);
                    const tcIds = run.testcases;
                    for (let j = 0; j < tcIds.length; j++) {
                        const tcId = tcIds.at(j)!;
                        const isLastTc = j === tcIds.length - 1;

                        const tcs = findTcs(tcId);
                        if (tcs.length > 0) {
                            for (let k = 0; k < tcs.length; k++) {
                                const tc = tcs.at(k)!;
                                const tcIsLast = isLastTc && k === tcs.length - 1;
                                const tcFinalConnector = tcIsLast ? '└── ' : '├── ';
                                console.log(`   ${link(tcFinalConnector)}📄 ${tc.name} ${dim(`(testcase)`)}`);

                                const deps = getTcDependencies(tc);
                                if (deps.length > 0) {
                                    const depPrefix = tcIsLast ? '       ' : '│      ';
                                    console.log(`   ${depPrefix}└── 🔗 ${cyan('depends_on:')} ${dim(deps.join(', '))}`);
                                }
                            }
                        } else {
                            const tcConnector = isLastTc ? '└── ' : '├── ';
                            console.log(`   ${link(tcConnector)}📄 ${tcId}`);
                        }
                    }
                    console.log('');
                }
            }
        }
    } else if (scope === 'testrun') {
        for (const run of testruns) {
            const runName = run.name;
            console.log(`📂 ${green(bold(runName))} ${dim(`(testrun)`)}`);
            const tcIds = run.testcases;
            for (let j = 0; j < tcIds.length; j++) {
                const tcId = tcIds.at(j)!;
                const isLastTc = j === tcIds.length - 1;

                const tcs = findTcs(tcId);
                if (tcs.length > 0) {
                    for (let k = 0; k < tcs.length; k++) {
                        const tc = tcs.at(k)!;
                        const tcIsLast = isLastTc && k === tcs.length - 1;
                        const tcFinalConnector = tcIsLast ? '└── ' : '├── ';
                        console.log(`   ${link(tcFinalConnector)}📄 ${tc.name} ${dim(`(testcase)`)}`);
                    }
                } else {
                    const tcConnector = isLastTc ? '└── ' : '├── ';
                    console.log(`   ${link(tcConnector)}📄 ${dim(tcId + ' (Not found)')}`);
                }
            }
            console.log('');
        }
    }
}
