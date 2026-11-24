import { ResourceTemplate, ParserScenario, ResourceContext } from '../../core/types';
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
    buildGitLabTestcaseBody,
    buildGitLabTestrunBody,
    buildGitLabTestplanBody,
    buildGitLabBugBody,
} from './templates';

export const gitlabTestcaseTemplate: ResourceTemplate = {
    type: 'testcase',
    attributes: (s: ParserScenario) => ({
        title: s.name,
        body: buildGitLabTestcaseBody(s),
        labels: extractLabels(s),
        assignees: extractAssignees(s),
        milestone: s.custom?.fields?.milestone || undefined,
        metadata: extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status', 'evidence', 'attach']) || {}
    }),
    state: {}
};

export const gitlabTestrunTemplate: ResourceTemplate = {
    type: 'testrun',
    attributes: (s: ParserScenario, context?: ResourceContext) => {
        const groupScenarios = s.custom?.groupScenarios || [];
        const statuses = groupScenarios.map((gs: ParserScenario) => getScenarioStatus(gs, 'pending'));
        const rollupStatus = calculateRollupVerdict(statuses, context?.config);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach', 'duration', 'trace']) || {};

        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status')
            || Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status');
        if (statusFieldKey) {
            const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === 'status');
            const explicitVal = explicitEntry ? explicitEntry[1] : undefined;
            if (explicitVal !== undefined && explicitVal !== '') {
                meta[statusFieldKey] = explicitVal;
            } else {
                meta[statusFieldKey] = rollupStatus;
            }
        }

        return {
            title: s.feature?.name || '',
            body: buildGitLabTestrunBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            metadata: meta
        };
    },
    state: {
        status: (s: ParserScenario) => {
            const groupScenarios = s.custom?.groupScenarios || [];
            const statuses = groupScenarios.map((gs: ParserScenario) => getScenarioStatus(gs, 'pending'));
            return calculateRollupVerdict(statuses);
        },
        duration: (s: ParserScenario) => getScenarioValue(s, 'duration'),
        attach: (s: ParserScenario) => getScenarioEvidence(s),
        trace: (s: ParserScenario) => getScenarioTrace(s),
        testcases: (s: ParserScenario) => extractTestcaseStatusMap(s),
        testcaseTraces: (s: ParserScenario) => {
            const map = extractTestcaseTraceMap(s);
            return Object.keys(map).length > 0 ? map : undefined;
        },
        testcaseEvidence: (s: ParserScenario) => {
            const map = extractTestcaseEvidenceMap(s);
            return Object.keys(map).length > 0 ? map : undefined;
        }
    }
};

export const gitlabTestplanTemplate: ResourceTemplate = {
    type: 'testplan',
    attributes: (s: ParserScenario, context?: ResourceContext) => {
        const rollupStatus = calculatePlanRollup(s, context);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach']) || {};

        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status')
            || Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status');
        if (statusFieldKey) {
            const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === 'status');
            const explicitVal = explicitEntry ? explicitEntry[1] : undefined;
            if (explicitVal !== undefined && explicitVal !== '') {
                meta[statusFieldKey] = explicitVal;
            } else {
                meta[statusFieldKey] = rollupStatus;
            }
        }

        return {
            title: s.feature?.name || '',
            body: buildGitLabTestplanBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            metadata: meta
        };
    },
    state: {
        status: (s: ParserScenario, context?: ResourceContext) => calculatePlanRollup(s, context),
        attach: (s: ParserScenario) => getScenarioEvidence(s),
        testruns: (s: ParserScenario, context?: ResourceContext) => extractPlanTestrunsMap(s, context)
    }
};

export const gitlabBugTemplate: ResourceTemplate = {
    type: 'bug',
    attributes: (s: ParserScenario) => {
        const setStatus = s.custom?.set?.status;
        const rawStatus = (setStatus !== undefined && setStatus !== null && String(setStatus).trim() !== '')
            ? String(setStatus).trim()
            : 'open';

        const meta = extractCustomFields(s.custom?.fields, [
            'labels', 'assignees', 'milestone', 'trace', 'error', 'evidence', 'attach', 'target', 'testcase', 'testrun', 'run'
        ]) || {};

        // En bug: * set status viaja IMPLÍCITAMENTE y directamente al campo Status del Tablero.
        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status')
            || Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status');
        if (statusFieldKey) {
            meta[statusFieldKey] = rawStatus;
        }

        return {
            title: s.name || s.feature?.name || '',
            body: buildGitLabBugBody(s),
            labels: extractLabels(s, 'bug'),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            metadata: meta
        };
    },
    state: {
        status: (s: ParserScenario) => {
            const setStatus = s.custom?.set?.status;
            return (setStatus !== undefined && setStatus !== null && String(setStatus).trim() !== '')
                ? String(setStatus).trim()
                : 'open';
        },
        trace: (s: ParserScenario) => getScenarioTrace(s),
        attach: (s: ParserScenario) => getScenarioEvidence(s),
        testcase: (s: ParserScenario) => getScenarioValue(s, 'target') ?? getScenarioValue(s, 'testcase'),
        testrun: (s: ParserScenario) => getScenarioValue(s, 'run') ?? s.feature?.name ?? getScenarioValue(s, 'testrun')
    }
};

/**
 * Registers GitLab-specific resource templates in the resource registry.
 * Strictly registers agnostic domain resource types ('testcase', 'testrun', 'testplan', 'bug').
 */
export function registerGitLabResources(): void {
    resource.registry(gitlabTestcaseTemplate);
    resource.registry(gitlabTestrunTemplate);
    resource.registry(gitlabTestplanTemplate);
    resource.registry(gitlabBugTemplate);
}
