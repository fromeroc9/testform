import { bold, green, yellow, red, cyan, gray, dim, magenta } from 'chalk';
import { State } from '../core/state';
import { Config } from '../core/config';
import { IScope, StateResource } from '../core/types';
import { SCOPE_RESOURCE_MAP, TITLE_APP } from '../core/const';
import { resolve, join } from 'path';

export interface QueryCmdOptions {
    dir?: string;
    testDirectory?: string;
    scope?: IScope | 'all';
    status?: string;
    label?: string;
    assignee?: string;
    milestone?: string;
    custom?: string | string[];
    search?: string;
    json?: boolean;
    count?: boolean;
    verbose?: boolean;
    statePath?: string;
    backupPath?: string;
}

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
    custom_fields: Record<string, string>;
    lastApplied?: string;
    tainted?: boolean;
}

export const queryCmd = async (options: QueryCmdOptions = {}) => {
    const {
        dir = '.',
        testDirectory,
        scope = 'all',
        status,
        label,
        assignee,
        milestone,
        custom,
        search,
        json = false,
        count = false,
        verbose = false,
        statePath,
        backupPath
    } = options;

    const targetDir = testDirectory ? resolve(dir, testDirectory) : resolve(dir);
    const stateObj = new State(dir, statePath, backupPath);
    await stateObj.init();

    const allResources = stateObj.getState().resources || [];

    // Helper for canonical scope
    const getCanonicalScope = (type: string): string => {
        if (type.includes('_')) return type.split('_').slice(1).join('_');
        return type;
    };

    // Build latest status map from testruns for testcases
    const testcaseStatusMap = new Map<string, string>();
    const testruns = allResources.filter(r => getCanonicalScope(r.type) === 'testrun');
    for (const tr of testruns) {
        const statuses = tr.attributes.testcaseStatuses as Record<string, string> || {};
        for (const [tcId, st] of Object.entries(statuses)) {
            testcaseStatusMap.set(tcId, st);
        }
    }

    // Map resources to query items
    let items: QueryResultItem[] = allResources.map(res => {
        const cScope = getCanonicalScope(res.type);
        let resStatus = 'unexecuted';

        if (cScope === 'testcase') {
            if (testcaseStatusMap.has(res.identity)) {
                resStatus = testcaseStatusMap.get(res.identity)!;
            } else if (res.attributes.status) {
                resStatus = String(res.attributes.status);
            }
        } else if (res.attributes.status) {
            resStatus = String(res.attributes.status);
        } else if (res.attributes.issueNumber) {
            resStatus = 'active';
        }

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
            status: resStatus,
            issueNumber: res.attributes.issueNumber,
            remoteId: res.attributes.remoteId,
            labels,
            assignees,
            milestone: res.attributes.milestone ? String(res.attributes.milestone) : undefined,
            custom_fields: customFields,
            lastApplied: res.lastApplied,
            tainted: Boolean(res.tainted)
        };
    });

    // ── Apply Filters ──

    // 1. Scope filter
    if (scope && scope !== 'all') {
        const targetScope = String(scope).toLowerCase();
        items = items.filter(item => item.canonicalScope === targetScope || item.type.toLowerCase().includes(targetScope));
    }

    // 2. Status filter
    if (status) {
        const targetStatus = status.toLowerCase();
        items = items.filter(item => item.status.toLowerCase() === targetStatus);
    }

    // 3. Label / Tag filter
    if (label) {
        const cleanTarget = label.startsWith('@') ? label.slice(1).toLowerCase() : label.toLowerCase();
        items = items.filter(item => item.labels.some(l => {
            const cleanL = l.startsWith('@') ? l.slice(1).toLowerCase() : l.toLowerCase();
            return cleanL === cleanTarget;
        }));
    }

    // 4. Assignee filter
    if (assignee) {
        const targetAssignee = assignee.toLowerCase();
        items = items.filter(item => item.assignees.some(a => a.toLowerCase().includes(targetAssignee)));
    }

    // 5. Milestone filter
    if (milestone) {
        const targetMilestone = milestone.toLowerCase();
        items = items.filter(item => item.milestone && item.milestone.toLowerCase().includes(targetMilestone));
    }

    // 6. Custom field filter (e.g. priority=high)
    if (custom) {
        const customFilters = Array.isArray(custom) ? custom : [custom];
        for (const cf of customFilters) {
            const eqIdx = cf.indexOf('=');
            if (eqIdx !== -1) {
                const k = cf.slice(0, eqIdx).trim().toLowerCase();
                const v = cf.slice(eqIdx + 1).trim().toLowerCase();
                items = items.filter(item => {
                    const itemVal = item.custom_fields[k];
                    return itemVal !== undefined && itemVal.toLowerCase() === v;
                });
            }
        }
    }

    // 7. Search filter (text in identity, title)
    if (search) {
        const targetSearch = search.toLowerCase();
        items = items.filter(item =>
            item.id.toLowerCase().includes(targetSearch) ||
            item.title.toLowerCase().includes(targetSearch) ||
            item.labels.some(l => l.toLowerCase().includes(targetSearch))
        );
    }

    // ── Output ──

    if (count) {
        console.log(items.length);
        return;
    }

    if (json) {
        console.log(JSON.stringify(items, null, 2));
        return;
    }

    // Console Table output
    console.log('');
    console.log(bold(`# ${TITLE_APP} Query Results (${items.length} matches)`));
    console.log(dim('─'.repeat(80)));

    if (items.length === 0) {
        console.log(yellow('No resources matched the given query criteria.'));
        console.log('');
        return;
    }

    const formatStatus = (st: string): string => {
        switch (st.toLowerCase()) {
            case 'passed': return green('✔ passed');
            case 'failed': return red('✖ failed');
            case 'pending': return yellow('⏳ pending');
            case 'blocked': return magenta('⛔ blocked');
            case 'skipped': return gray('⏭ skipped');
            case 'unexecuted': return dim('❔ unexecuted');
            default: return cyan(st);
        }
    };

    for (const item of items) {
        const issuePart = item.issueNumber ? cyan(`#${item.issueNumber}`) : dim('(no issue)');
        const labelsPart = item.labels.length > 0 ? gray(`[${item.labels.join(', ')}]`) : '';
        const taintedPart = item.tainted ? red(' [tainted]') : '';
        const statusFormatted = formatStatus(item.status);

        console.log(`  ${statusFormatted}  ${cyan(item.canonicalScope)}.${bold(item.id)} ${issuePart}${taintedPart}`);
        console.log(`     Title:     ${item.title || dim('(no title)')}`);
        if (item.assignees.length > 0) {
            console.log(`     Assignees: ${item.assignees.join(', ')}`);
        }
        if (labelsPart) {
            console.log(`     Labels:    ${labelsPart}`);
        }
        if (Object.keys(item.custom_fields).length > 0) {
            const fieldsStr = Object.entries(item.custom_fields).map(([k, v]) => `${k}=${v}`).join(', ');
            console.log(`     Fields:    ${dim(fieldsStr)}`);
        }
        console.log('');
    }

    console.log(bold(`Total: ${items.length} resource(s) found.`));
    console.log('');
};
