/**
 * Programmatic SDK entrypoint for @fromeroc9/testform.
 * Exposes shared Gherkin parsing, plan calculation, state inspection,
 * attribute drift comparison, diagnostics, and report generation helpers.
 */

export * from './core/const';
export * from './core/types';
export { Config } from './core/config';
export { State } from './core/state';
export { LocalBackend } from './backends/local';
export { resource, registerResource } from './core/resources';
export { policy, registerPolicy } from './core/policy';
export { evaluateExpression, interpolateExpressions } from './core/expressions/evaluator';
export { Parser } from './core/parser';
export { BaseParser } from './parsers/base-parser';
export { TestcaseParser } from './parsers/testcase-parser';
export { TestrunParser } from './parsers/testrun-parser';
export { TestplanParser } from './parsers/testplan-parser';
export { VariableParser } from './core/variables';
export { calculatePlan, hashScenario } from './commands/plan';
export type { CalculatePlanOptions } from './commands/plan';
export {
    detectAttributeDrift,
    compareCustomFields,
    arraysEqual,
} from './core/sync';
export type { DriftDetectionResult } from './core/sync';
export * from './core/diagnostics';
export * from './reports';
