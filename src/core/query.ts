import { State } from './state';
import { StateResource, IScope, ParserScenario } from './types';
import { resolvePath, normalizeAddress } from './utils';
import { matchesTarget, detectScopeFromTarget, matchesScope, computeResourceIdentity, detectCollidingBasenames, normalizeScenarioAddress } from './selector';
import { Config } from './config';
import { Parser } from './parser';
import { VariableParser } from './variables';

export interface QueryResultItem {
    id: string;
    type: string;
    canonicalScope: string;
    title: string;
    status: string;
    issueNumber?: number;
    remoteId?: string;
    labels: string[];
    assignees: string[];
    milestone?: string;
    testRunId?: string;
    testPlanId?: string;
    custom_fields: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
    lastApplied?: string;
    tainted?: boolean;
    originalResource?: StateResource;
    defects?: string[];
}

export interface ReportStats {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    blocked: number;
    skipped: number;
    undefined: number;
    ambiguous: number;
    unexecuted: number;
    totalRuns: number;
    activeRuns: number;
    closedRuns: number;
    totalPlans: number;
}

export interface StateQueryOptions {
    source?: 'state' | 'files' | 'simulation';
    fromFiles?: boolean;
    variables?: VariableParser;
}

export function resolveItemFieldValue(item: QueryResultItem, field: string): string {
    const lower = (field || '').trim().toLowerCase();
    if (!lower || lower === 'status') return item.status;
    if (lower === 'priority') {
        let p = item.custom_fields['priority'] || resolvePath(item.originalResource, 'attributes.custom_fields.priority') || 'Medium';
        if (p.startsWith('@')) p = p.slice(1);
        return p.charAt(0).toUpperCase() + p.slice(1);
    }
    if (lower === 'module' || lower === 'component') {
        const raw = item.custom_fields['module'] || item.custom_fields['component'] || resolvePath(item.originalResource, 'attributes.custom_fields.module');
        if (raw) return String(raw);
        if (item.id.includes('/')) return item.id.split('/')[0];
        return 'General';
    }
    if (lower === 'squad' || lower === 'squad (chap)' || lower === 'squad_chap') {
        return item.custom_fields['squad'] || item.custom_fields['squad (chap)'] || item.custom_fields['squad_chap'] || 'General';
    }
    if (lower === 'sprint' || lower === 'sprint (personalizado)') {
        return item.custom_fields['sprint'] || item.custom_fields['sprint (personalizado)'] || item.milestone || 'Backlog';
    }
    if (lower === 'quarter' || lower === 'quarter (chap)') {
        return item.custom_fields['quarter'] || item.custom_fields['quarter (chap)'] || '-';
    }
    if (lower === 'assignee' || lower === 'assignees') {
        return item.assignees[0] || 'Unassigned';
    }
    if (lower === 'testrun' || lower === 'testrunid' || lower === 'cycle') {
        return item.testRunId || 'None';
    }
    if (lower === 'feature' || lower === 'requirement') {
        return item.id.includes('.') ? item.id.slice(0, item.id.lastIndexOf('.')) : item.id;
    }
    if (lower === 'label' || lower === 'tag' || lower === 'labels' || lower === 'tags') {
        return item.labels[0] || 'untagged';
    }
    if (lower === 'automate' || lower === 'automation') {
        return item.custom_fields['automate'] || item.custom_fields['automation'] || 'No';
    }
    return item.custom_fields[lower]
        || String(resolvePath(item.originalResource, lower) ?? resolvePath(item.originalResource, `attributes.${lower}`) ?? '-');
}

export class StateQuery {
    private stateObj: State;
    private initialized = false;
    private allResources: StateResource[] = [];
    private normalizedItems: QueryResultItem[] = [];

    public isStateVerified: boolean = true;
    public dataSource: 'state' | 'files' | 'simulation' = 'state';
    public signature?: string;
    private options: StateQueryOptions;

