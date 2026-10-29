import { IProvider, IProviderIssueResult } from '../providers/interface';
import { resource } from './resources';

// ─── Batch Execution ──────────────────────────────────────────────────────────

/**
 * Executes an array of items in batches with a given concurrency/parallelism limit.
 */
export async function executeInBatches<T, R>(
    items: T[],
    parallelism: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const limit = Math.max(1, parallelism || 1);
    const results: R[] = [];

    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }

    return results;
}

// ─── Array & Field Comparison ─────────────────────────────────────────────────

/**
 * Normalizes an array or comma-separated string into a trimmed, lowercased string array.
 */
function normalizeStringArray(val?: string[] | string): string[] {
    if (!val) return [];
    const arr = Array.isArray(val) ? val : String(val).split(',');
    return arr.map(s => String(s).trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
}

/**
 * Compares two string arrays or comma-separated strings case-insensitively, order-independently.
 */
export function arraysEqual(a?: string[] | string, b?: string[] | string): boolean {
    const normA = normalizeStringArray(a).sort();
    const normB = normalizeStringArray(b).sort();

    if (normA.length !== normB.length) return false;
    return normA.every((val, index) => val === normB[index]);
}

/**
 * Reconciles local and remote custom fields, accounting for `@` prefix and case insensitivity.
 */
export function compareCustomFields(
    localFields: Record<string, any> = {},
    remoteFields: Record<string, string> = {},
    ignoreFields: string[] = []
): { hasDrift: boolean; reconciled: Record<string, string> } {
    const reconciled: Record<string, string> = { ...localFields };
    let hasDrift = false;
    const ignoredSet = new Set(ignoreFields.map(f => f.toLowerCase()));

    for (const localKey of Object.keys(localFields)) {
        if (ignoredSet.has(localKey.toLowerCase()) || ignoredSet.has('custom_fields')) {
            continue;
        }

        // Find remote value by case-insensitive key
        const remoteKeyMatch = Object.keys(remoteFields).find(k => k.toLowerCase() === localKey.toLowerCase());
        const remoteVal = remoteKeyMatch ? remoteFields[remoteKeyMatch] : '';

        const localVal = String(localFields[localKey] ?? '');
        const cleanLocalVal = localVal.startsWith('@') ? localVal.substring(1).toLowerCase() : localVal.toLowerCase();
        const cleanRemoteVal = remoteVal.startsWith('@') ? remoteVal.substring(1).toLowerCase() : remoteVal.toLowerCase();

        if (cleanLocalVal !== cleanRemoteVal) {
            reconciled[localKey] = remoteVal;
            hasDrift = true;
        }
    }

    return { hasDrift, reconciled };
}

// ─── Attribute Drift Detection ────────────────────────────────────────────────

export interface DriftDetectionResult {
    hasDrift: boolean;
    newAttributes: Record<string, any>;
}

/**
 * Detects differences between local state attributes and remote issue data,
 * updating attributes for title, labels, assignees, milestone, and custom fields,
 * while respecting ignored fields in ignoreChanges.
 */
export function detectAttributeDrift(
    currentAttributes: Record<string, any>,
    remoteIssue: IProviderIssueResult,
    remoteCustomFields?: Record<string, string>,
    ignoreChanges: string[] = []
): DriftDetectionResult {
    const newAttributes: Record<string, any> = { ...currentAttributes };
    let hasDrift = false;
    const ignored = new Set(ignoreChanges.map(s => s.toLowerCase()));

    // 1. Title
    const remoteTitle = (remoteIssue.title ?? '').trim();
    const localTitle = String(newAttributes.title ?? '').trim();
    if (!ignored.has('title') && localTitle !== remoteTitle) {
        newAttributes.title = remoteIssue.title;
        hasDrift = true;
    }

    // 2. Labels
    const remoteLabels = remoteIssue.labels ?? [];
    if (!ignored.has('labels') && !arraysEqual(newAttributes.labels, remoteLabels)) {
        newAttributes.labels = remoteLabels;
        hasDrift = true;
    }

    // 3. Assignees
    const remoteAssignees = remoteIssue.assignees ?? [];
    if (!ignored.has('assignees') && !arraysEqual(newAttributes.assignees, remoteAssignees)) {
        newAttributes.assignees = remoteAssignees;
        hasDrift = true;
    }

    // 4. Milestone
    const remoteMilestone = (remoteIssue.milestone ?? '').trim();
    const localMilestone = String(newAttributes.milestone ?? '').trim();
    if (!ignored.has('milestone') && localMilestone !== remoteMilestone) {
        newAttributes.milestone = remoteMilestone;
        hasDrift = true;
    }

    // 5. Custom Fields
    if (remoteCustomFields !== undefined && !ignored.has('custom_fields')) {
        const localCustomFields = (newAttributes.custom_fields as Record<string, string>) || {};
        const fieldComparison = compareCustomFields(localCustomFields, remoteCustomFields, ignoreChanges);
        if (fieldComparison.hasDrift) {
            newAttributes.custom_fields = fieldComparison.reconciled;
            hasDrift = true;
        }
    }

    return { hasDrift, newAttributes };
}

// ─── Testrun Status Comments Sync ─────────────────────────────────────────────

export interface SyncTestrunCommentsOptions {
    change: any;
    issueNumber: number;
    provider: IProvider;
    stateObj: any;
    testDirectory?: string;
    existingAttributes?: any;
    onCommentUpdate?: (identity: string, status: string) => void;
    onCommentCreate?: (identity: string, status: string) => void;
}

export interface SyncTestrunCommentsResult {
    testcaseCommentIds: Record<string, any>;
    testcaseStatuses: Record<string, string>;
    expandedTestcases: string[];
}

/**
 * Synchronizes testcase status comments on a remote testrun issue.
 */
export async function syncTestrunComments(
    options: SyncTestrunCommentsOptions
): Promise<SyncTestrunCommentsResult> {
    const {
        change,
        issueNumber,
        provider,
        stateObj,
        testDirectory,
        existingAttributes,
        onCommentUpdate,
        onCommentCreate,
    } = options;

    if (!change.resourceType.endsWith('testrun') || !change.scenario.custom?.testcases) {
        return {
            testcaseCommentIds: existingAttributes?.testcaseCommentIds || {},
            testcaseStatuses: existingAttributes?.testcaseStatuses || {},
            expandedTestcases: [],
        };
    }

    const testcaseCommentIds: Record<string, any> = { ...(existingAttributes?.testcaseCommentIds || {}) };
    const testcaseStatuses: Record<string, string> = { ...(existingAttributes?.testcaseStatuses || {}) };
    const expandedTestcases: string[] = [];

    const comments = resource.evaluateComments(change.resourceType, change.scenario, {
        state: stateObj,
        testDirectory,
        existingAttributes,
    });

    for (const comment of comments) {
        const { identity, status, body } = comment;
        expandedTestcases.push(identity);

        const prevStatus = existingAttributes?.testcaseStatuses?.[identity];
        if (!testcaseCommentIds[identity] || prevStatus !== status) {
            if (testcaseCommentIds[identity]) {
                await provider.updateIssueComment(testcaseCommentIds[identity], body);
                onCommentUpdate?.(identity, status);
            } else {
                const result = await provider.createIssueComment(issueNumber, body);
                testcaseCommentIds[identity] = result.id;
                onCommentCreate?.(identity, status);
            }
        }
        testcaseStatuses[identity] = status;
    }

    if (Object.keys(testcaseStatuses).length === 0 && change.scenario.custom?.groupScenarios) {
        for (const gs of change.scenario.custom.groupScenarios) {
            if (gs.rule && gs.name) {
                const tcKey = `${gs.rule.name}.${gs.name}`;
                testcaseStatuses[tcKey] = gs.custom?.fields?.status || 'pending';
            }
        }
    }

    return { testcaseCommentIds, testcaseStatuses, expandedTestcases };
}
