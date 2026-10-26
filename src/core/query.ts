import { State } from './state';
import { StateResource } from './types';
import { resolvePath } from './utils';
import { matchesTarget } from './selector';

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
}

export interface ReportStats {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    blocked: number;
    skipped: number;
    unexecuted: number;
    totalRuns: number;
    activeRuns: number;
    closedRuns: number;
    totalPlans: number;
}

export class StateQuery {
    private stateObj: State;
    private initialized = false;
    private allResources: StateResource[] = [];
    private normalizedItems: QueryResultItem[] = [];

    constructor(
        private dir: string = '.',
        private statePath?: string,
        private backupPath?: string
    ) {
        this.stateObj = new State(this.dir, this.statePath, this.backupPath);
    }

    public async init(): Promise<void> {
        if (this.initialized) return;
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
                ...(this.stateObj.getResources() || [])
            ];
            const seen = new Set<string>();
            this.allResources = list.filter(r => {
                if (!r || !r.identity || seen.has(r.identity)) return false;
                seen.add(r.identity);
                return true;
            });
        }
        this.normalize();
        this.initialized = true;
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

        // Map status from testruns
        const executedTcMap = new Map<string, { status: string; testRunId: string }[]>();
        for (const tr of testruns) {
            const statuses = (tr.attributes.testcaseStatuses as Record<string, string>) || {};
            for (const [tcId, st] of Object.entries(statuses)) {
                if (!executedTcMap.has(tcId)) {
                    executedTcMap.set(tcId, []);
                }
                executedTcMap.get(tcId)!.push({ status: st, testRunId: tr.identity });
            }
        }

        const items: QueryResultItem[] = [];

        // 1. Process testcases (and their execution instances in runs)
        const processedTcIdentities = new Set<string>();

        for (const [tcIdentity, executions] of executedTcMap.entries()) {
            const tc = testcases.find(t => t.identity === tcIdentity);
            if (!tc) continue;
            processedTcIdentities.add(tcIdentity);

            for (const exec of executions) {
                items.push(this.toQueryItem(tc, exec.status, exec.testRunId));
            }
        }

        // Testcases not executed in any run
        for (const tc of testcases) {
            if (!processedTcIdentities.has(tc.identity)) {
                items.push(this.toQueryItem(tc, String(tc.attributes.status || 'unexecuted'), ''));
            }
        }

        // 2. Include other scopes (testrun, testplan)
        for (const res of [...testruns, ...testplans]) {
            const cScope = this.getCanonicalScope(res.type);
            const status = res.attributes.status ? String(res.attributes.status) : (res.attributes.issueNumber ? 'active' : 'unexecuted');
            items.push(this.toQueryItem(res, status, cScope === 'testrun' ? res.identity : ''));
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
            const matchedResources = this.allResources.filter(r => matchesTarget(r.identity, t));

            for (const res of matchedResources) {
                const cScope = this.getCanonicalScope(res.type);

                if (cScope === 'testplan') {
                    // Testplan: extract all linked testruns and their identities
                    matchingItemIds.add(res.identity);
                    const linkedRuns = (res.attributes.testruns as string[]) || [];
                    for (const lr of linkedRuns) {
                        const runs = this.allResources.filter(r =>
                            this.getCanonicalScope(r.type) === 'testrun' &&
                            (matchesTarget(r.identity, lr) || r.identity.endsWith(lr))
                        );
                        for (const r of runs) {
                            matchingRunIds.add(r.identity);
                            matchingItemIds.add(r.identity);
                        }
                        matchingRunIds.add(lr);
                    }
                } else if (cScope === 'testrun') {
                    matchingRunIds.add(res.identity);
                    matchingItemIds.add(res.identity);
                } else {
                    matchingItemIds.add(res.identity);
                }
            }

            // Also support tag-style @tr or @tp target even if not yet matching an existing resource
            if (t.startsWith('@tr-') || t.includes('.run.feature')) {
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
        const rawCustom = (res.attributes.custom_fields || {}) as Record<string, any>;
        const customFields: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawCustom)) {
            customFields[k.toLowerCase()] = String(v);
        }

        const labels = Array.isArray(res.attributes.labels)
            ? res.attributes.labels.map(String)
            : (res.attributes.labels ? String(res.attributes.labels).split(',') : []);

        const assignees = Array.isArray(res.attributes.assignees)
            ? res.attributes.assignees.map(String)
            : (res.attributes.assignees ? String(res.attributes.assignees).split(',') : []);

        return {
            id: res.identity,
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
                const val = trimmed.slice(eqIdx + 1).trim().toLowerCase();

                if (!key || !val) continue;

                if (key === 'scope') {
                    items = items.filter(it => it.canonicalScope === val || it.type.toLowerCase().includes(val));
                } else if (key === 'status') {
                    items = items.filter(it => it.status.toLowerCase() === val);
                } else if (key === 'label' || key === 'tag' || key === 'labels' || key === 'tags') {
                    const cleanVal = val.startsWith('@') ? val.slice(1) : val;
                    items = items.filter(it => it.labels.some(l => {
                        const cleanL = l.startsWith('@') ? l.slice(1).toLowerCase() : l.toLowerCase();
                        return cleanL === cleanVal;
                    }));
                } else if (key === 'assignee' || key === 'assignees') {
                    items = items.filter(it => it.assignees.some(a => a.toLowerCase().includes(val)));
                } else if (key === 'milestone') {
                    items = items.filter(it => it.milestone && it.milestone.toLowerCase().includes(val));
                } else if (key === 'testrun' || key === 'testrunid') {
                    items = items.filter(it => it.testRunId && it.testRunId.toLowerCase().includes(val));
                } else if (key === 'search') {
                    items = items.filter(it =>
                        it.id.toLowerCase().includes(val) ||
                        it.title.toLowerCase().includes(val) ||
                        it.labels.some(l => l.toLowerCase().includes(val))
                    );
                } else {
                    // Custom fields o atributos generales
                    items = items.filter(it => {
                        const customVal = it.custom_fields[key];
                        if (customVal !== undefined && customVal.toLowerCase() === val) {
                            return true;
                        }
                        const attrVal = resolvePath(it.originalResource, key) ?? resolvePath(it.originalResource, `attributes.${key}`);
                        if (attrVal !== undefined && String(attrVal).toLowerCase() === val) {
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
            ? allRuns.filter(r => filteredRunIds.has(r.identity) || Array.from(filteredRunIds).some(id => r.identity.endsWith(id) || id.endsWith(r.identity)))
            : allRuns;
        const testplans = filteredPlanIds.size > 0
            ? allPlans.filter(p => filteredPlanIds.has(p.identity))
            : allPlans;

        stats.total = testcases.length;
        for (const tc of testcases) {
            const s = tc.status.toLowerCase();
            if (s === 'passed') stats.passed++;
            else if (s === 'failed') stats.failed++;
            else if (s === 'pending') stats.pending++;
            else if (s === 'blocked') stats.blocked++;
            else if (s === 'skipped') stats.skipped++;
            else stats.unexecuted++;
        }

        stats.totalRuns = testruns.length;
        stats.activeRuns = testruns.filter(r => r.attributes.state === 'open' || r.attributes.status === 'open').length;
        stats.closedRuns = testruns.filter(r => r.attributes.state === 'closed' || r.attributes.status === 'closed').length;
        stats.totalPlans = testplans.length;

        return stats;
    }
}