    constructor(
        private dir: string = '.',
        private statePath?: string,
        private backupPath?: string,
        options?: StateQueryOptions
    ) {
        this.options = options || {};
        if (this.options.fromFiles || this.options.source === 'files' || this.options.source === 'simulation') {
            this.dataSource = this.options.source === 'simulation' ? 'simulation' : 'files';
            this.isStateVerified = false;
            this.signature = '⚠️ SIMULACIÓN / DRY-RUN (DATA NO CONSOLIDADA EN STATE - REGLA: DEBE ESTAR EN STATE)';
        }
        this.stateObj = new State(this.dir, this.statePath, this.backupPath);
    }

    public async init(): Promise<void> {
        if (this.initialized) return;

        // Mode B: Direct filesystem scanning (simulation mode)
        if (!this.isStateVerified || this.options.fromFiles || this.options.source === 'files' || this.options.source === 'simulation') {
            await this.loadFromFilesystem();
            this.initialized = true;
            return;
        }

        // Mode A: Official consolidated testform.state
        try {
            await this.stateObj.init();
            const st = this.stateObj.getState ? this.stateObj.getState() : null;
            if (st && Array.isArray(st.resources)) {
                this.allResources = st.resources;
            } else if (typeof this.stateObj.getResources === 'function') {
                const list = [
                    ...(this.stateObj.getResources('github_testcase') || []),
                    ...(this.stateObj.getResources('testcase') || []),
                    ...(this.stateObj.getResources('github_testrun') || []),
                    ...(this.stateObj.getResources('testrun') || []),
                    ...(this.stateObj.getResources('github_testplan') || []),
                    ...(this.stateObj.getResources('testplan') || []),
                    ...(this.stateObj.getResources('github_bug') || []),
                    ...(this.stateObj.getResources('bug') || []),
                    ...(this.stateObj.getResources() || [])
                ];
                const seen = new Set<string>();
                this.allResources = list.filter(r => {
                    const addr = r?.address || (r as any)?.identity;
                    if (!r || !addr || seen.has(addr)) return false;
                    seen.add(addr);
                    return true;
                });
            }
            this.normalize();
            this.isStateVerified = true;
            this.dataSource = 'state';
            this.signature = undefined;
            this.initialized = true;
        } catch (err) {
            throw err;
        }
    }

