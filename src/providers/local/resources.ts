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
    attributes: (s: any) => {
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'status', 'evidence', 'attach']) || {};
        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status');
        const rawStatus = statusFieldKey ? String(meta[statusFieldKey]).trim().toLowerCase() : '';
        const isClosed = rawStatus === 'done' || rawStatus === 'closed' || rawStatus === 'resolved';

        return {
            title: s.name,
            body: buildLocalTestcaseBody(s),
            labels: extractLabels(s),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: isClosed ? 'closed' : 'open',
            metadata: meta
        };
    },
    state: {}
};

export const localTestrunTemplate: ResourceTemplate = {
    type: 'testrun',
    attributes: (s: any, context?: any) => {
        const groupScenarios = s.custom?.groupScenarios || [];
        const statuses = groupScenarios.map((gs: any) => getScenarioStatus(gs, 'pending'));
        const rollupStatus = calculateRollupVerdict(statuses, context?.config);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach', 'duration', 'trace']) || {};

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
            body: buildLocalTestrunBody(s, context),
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

export const localTestplanTemplate: ResourceTemplate = {
    type: 'testplan',
    attributes: (s: any, context?: any) => {
        const rollupStatus = calculatePlanRollup(s, context);
        const meta = extractCustomFields(s.custom?.fields, ['labels', 'assignees', 'milestone', 'evidence', 'attach']) || {};

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
            body: buildLocalTestplanBody(s, context),
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

export const localBugTemplate: ResourceTemplate = {
    type: 'bug',
    attributes: (s: any, context?: any) => {
        const rawStatus = getScenarioStatus(s, 'open');
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
        const statusFieldKey = Object.keys(meta).find(k => k.toLowerCase() === 'status')
            || Object.keys(s.custom?.fields || {}).find(k => k.toLowerCase() === 'status')
            || 'Status';
        meta[statusFieldKey] = rawStatus;

        return {
            title: s.name || s.feature?.name || '',
            body: buildLocalBugBody(s),
            labels: extractLabels(s, 'bug'),
            assignees: extractAssignees(s),
            milestone: s.custom?.fields?.milestone || undefined,
            state: isClosed ? 'closed' : 'open',
            metadata: meta
        };
    },
    state: {
        status: (s: any) => getScenarioStatus(s, 'open'),
        trace: (s: any) => getScenarioTrace(s),
        attach: (s: any) => getScenarioEvidence(s),
        testcase: (s: any) => getScenarioValue(s, 'target') ?? getScenarioValue(s, 'testcase'),
        testrun: (s: any) => getScenarioValue(s, 'run') ?? s.feature?.name ?? getScenarioValue(s, 'testrun')
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
