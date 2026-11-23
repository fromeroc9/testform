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
    buildGitHubTestcaseBody,
    buildGitHubTestrunBody,
    buildGitHubTestplanBody,
    buildGitHubBugBody,
} from './templates';

export const githubTestcaseTemplate: ResourceTemplate = {
    type: 'testcase',
    attributes: (s: any) => ({
        title: s.name,
        body: buildGitHubTestcaseBody(s),
        labels: extractLabels(s),
        assignees: extractAssignees(s),
        milestone: s.custom?.fields?.milestone || undefined,
        state: 'open',
        metadata: extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach']) || {}
    }),
    state: {}
};

export const githubTestrunTemplate: ResourceTemplate = {
    type: 'testrun',
    attributes: (s: any, context?: any) => {
        const groupScenarios = s.custom?.groupScenarios || [];
        const statuses = groupScenarios.map((gs: any) => getScenarioStatus(gs, 'pending'));
        const rollupStatus = calculateRollupVerdict(statuses);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach', 'duration', 'trace']) || {};

        // Sincroniza el campo Status de GitHub Projects únicamente si fue declarado por el usuario en main.yml
        const statusFieldKey = Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status');
        if (statusFieldKey) {
            const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === statusFieldKey.toLowerCase());
            const explicitVal = explicitEntry ? explicitEntry[1] : undefined;
            if (explicitVal !== undefined && explicitVal !== '') {
                meta[statusFieldKey] = explicitVal;
            } else {
                meta[statusFieldKey] = rollupStatus;
            }
        }

        const effectiveStatus = (statusFieldKey && meta[statusFieldKey]) || rollupStatus;

        return {
            title: s.feature?.name || '',
            body: buildGitHubTestrunBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: effectiveStatus === 'passed' ? 'closed' : 'open',
            metadata: meta
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
        }
    }
};

export const githubTestplanTemplate: ResourceTemplate = {
    type: 'testplan',
    attributes: (s: any, context?: any) => {
        const rollupStatus = calculatePlanRollup(s, context);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach']) || {};

        const statusFieldKey = Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status');
        if (statusFieldKey) {
            const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === statusFieldKey.toLowerCase());
            const explicitVal = explicitEntry ? explicitEntry[1] : undefined;
            if (explicitVal !== undefined && explicitVal !== '') {
                meta[statusFieldKey] = explicitVal;
            } else {
                meta[statusFieldKey] = rollupStatus;
            }
        }

        const effectiveStatus = (statusFieldKey && meta[statusFieldKey]) || rollupStatus;

        return {
            title: s.feature?.name || '',
            body: buildGitHubTestplanBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: effectiveStatus === 'passed' ? 'closed' : 'open',
            metadata: meta
        };
    },
    state: {
        status: (s: any, context?: any) => calculatePlanRollup(s, context),
        attach: (s: any) => getScenarioEvidence(s),
        testruns: (s: any, context?: any) => extractPlanTestrunsMap(s, context)
    }
};

export const githubBugTemplate: ResourceTemplate = {
    type: 'bug',
    attributes: (s: any) => {
        const rawStatus = getScenarioStatus(s, 'open');
        const bugStatus = ['open', 'in_progress', 'closed', 'resolved'].includes(rawStatus.toLowerCase()) ? rawStatus : 'open';
        const meta = extractCustomFields(s.custom?.fields, [
            'labels', 'assignees', 'milestone', 'trace', 'error', 'evidence', 'attach', 'target', 'testcase', 'testrun', 'run'
        ]) || {};

        const statusFieldKey = Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status');
        if (statusFieldKey) {
            meta[statusFieldKey] = bugStatus;
        }

        return {
            title: s.name || s.feature?.name || '',
            body: buildGitHubBugBody(s),
            labels: extractLabels(s, 'bug'),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: (bugStatus === 'closed' || bugStatus === 'resolved') ? 'closed' : 'open',
            metadata: meta
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
        testrun: (s: any) => getScenarioValue(s, 'run') ?? s.feature?.name ?? getScenarioValue(s, 'testrun')
    }
};

/**
 * Registers GitHub-specific resource templates in the resource registry.
 * Strictly registers agnostic domain resource types ('testcase', 'testrun', 'testplan', 'bug').
 */
export function registerGitHubResources(): void {
    resource.registry(githubTestcaseTemplate);
    resource.registry(githubTestrunTemplate);
    resource.registry(githubTestplanTemplate);
    resource.registry(githubBugTemplate);
}