    private async loadFromFilesystem(): Promise<void> {
        this.isStateVerified = false;
        this.dataSource = 'files';
        this.signature = '⚠️ SIMULACIÓN / DRY-RUN (DATA NO CONSOLIDADA EN STATE - REGLA: DEBE ESTAR EN STATE)';

        const config = new Config(this.dir, false);
        const parser = new Parser(this.dir, this.options.variables);
        const documents = parser.content();

        const scopes: IScope[] = ['testcase', 'testrun', 'testplan', 'bug'];
        const syntheticResources: StateResource[] = [];

        const testcaseScenarios: ParserScenario[] = [];
        const testrunScenarios: ParserScenario[] = [];
        const testplanScenarios: ParserScenario[] = [];
        const bugScenarios: ParserScenario[] = [];

        const scaffoldDir = typeof config.getConvention === 'function' ? config.getConvention('testcase')?.directory : undefined;
        const collidingBasenames = detectCollidingBasenames(documents, scaffoldDir);

        for (const scope of scopes) {
            const matchPattern = config.getMatch?.(scope);
            const matched = documents.filter(s => matchesScope(s, scope, matchPattern));
            if (matched.length === 0) continue;

            const data = {
                identity: config.getIdentity(scope),
                fields: config.getFields(scope)
            };

            const filtered = parser.filter(matched, data, scope) || [];

            if (scope === 'testcase') testcaseScenarios.push(...filtered);
            else if (scope === 'testrun') testrunScenarios.push(...filtered);
            else if (scope === 'testplan') testplanScenarios.push(...filtered);
            else if (scope === 'bug') bugScenarios.push(...filtered);
        }

        // 1. Synthesize Testcases from local .feature files
        for (const scenario of testcaseScenarios) {
            const idInfo = computeResourceIdentity(scenario, 'testcase', scaffoldDir, collidingBasenames);
            const address = idInfo?.address || (scenario.custom?.identity ? `${scenario.uri}.${scenario.custom.identity}` : scenario.uri);
            const customFields: Record<string, string> = { ...(scenario.custom?.fields || {}) };

            let status = customFields['status'] || 'unexecuted';
            if (scenario.description) {
                const match = scenario.description.match(/^\s*\*\s*set\s+status\s*=\s*(.*)$/im);
                if (match) status = match[1]?.trim() || status;
            }

            const rawTags = (scenario.tags || []).map(t => typeof t === 'string' ? t : (t as any).name);
            const assignees = customFields['assignee'] ? [customFields['assignee']] : (customFields['assignees'] ? [customFields['assignees']] : []);

            syntheticResources.push({
                type: 'testcase',
                address,
                path: scenario.uri,
                tag: idInfo?.tag,
                namespace: idInfo?.namespace,
                physicalAddress: idInfo?.physicalAddress || address,
                identity: scenario.custom?.identity,
                attributes: {
                    title: scenario.name || address,
                    status,
                    labels: rawTags,
                    assignees,
                    milestone: customFields['milestone'] || customFields['sprint'],
                    custom_fields: customFields,
                    localHash: '',
                    remoteId: `sim:${address}`,
                    issueNumber: 0
                } as any,
                lastApplied: new Date().toISOString()
            });
        }

        // 2. Synthesize Testruns from local .run.feature files
        for (const scenario of testrunScenarios) {
            const idInfo = computeResourceIdentity(scenario, 'testrun', scaffoldDir, collidingBasenames);
            const address = idInfo?.address || (scenario.custom?.identity ? `${scenario.uri}.${scenario.custom.identity}` : scenario.uri);
            const customFields: Record<string, string> = { ...(scenario.custom?.fields || {}) };

            const testcaseStatuses: Record<string, string> = {};
            if (Array.isArray(scenario.custom?.groupScenarios)) {
                for (const gs of scenario.custom.groupScenarios) {
                    const normAddr = normalizeScenarioAddress(gs.rule?.name, gs.name);
                    let st = 'unexecuted';
                    for (const step of gs.steps || []) {
                        const markMatch = step.text.match(/^\s*(?:mark|set)\s+status\s*=\s*(.*)$/i);
                        if (markMatch) {
                            st = markMatch[1].trim().toLowerCase();
                            break;
                        }
                    }
                    testcaseStatuses[normAddr] = st;
                }
            }

            const rawTags = (scenario.tags || []).map(t => typeof t === 'string' ? t : (t as any).name);
            const assignees = customFields['assignee'] ? [customFields['assignee']] : (customFields['assignees'] ? [customFields['assignees']] : []);

            syntheticResources.push({
                type: 'testrun',
                address,
                path: scenario.uri,
                tag: idInfo?.tag,
                namespace: idInfo?.namespace,
                physicalAddress: idInfo?.physicalAddress || address,
                identity: scenario.custom?.identity,
                attributes: {
                    title: scenario.name || address,
                    status: 'active',
                    state: 'open',
                    labels: rawTags,
                    assignees,
                    testcases: testcaseStatuses,
                    testcaseStatuses,
                    custom_fields: customFields,
                    localHash: '',
                    remoteId: `sim:${address}`,
                    issueNumber: 0
                } as any,
                lastApplied: new Date().toISOString()
            });
        }

        // 3. Synthesize Testplans from local .plan.feature files
        for (const scenario of testplanScenarios) {
            const idInfo = computeResourceIdentity(scenario, 'testplan', scaffoldDir, collidingBasenames);
            const address = idInfo?.address || (scenario.custom?.identity ? `${scenario.uri}.${scenario.custom.identity}` : scenario.uri);
            const customFields: Record<string, string> = { ...(scenario.custom?.fields || {}) };
            const rawTags = (scenario.tags || []).map(t => typeof t === 'string' ? t : (t as any).name);

            syntheticResources.push({
                type: 'testplan',
                address,
                path: scenario.uri,
                tag: idInfo?.tag,
                namespace: idInfo?.namespace,
                physicalAddress: idInfo?.physicalAddress || address,
                identity: scenario.custom?.identity,
                attributes: {
                    title: scenario.name || address,
                    status: 'active',
                    labels: rawTags,
                    testruns: scenario.custom?.testruns || [],
                    custom_fields: customFields,
                    localHash: '',
                    remoteId: `sim:${address}`,
                    issueNumber: 0
                } as any,
                lastApplied: new Date().toISOString()
            });
        }

        // 4. Synthesize Bugs from local .bug.feature files
        for (const scenario of bugScenarios) {
            const idInfo = computeResourceIdentity(scenario, 'bug', scaffoldDir, collidingBasenames);
            const address = idInfo?.address || (scenario.custom?.identity ? `${scenario.uri}.${scenario.custom.identity}` : scenario.uri);
            const customFields: Record<string, string> = { ...(scenario.custom?.fields || {}) };
            const rawTags = (scenario.tags || []).map(t => typeof t === 'string' ? t : (t as any).name);
            const assignees = customFields['assignee'] ? [customFields['assignee']] : (customFields['assignees'] ? [customFields['assignees']] : []);

            syntheticResources.push({
                type: 'bug',
                address,
                path: scenario.uri,
                tag: idInfo?.tag,
                namespace: idInfo?.namespace,
                physicalAddress: idInfo?.physicalAddress || address,
                identity: scenario.custom?.identity,
                attributes: {
                    title: scenario.name || address,
                    status: customFields['status'] || 'open',
                    severity: customFields['severity'] || 'major',
                    priority: customFields['priority'] || 'medium',
                    target: customFields['target'] || '',
                    labels: rawTags,
                    assignees,
                    custom_fields: customFields,
                    localHash: '',
                    remoteId: `sim:${address}`,
                    issueNumber: 0
                } as any,
                lastApplied: new Date().toISOString()
            });
        }

        this.allResources = syntheticResources;
        this.normalize();
    }

