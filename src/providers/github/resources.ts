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
    attributes: (s: any) => {
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach']) || {};
        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status');
        const rawStatus = statusFieldKey ? String(meta[statusFieldKey]).trim().toLowerCase() : '';
        const isClosed = rawStatus === 'done' || rawStatus === 'closed' || rawStatus === 'resolved';

        return {
            title: s.name,
            body: buildGitHubTestcaseBody(s),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: isClosed ? 'closed' : 'open',
            metadata: meta
        };
    },
    state: {}
};

export const githubTestrunTemplate: ResourceTemplate = {
    type: 'testrun',
    attributes: (s: any, context?: any) => {
        const groupScenarios = s.custom?.groupScenarios || [];
        const statuses = groupScenarios.map((gs: any) => getScenarioStatus(gs, 'pending'));
        const rollupStatus = calculateRollupVerdict(statuses, context?.config);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach', 'duration', 'trace']) || {};

        // El Status de GitHub Projects se alimenta del autocálculo del motor (rollupStatus),
        // pero si el usuario escribió explícitamente * field Status en el feature, ese valor manual manda.
        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status')
            || Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status')
            || 'Status';
        const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === 'status');
        const explicitVal = explicitEntry ? explicitEntry[1] : undefined;
        if (explicitVal !== undefined && explicitVal !== '') {
            meta[statusFieldKey] = explicitVal;
        } else {
            meta[statusFieldKey] = rollupStatus;
        }

        const effectiveStatus = String(meta[statusFieldKey] || rollupStatus).toLowerCase();
        const isClosed = ['passed', 'success', 'exitoso', 'done', 'closed', 'resolved'].includes(effectiveStatus);

        return {
            title: s.feature?.name || '',
            body: buildGitHubTestrunBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: isClosed ? 'closed' : 'open',
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

        // El Status de GitHub Projects se alimenta del autocálculo del motor (rollupStatus),
        // pero si el usuario escribió explícitamente * field Status en el feature, ese valor manual manda.
        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status')
            || Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status')
            || 'Status';
        const explicitEntry = Object.entries(s.custom?.explicitFields || {}).find(([k]) => k.toLowerCase() === 'status');
        const explicitVal = explicitEntry ? explicitEntry[1] : undefined;
        if (explicitVal !== undefined && explicitVal !== '') {
            meta[statusFieldKey] = explicitVal;
        } else {
            meta[statusFieldKey] = rollupStatus;
        }

        const effectiveStatus = String(meta[statusFieldKey] || rollupStatus).toLowerCase();
        const isClosed = ['passed', 'success', 'exitoso', 'done', 'closed', 'resolved'].includes(effectiveStatus);

        return {
            title: s.feature?.name || '',
            body: buildGitHubTestplanBody(s, context),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: isClosed ? 'closed' : 'open',
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
    attributes: (s: any, context?: any) => {
        const setStatus = s.custom?.set?.status;
        const rawStatus = (setStatus !== undefined && setStatus !== null && String(setStatus).trim() !== '')
            ? String(setStatus).trim()
            : 'open';

        let category = 'open';
        if (context?.config && typeof context.config.resolveStatusCategory === 'function') {
            category = context.config.resolveStatusCategory('bug', rawStatus);
        } else {
            const clean = rawStatus.toLowerCase();
            if (['closed', 'resolved', 'cerrado', 'resuelto'].includes(clean)) category = 'closed';
            else if (['in_progress', 'en_progreso', 'en_atencion'].includes(clean)) category = 'in_progress';
        }
        const isClosed = category === 'closed' || category === 'resolved';

        const meta = extractCustomFields(s.custom?.fields, [
            'labels', 'assignees', 'milestone', 'trace', 'error', 'evidence', 'attach', 'target', 'testcase', 'testrun', 'run'
        ]) || {};

        // En bug: * set status viaja IMPLÍCITAMENTE y directamente al campo Status del Tablero.
        // No aplica la sobreescritura manual de * field Status; * set status es el dueño de Status.
        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status')
            || Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status')
            || 'Status';
        meta[statusFieldKey] = rawStatus;

        return {
            title: s.name || s.feature?.name || '',
            body: buildGitHubBugBody(s),
            labels: extractLabels(s, 'bug'),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: isClosed ? 'closed' : 'open',
            metadata: meta
        };
    },
    state: {
        status: (s: any) => {
            const setStatus = s.custom?.set?.status;
            return (setStatus !== undefined && setStatus !== null && String(setStatus).trim() !== '')
                ? String(setStatus).trim()
                : 'open';
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
