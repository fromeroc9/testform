import { ResourceTemplate } from '../../core/types';
import {
    resource,
    extractCustomFields,
    getScenarioValue,
    getScenarioStatus,
    getScenarioTrace,
    getScenarioEvidence,
    calculatePlanRollup,
    extractPlanTestrunsMap,
    extractTestcaseStatusMap,
    extractTestcaseTraceMap,
    extractTestcaseEvidenceMap,
    extractLabels,
    extractAssignees,
} from '../../core/resources';
import { calculateRollupVerdict } from '../../core/utils';
import {
    buildLocalTestcaseBody,
    buildLocalTestrunBody,
    buildLocalTestplanBody,
    buildLocalBugBody,
} from './templates';

export const localTestcaseTemplate: ResourceTemplate = {
    type: 'testcase',
    attributes: (s: any) => ({
        title: s.name,
        body: buildLocalTestcaseBody(s),
        labels: extractLabels(s),
        assignees: extractAssignees(s),
        milestone: s.custom?.fields?.milestone || undefined,
        state: 'open',
        custom_fields: extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status', 'evidence', 'attach'])
    }),
    state: {
        metadata: (s: any) => extractCustomFields(s.custom?.fields, ['evidence', 'attach'])
    }
};

export const localTestrunTemplate: ResourceTemplate = {
    type: 'testrun',
    attributes: (s: any, context?: any) => {
        const groupScenarios = s.custom?.groupScenarios || [];
        const statuses = groupScenarios.map((gs: any) => getScenarioStatus(gs, 'pending'));
        const rollupStatus = calculateRollupVerdict(statuses);
        const customFields = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status', 'evidence', 'attach']) || {};

        return {
            title: s.feature?.name || '',
            body: buildLocalTestrunBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: rollupStatus === 'passed' ? 'closed' : 'open',
            custom_fields: customFields
        };
    },
    state: {
        status: (s: any) => {
            const groupScenarios = s.custom?.groupScenarios || [];
            const statuses = groupScenarios.map((gs: any) => getScenarioStatus(gs, 'pending'));
            return calculateRollupVerdict(statuses);
        },
        duration: (s: any) => getScenarioValue(s, 'duration'),
        attach: (s: any) => getScenarioEvidence(s),
        trace: (s: any) => getScenarioTrace(s),
        testcases: (s: any) => extractTestcaseStatusMap(s),
        testcaseTraces: (s: any) => {
            const map = extractTestcaseTraceMap(s);
            return Object.keys(map).length > 0 ? map : undefined;
        },
        testcaseEvidence: (s: any) => {
            const map = extractTestcaseEvidenceMap(s);
            return Object.keys(map).length > 0 ? map : undefined;
        },
        metadata: (s: any) => extractCustomFields(s.custom?.fields, ['evidence', 'attach', 'duration', 'trace'])
    }
};

export const localTestplanTemplate: ResourceTemplate = {
    type: 'testplan',
    attributes: (s: any, context?: any) => {
        const rollupStatus = calculatePlanRollup(s, context);
        const customFields = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status', 'evidence', 'attach']) || {};

        return {
            title: s.feature?.name || '',
            body: buildLocalTestplanBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: rollupStatus === 'passed' ? 'closed' : 'open',
            custom_fields: customFields
        };
    },
    state: {
        status: (s: any, context?: any) => calculatePlanRollup(s, context),
        attach: (s: any) => getScenarioEvidence(s),
        testruns: (s: any, context?: any) => extractPlanTestrunsMap(s, context),
        metadata: (s: any) => extractCustomFields(s.custom?.fields, ['status', 'evidence', 'attach'])
    }
};

export const localBugTemplate: ResourceTemplate = {
    type: 'bug',
    attributes: (s: any) => {
        const rawStatus = getScenarioStatus(s, 'open');
        const bugStatus = ['open', 'in_progress', 'closed', 'resolved'].includes(rawStatus.toLowerCase()) ? rawStatus : 'open';
        const customFields = extractCustomFields(s.custom?.fields, [
            'labels', 'assignees', 'milestone', 'status', 'trace', 'error', 'evidence', 'attach', 'target', 'testcase', 'testrun', 'run'
        ]) || {};

        return {
            title: s.name || s.feature?.name || '',
            body: buildLocalBugBody(s),
            labels: extractLabels(s, 'bug'),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: (bugStatus === 'closed' || bugStatus === 'resolved') ? 'closed' : 'open',
            custom_fields: customFields
        };
    },
    state: {
        status: (s: any) => {
            const rawStatus = getScenarioStatus(s, 'open');
            return ['open', 'in_progress', 'closed', 'resolved'].includes(rawStatus.toLowerCase()) ? rawStatus : 'open';
        },
        trace: (s: any) => getScenarioTrace(s),
        attach: (s: any) => getScenarioEvidence(s),
        testcase: (s: any) => getScenarioValue(s, 'target') ?? getScenarioValue(s, 'testcase'),
        testrun: (s: any) => getScenarioValue(s, 'run') ?? s.feature?.name ?? getScenarioValue(s, 'testrun'),
        metadata: (s: any) => extractCustomFields(s.custom?.fields, [
            'trace', 'error', 'evidence', 'attach', 'target', 'testcase', 'testrun', 'run'
        ])
    }
};

/**
 * Registers Local-specific resource templates in the resource registry.
 * Strictly registers agnostic domain resource types ('testcase', 'testrun', 'testplan', 'bug').
 */
export function registerLocalResources(): void {
    resource.registry(localTestcaseTemplate);
    resource.registry(localTestrunTemplate);
    resource.registry(localTestplanTemplate);
    resource.registry(localBugTemplate);
}
