import { bold, green, yellow, red, cyan, gray, dim, magenta } from 'chalk';
import { IScope } from '../core/types';
import { TITLE_APP } from '../core/const';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { StateQuery, QueryResultItem } from '../core/query';

export { QueryResultItem } from '../core/query';

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
    filter?: string | string[];
    target?: string | string[];
    json?: boolean;
    count?: boolean;
    verbose?: boolean;
    statePath?: string;
    backupPath?: string;
    generateConfigOut?: string;
    variables?: any;
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
        filter,
        target,
        json = false,
        count = false,
        verbose = false,
        statePath,
        backupPath,
        generateConfigOut
    } = options;

    const targetDir = testDirectory ? resolve(dir, testDirectory) : resolve(dir);
    const stateQuery = new StateQuery(targetDir, statePath, backupPath);
    await stateQuery.init();

    if (stateQuery.getResources().length === 0) {
        console.error(red('╷'));
        console.error(`${red('│')} ${bold(red('Error:'))} ${bold('No resources to query')}`);
        console.error(red('│'));
        console.error(`${red('│')} The configuration does not contain any resources that can be queried.`);
        console.error(red('╵'));
        process.exit(1);
    }

    // Apply target scoping first
    const targetedItems = stateQuery.filterByTarget(target);

    // Unify all filters (legacy options + new unified -filter)
    const filters: string[] = [];

    if (filter) {
        if (Array.isArray(filter)) filters.push(...filter);
        else filters.push(filter);
    }
    if (scope && scope !== 'all') filters.push(`scope=${scope}`);
    if (status) filters.push(`status=${status}`);
    if (label) filters.push(`label=${label}`);
    if (assignee) filters.push(`assignee=${assignee}`);
    if (milestone) filters.push(`milestone=${milestone}`);
    if (custom) {
        const customArr = Array.isArray(custom) ? custom : [custom];
        filters.push(...customArr);
    }
    if (search) filters.push(search);

    const items: QueryResultItem[] = filters.length > 0 ? stateQuery.filter(filters, targetedItems) : targetedItems;

    // ── Output ──

    if (generateConfigOut) {
        const outPath = resolve(dir, generateConfigOut);
        const configLines = items.map(it => {
            return `# Resource: ${it.id}\nimport {\n  to = ${it.type}.${it.id.replace(/[^a-zA-Z0-9_]/g, '_')}\n  id = "${it.remoteId || it.issueNumber || it.id}"\n}`;
        }).join('\n\n');
        if (json) {
            console.log(JSON.stringify({ generated_config: configLines, resources: items }, null, 2));
        } else {
            writeFileSync(outPath, configLines + '\n', 'utf-8');
            console.log(green(`\n✔ Generated configuration written to ${outPath}\n`));
        }
        return;
    }

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