    public getResources(): StateResource[] {
        return this.allResources;
    }

    public getItems(): QueryResultItem[] {
        return this.normalizedItems;
    }

    private getCanonicalScope(type: string): string {
        if (type.includes('_')) return type.split('_').slice(1).join('_');
        return type;
    }

    private normalize(): void {
        const testruns = this.allResources.filter(r => this.getCanonicalScope(r.type) === 'testrun');
        const testcases = this.allResources.filter(r => this.getCanonicalScope(r.type) === 'testcase');
        const testplans = this.allResources.filter(r => this.getCanonicalScope(r.type) === 'testplan');
        const bugs = this.allResources.filter(r => this.getCanonicalScope(r.type) === 'bug');

        // Build defects map for testcases
        const tcDefectsMap = new Map<string, string[]>();
        for (const bug of bugs) {
            const target = String(bug.attributes.target || (bug.attributes as any).testcase || (bug.attributes as any).case || '');
            const bugLabel = `${bug.address || (bug as any).identity || 'Bug'} (${bug.attributes.title || 'Defecto'})`;
            if (target) {
                const normTarget = normalizeAddress(target);
                if (!tcDefectsMap.has(normTarget)) tcDefectsMap.set(normTarget, []);
                tcDefectsMap.get(normTarget)!.push(bugLabel);
            }
        }

        // Map status from testruns
        const executedTcMap = new Map<string, { status: string; testRunId: string }[]>();
        for (const tr of testruns) {
            const statuses = ((tr.attributes.testcases || tr.attributes.testcaseStatuses) as Record<string, string>) || {};
            for (const [tcId, st] of Object.entries(statuses)) {
                if (!executedTcMap.has(tcId)) {
                    executedTcMap.set(tcId, []);
                }
                executedTcMap.get(tcId)!.push({ status: st, testRunId: tr.address || (tr as any).identity });
            }
        }

        const items: QueryResultItem[] = [];

        // 1. Process testcases (and their execution instances in runs)
        const processedTcIdentities = new Set<string>();

        for (const [tcIdentity, executions] of executedTcMap.entries()) {
            const normTcId = normalizeAddress(tcIdentity);
            const tc = testcases.find(t => t.address === tcIdentity || normalizeAddress(t.address) === normTcId || (t as any).identity === tcIdentity || (t.tag && t.tag === tcIdentity));
            if (!tc) continue;
            processedTcIdentities.add(tc.address || (tc as any).identity);

            const defects = tcDefectsMap.get(normTcId) || tcDefectsMap.get(tc.address) || [];

            for (const exec of executions) {
                const qItem = this.toQueryItem(tc, exec.status, exec.testRunId);
                qItem.defects = defects;
                items.push(qItem);
            }
        }

        // Testcases not executed in any run
        for (const tc of testcases) {
            const tcId = tc.address || (tc as any).identity;
            if (!processedTcIdentities.has(tcId)) {
                const normTcId = normalizeAddress(tcId);
                const defects = tcDefectsMap.get(normTcId) || tcDefectsMap.get(tcId) || [];
                const qItem = this.toQueryItem(tc, String(tc.attributes.status || 'unexecuted'), '');
                qItem.defects = defects;
                items.push(qItem);
            }
        }

        // 2. Include other scopes (testrun, testplan, bug)
        for (const res of [...testruns, ...testplans, ...bugs]) {
            const cScope = this.getCanonicalScope(res.type);
            const status = res.attributes.status ? String(res.attributes.status) : (res.attributes.issueNumber ? 'active' : 'unexecuted');
            items.push(this.toQueryItem(res, status, cScope === 'testrun' ? (res.address || (res as any).identity) : ''));
        }

        this.normalizedItems = items;
    }

