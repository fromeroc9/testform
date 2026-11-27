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
    buildGitHubTestcaseBody,
    buildGitHubTestrunBody,
    buildGitHubTestplanBody,
    buildGitHubBugBody,
} from './templates';

export const githubTestcaseTemplate: ResourceTemplate = {
    type: 'testcase',
    attributes: (s: ParserScenario) => ({
        title: s.name,
        body: buildGitHubTestcaseBody(s),
        labels: extractLabels(s),
        assignees: extractAssignees(s),
        milestone: s.custom?.fields?.milestone || undefined,
        metadata: extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach']) || {}
    }),
    state: {}
};

export const githubTestrunTemplate: ResourceTemplate = {
    type: 'testrun',
    attributes: (s: ParserScenario, context?: ResourceContext) => {
        const groupScenarios = s.custom?.groupScenarios || [];
        const statuses = groupScenarios.map((gs: ParserScenario) => getScenarioStatus(gs, 'pending'));
        const rollupStatus = calculateRollupVerdict(statuses, context?.config);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach', 'duration', 'trace']) || {};

        // El Status de GitHub Projects se alimenta del autocálculo del motor (rollupStatus),
        // pero si el usuario escribió explícitamente * field Status en el feature, ese valor manual manda.
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
            body: buildGitHubTestrunBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            metadata: meta
        };
    },
    state: {
        status: (s: ParserScenario, context?: ResourceContext) => {
            const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === 'status');
            const explicitVal = explicitEntry ? explicitEntry[1] : undefined;
            if (explicitVal !== undefined && String(explicitVal).trim() !== '') {
                return String(explicitVal).trim().toLowerCase();
            }
            const groupScenarios = s.custom?.groupScenarios || [];
            const statuses = groupScenarios.map((gs: ParserScenario) => getScenarioStatus(gs, 'pending'));
            return calculateRollupVerdict(statuses, context?.config);
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

export const githubTestplanTemplate: ResourceTemplate = {
    type: 'testplan',
    attributes: (s: ParserScenario, context?: ResourceContext) => {
        const rollupStatus = calculatePlanRollup(s, context);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach']) || {};

        // El Status de GitHub Projects se alimenta del autocálculo del motor (rollupStatus),
        // pero si el usuario escribió explícitamente * field Status en el feature, ese valor manual manda.
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
            body: buildGitHubTestplanBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            metadata: meta
        };
    },
    state: {
        status: (s: ParserScenario, context?: ResourceContext) => {
            const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === 'status');
            const explicitVal = explicitEntry ? explicitEntry[1] : undefined;
            if (explicitVal !== undefined && String(explicitVal).trim() !== '') {
                return String(explicitVal).trim().toLowerCase();
            }
            return calculatePlanRollup(s, context);
        },
        attach: (s: ParserScenario) => getScenarioEvidence(s),
        testruns: (s: ParserScenario, context?: ResourceContext) => extractPlanTestrunsMap(s, context)
    }
};

export const githubBugTemplate: ResourceTemplate = {
    type: 'bug',
    attributes: (s: ParserScenario, context?: ResourceContext) => {
        const setStatus = s.custom?.set?.status;
        const rawStatus = (setStatus !== undefined && setStatus !== null && String(setStatus).trim() !== '')
            ? String(setStatus).trim()
            : 'open';

        const meta = extractCustomFields(s.custom?.fields, [
            'labels', 'assignees', 'milestone', 'trace', 'error', 'evidence', 'attach', 'target', 'testcase', 'testrun', 'run'
        ]) || {};

        // En bug: * set status viaja IMPLÍCITAMENTE y directamente al campo Status del Tablero.
        // No aplica la sobreescritura manual de * field Status; * set status es el dueño de Status.
        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status')
            || Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status');
        if (statusFieldKey) {
            meta[statusFieldKey] = rawStatus;
        }

        // En bug: si * set run tiene valor (diferente de vacío, undefined o ""), viaja al campo 'linked' del tablero
        const rawRun = getScenarioValue(s, 'run') ?? getScenarioValue(s, 'testrun');
        if (rawRun !== undefined && rawRun !== null && String(rawRun).trim() !== '') {
            meta['linked'] = String(rawRun).trim();
        }

        return {
            title: s.name || s.feature?.name || '',
            body: buildGitHubBugBody(s, context),
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
        testrun: (s: ParserScenario) => getScenarioValue(s, 'run') ?? getScenarioValue(s, 'testrun')
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