    public filterByTarget(target?: string | string[], baseItems?: QueryResultItem[]): QueryResultItem[] {
        if (!target) return baseItems ? [...baseItems] : [...this.normalizedItems];
        const items = baseItems ? [...baseItems] : [...this.normalizedItems];
        const targetList = (Array.isArray(target) ? target : [target])
            .map(t => typeof t === 'string' ? t.trim() : '')
            .filter(Boolean);

        if (targetList.length === 0) return items;

        const matchingItemIds = new Set<string>();
        const matchingRunIds = new Set<string>();

        for (const t of targetList) {
            // Find resources matching this target in the state
            const matchedResources = this.allResources.filter(r => matchesTarget(r.address || (r as any).identity, t));

            for (const res of matchedResources) {
                const cScope = this.getCanonicalScope(res.type);

                if (cScope === 'testplan') {
                    // Testplan: extract all linked testruns and their identities
                    matchingItemIds.add(res.address || (res as any).identity);
                    const linkedRuns = (res.attributes.testruns as string[]) || [];
                    for (const lr of linkedRuns) {
                        const runs = this.allResources.filter(r =>
                            this.getCanonicalScope(r.type) === 'testrun' &&
                            (matchesTarget(r.address || (r as any).identity, lr) || (r.address || (r as any).identity).endsWith(lr))
                        );
                        for (const r of runs) {
                            matchingRunIds.add(r.address || (r as any).identity);
                            matchingItemIds.add(r.address || (r as any).identity);
                        }
                        matchingRunIds.add(lr);
                    }
                } else if (cScope === 'testrun') {
                    matchingRunIds.add(res.address || (res as any).identity);
                    matchingItemIds.add(res.address || (res as any).identity);
                } else {
                    matchingItemIds.add(res.address || (res as any).identity);
                }
            }

            // Also support tag-style or target even if not yet matching an existing resource
            if (detectScopeFromTarget(t) === 'testrun') {
                matchingRunIds.add(t);
            }
        }

        return items.filter(it => {
            // 1. Is this item directly targeted by identity?
            if (matchingItemIds.has(it.id)) return true;
            if (targetList.some(t => matchesTarget(it.id, t))) return true;

            // 2. Is this item an execution within one of the matched testruns?
            if (it.testRunId) {
                if (matchingRunIds.has(it.testRunId)) return true;
                if (Array.from(matchingRunIds).some(rId => it.testRunId!.endsWith(rId) || rId.endsWith(it.testRunId!))) return true;
                if (targetList.some(t => matchesTarget(it.testRunId!, t))) return true;
            }

            return false;
        });
    }

    private toQueryItem(res: StateResource, status: string, testRunId: string): QueryResultItem {
        const cScope = this.getCanonicalScope(res.type);
        const rawCustom = (res.attributes.custom_fields || res.attributes.fields || {}) as Record<string, any>;
        const customFields: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawCustom)) {
            customFields[k.toLowerCase()] = String(v);
        }
        for (const [k, v] of Object.entries(res.attributes || {})) {
            if (['title', 'status', 'labels', 'assignees', 'milestone', 'issueNumber', 'remoteId', 'createdAt', 'updatedAt', 'testcases', 'testcaseStatuses', 'testruns', 'custom_fields', 'fields'].includes(k)) continue;
            if (v !== undefined && v !== null && typeof v !== 'object') {
                if (!customFields[k.toLowerCase()]) {
                    customFields[k.toLowerCase()] = String(v);
                }
            }
        }

        const labels = Array.isArray(res.attributes.labels)
            ? res.attributes.labels.map(String)
            : (res.attributes.labels ? String(res.attributes.labels).split(',') : []);

        const assignees = Array.isArray(res.attributes.assignees)
            ? res.attributes.assignees.map(String)
            : (res.attributes.assignees ? String(res.attributes.assignees).split(',') : []);

        return {
            id: res.address || (res as any).identity,
            type: res.type,
            canonicalScope: cScope,
            title: String(res.attributes.title || ''),
            status: status || 'unexecuted',
            issueNumber: res.attributes.issueNumber,
            remoteId: res.attributes.remoteId,
            labels,
            assignees,
            milestone: res.attributes.milestone ? String(res.attributes.milestone) : undefined,
            testRunId: testRunId || undefined,
            custom_fields: customFields,
            createdAt: String(res.attributes.createdAt || res.lastApplied || new Date().toISOString()),
            updatedAt: String(res.attributes.updatedAt || res.lastApplied || new Date().toISOString()),
            lastApplied: res.lastApplied,
            tainted: Boolean(res.tainted),
            originalResource: res
        };
    }

    public filter(filters: string | string[] = [], baseItems?: QueryResultItem[]): QueryResultItem[] {
        let items = baseItems ? [...baseItems] : [...this.normalizedItems];
        const filterList = Array.isArray(filters) ? filters : [filters];

        for (const f of filterList) {
            if (!f || typeof f !== 'string') continue;
            const trimmed = f.trim();
            if (!trimmed) continue;

            const eqIdx = trimmed.indexOf('=');

            // 1. Clave = Valor
            if (eqIdx !== -1) {
                const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
                const rawVal = trimmed.slice(eqIdx + 1).trim();
                const val = rawVal.toLowerCase();

                if (!key || !val) continue;

                // Support comma-separated multi-value filtering (e.g. status=passed,failed or sprint=sprint 3,sprint 4)
                const valList = val.split(',').map(v => v.trim()).filter(Boolean);

                if (key === 'scope') {
                    items = items.filter(it => valList.some(v => it.canonicalScope === v || it.type.toLowerCase().includes(v)));
                } else if (key === 'status') {
                    items = items.filter(it => valList.includes(it.status.toLowerCase()));
                } else if (key === 'label' || key === 'tag' || key === 'labels' || key === 'tags') {
                    const cleanVals = valList.map(v => v.startsWith('@') ? v.slice(1) : v);
                    items = items.filter(it => it.labels.some(l => {
                        const cleanL = l.startsWith('@') ? l.slice(1).toLowerCase() : l.toLowerCase();
                        return cleanVals.includes(cleanL);
                    }));
                } else if (key === 'assignee' || key === 'assignees') {
                    items = items.filter(it => it.assignees.some(a => valList.some(v => a.toLowerCase().includes(v))));
                } else if (key === 'milestone') {
                    items = items.filter(it => it.milestone && valList.some(v => it.milestone!.toLowerCase().includes(v)));
                } else if (key === 'sprint') {
                    items = items.filter(it => {
                        const sp = (it.custom_fields['sprint'] || it.milestone || '').toLowerCase();
                        return valList.some(v => sp.includes(v));
                    });
                } else if (key === 'module' || key === 'component') {
                    items = items.filter(it => {
                        const m = resolveItemFieldValue(it, 'module').toLowerCase();
                        return valList.some(v => m.includes(v));
                    });
                } else if (key === 'squad') {
                    items = items.filter(it => {
                        const sq = resolveItemFieldValue(it, 'squad').toLowerCase();
                        return valList.some(v => sq.includes(v));
                    });
                } else if (key === 'testrun' || key === 'testrunid') {
                    items = items.filter(it => it.testRunId && valList.some(v => it.testRunId!.toLowerCase().includes(v)));
                } else if (key === 'search') {
                    items = items.filter(it =>
                        valList.some(v =>
                            it.id.toLowerCase().includes(v) ||
                            it.title.toLowerCase().includes(v) ||
                            it.labels.some(l => l.toLowerCase().includes(v))
                        )
                    );
                } else {
                    // Custom fields o atributos generales
                    items = items.filter(it => {
                        const customVal = it.custom_fields[key];
                        if (customVal !== undefined && valList.some(v => customVal.toLowerCase() === v || customVal.toLowerCase().includes(v))) {
                            return true;
                        }
                        const attrVal = resolvePath(it.originalResource, key) ?? resolvePath(it.originalResource, `attributes.${key}`);
                        if (attrVal !== undefined && valList.some(v => String(attrVal).toLowerCase() === v || String(attrVal).toLowerCase().includes(v))) {
                            return true;
                        }
                        return false;
                    });
                }
            } else {
                // 2. Inferencia automática de búsqueda textual libre (sin '=')
                const searchLower = trimmed.toLowerCase();
                items = items.filter(it =>
                    it.id.toLowerCase().includes(searchLower) ||
                    it.title.toLowerCase().includes(searchLower) ||
                    it.labels.some(l => l.toLowerCase().includes(searchLower))
                );
            }
        }

        return items;
    }

    public group(items: QueryResultItem[], field?: string): Record<string, QueryResultItem[]> {
        if (!field) return { all: items };
        const result: Record<string, QueryResultItem[]> = {};
        const lowerField = field.trim().toLowerCase();

        for (const item of items) {
            let key = '';

            if (lowerField === 'status') {
                key = item.status;
            } else if (lowerField === 'label' || lowerField === 'labels' || lowerField === 'tags' || lowerField === 'tag') {
                if (item.labels.length === 0) {
                    key = 'untagged';
                    if (!result[key]) result[key] = [];
                    result[key].push(item);
                    continue;
                }
                for (const l of item.labels) {
                    if (!result[l]) result[l] = [];
                    result[l].push(item);
                }
                continue;
            } else if (lowerField === 'assignee' || lowerField === 'assignees') {
                key = item.assignees[0] || 'unassigned';
            } else if (lowerField === 'milestone') {
                key = item.milestone || 'none';
            } else if (lowerField === 'sprint') {
                key = item.custom_fields['sprint'] || item.milestone || 'none';
            } else if (lowerField === 'quarter') {
                key = item.custom_fields['quarter'] || 'none';
            } else if (lowerField === 'squad') {
                key = item.custom_fields['squad'] || item.custom_fields['squad (chap)'] || 'General';
            } else if (lowerField === 'priority') {
                let p = item.custom_fields['priority'] || 'Medium';
                if (p.startsWith('@')) p = p.slice(1);
                key = p.charAt(0).toUpperCase() + p.slice(1);
            } else if (lowerField === 'module' || lowerField === 'component') {
                key = resolveItemFieldValue(item, 'module');
            } else if (lowerField === 'feature' || lowerField === 'requirement') {
                key = item.id.includes('.') ? item.id.slice(0, item.id.lastIndexOf('.')) : item.id;
            } else if (lowerField === 'testrun' || lowerField === 'testrunid') {
                key = item.testRunId || 'none';
            } else {
                key = item.custom_fields[lowerField]
                    || String(resolvePath(item.originalResource, lowerField) ?? resolvePath(item.originalResource, `attributes.${lowerField}`) ?? 'other');
            }

            if (!result[key]) result[key] = [];
            result[key].push(item);
        }

        return result;
    }

    public getStats(items: QueryResultItem[]): ReportStats {
        const stats: ReportStats = {
            total: 0,
            passed: 0,
            failed: 0,
            pending: 0,
            blocked: 0,
            skipped: 0,
            undefined: 0,
            ambiguous: 0,
            unexecuted: 0,
            totalRuns: 0,
            activeRuns: 0,
            closedRuns: 0,
            totalPlans: 0
        };

        const testcases = items.filter(it => it.canonicalScope === 'testcase');

        const filteredRunIds = new Set(
            items.filter(it => it.canonicalScope === 'testrun').map(it => it.id)
                .concat(items.map(it => it.testRunId).filter(Boolean) as string[])
        );
        const filteredPlanIds = new Set(
            items.filter(it => it.canonicalScope === 'testplan').map(it => it.id)
        );

        const allRuns = this.allResources.filter(r => this.getCanonicalScope(r.type) === 'testrun');
        const allPlans = this.allResources.filter(r => this.getCanonicalScope(r.type) === 'testplan');

        const testruns = filteredRunIds.size > 0 
            ? allRuns.filter(r => filteredRunIds.has(r.address || (r as any).identity) || Array.from(filteredRunIds).some(id => (r.address || (r as any).identity).endsWith(id) || id.endsWith(r.address || (r as any).identity)))
            : allRuns;
        const testplans = filteredPlanIds.size > 0
            ? allPlans.filter(p => filteredPlanIds.has(p.address || (p as any).identity))
            : allPlans;

        stats.total = testcases.length;
        for (const tc of testcases) {
            const s = tc.status.toLowerCase();
            if (s === 'passed') stats.passed++;
            else if (s === 'failed') stats.failed++;
            else if (s === 'pending') stats.pending++;
            else if (s === 'blocked') stats.blocked++;
            else if (s === 'skipped') stats.skipped++;
            else if (s === 'undefined') stats.undefined++;
            else if (s === 'ambiguous') stats.ambiguous++;
            else stats.unexecuted++;
        }

        stats.totalRuns = testruns.length;
        stats.activeRuns = testruns.filter(r => r.attributes.state === 'open' || r.attributes.status === 'open').length;
        stats.closedRuns = testruns.filter(r => r.attributes.state === 'closed' || r.attributes.status === 'closed').length;
        stats.totalPlans = testplans.length;

        return stats;
    }
}
