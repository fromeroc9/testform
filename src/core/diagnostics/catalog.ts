import { TITLE_CLI } from '../const';
import { Diagnostic } from './diagnostic';
import { DiagnosticProps, SourceLocation } from './types';

export interface ImplicitRuleDiagProps {
    file: string;
    line?: number;
    rule: string;
    scenario: string;
    target: string;
}

export interface TargetNotFoundDiagProps {
    scopeKey: string;
    target: string;
    suggestion?: string;
}

export interface AmbiguousTargetDiagProps {
    scopeKey: string;
    target: string;
    matches: string[];
}

export interface TestcaseNotFoundDiagProps {
    identifier: string;
    target: string;
    available?: string[];
}

export interface AmbiguousTestcaseDiagProps {
    identifier: string;
    target: string;
    matches: string[];
    command?: string;
    status?: string;
}

export interface UsageDiagProps {
    syntax: string;
    detail?: string[];
    help?: string[];
}

export interface UnknownSubcommandDiagProps {
    command: string;
    subcommand: string;
    available: string[];
}

export interface StructureErrorDiagProps {
    file: string;
    message: string;
    detail?: string[];
    location?: SourceLocation;
}

export class Diag {
    /** Generic error diagnostic */
    static error(props: DiagnosticProps): Diagnostic {
        return new Diagnostic({ ...props, type: 'error' });
    }

    /** Generic warning diagnostic */
    static warning(props: DiagnosticProps): Diagnostic {
        return new Diagnostic({ ...props, type: 'warning' });
    }

    /** Diagnostic when attempting to mark status on an unexpanded implicit rule */
    static implicitRule(props: ImplicitRuleDiagProps): Diagnostic {
        return new Diagnostic({
            type: 'error',
            title: 'Cannot mark status on implicit rule',
            location: {
                file: props.file,
                line: props.line,
                scope: `rule "${props.rule}"`,
                snippet: props.line ? `Rule: ${props.rule}` : undefined,
            },
            detail: [
                `Scenario "${props.scenario}" belongs to the implicit Rule "${props.rule}".`,
                `Testform requires explicit Scenario blocks in order to track and record execution outcomes.`,
            ],
            help: [
                `To expand this rule into explicit scenarios with initial pending status, run:`,
                `  ${TITLE_CLI} suite fill -target="${props.target}"`,
            ],
        });
    }

    /** Diagnostic when a target resource (testrun, testplan, etc.) is not found */
    static targetNotFound(props: TargetNotFoundDiagProps): Diagnostic {
        return new Diagnostic({
            type: 'error',
            title: `No ${props.scopeKey} matched target '${props.target}'.`,
            detail: [
                props.suggestion || `Run \`${TITLE_CLI} state list\` to list available resources.`,
            ],
        });
    }

    /** Diagnostic when a target query matches multiple resources */
    static ambiguousTarget(props: AmbiguousTargetDiagProps): Diagnostic {
        const matchesFormatted = Array.from(new Set(props.matches.map(m => m.startsWith('  -') ? m : `  - ${m}`)));
        return new Diagnostic({
            type: 'error',
            title: `Multiple ${props.scopeKey} files matched '${props.target}'. Please specify a full path or identity tag.`,
            detail: matchesFormatted,
        });
    }

    /** Diagnostic when a testcase is not found within a testrun */
    static testcaseNotFound(props: TestcaseNotFoundDiagProps): Diagnostic {
        const availableLines = (props.available && props.available.length > 0)
            ? [
                `Available testcases in this run (up to 10):`,
                ...props.available.slice(0, 10).map(k => k.startsWith('  -') ? k : `  - ${k}`),
                ``,
            ]
            : [];

        return new Diagnostic({
            type: 'error',
            title: `Testcase '${props.identifier}' not found in testrun '${props.target}'.`,
            detail: [
                ...availableLines,
                `Accepted identity strategies:`,
                `  1. Only tag:       "@tc-1=passed"`,
                `  2. File + tag:     "checkout.case.feature.@tc-1=passed"`,
                `  3. Scenario name:  "Pago con tarjeta=passed"`,
            ],
        });
    }

    /** Diagnostic when a testcase query matches multiple scenarios */
    static ambiguousTestcase(props: AmbiguousTestcaseDiagProps): Diagnostic {
        const cmd = props.command || 'mark';
        const st = props.status || 'passed';
        const matchesFormatted = props.matches.map(k => k.startsWith('  -') ? k : `  - ${k}`);

        return new Diagnostic({
            type: 'error',
            title: `Multiple testcases matched '${props.identifier}' in testrun '${props.target}'.`,
            detail: [
                `Matches:`,
                ...matchesFormatted,
                ``,
                `Please specify the feature file to disambiguate:`,
                `  e.g. ${TITLE_CLI} suite ${cmd} "<file>.${props.identifier}=${st}" -target="${props.target}"`,
            ],
        });
    }

    /** Diagnostic for CLI command usage errors */
    static usage(props: UsageDiagProps): Diagnostic {
        return new Diagnostic({
            type: 'error',
            title: `Usage: ${props.syntax}`,
            detail: props.detail,
            help: props.help,
        });
    }

    /** Diagnostic when an unknown subcommand is invoked */
    static unknownSubcommand(props: UnknownSubcommandDiagProps): Diagnostic {
        return new Diagnostic({
            type: 'error',
            title: `Unknown ${props.command} subcommand: '${props.subcommand}'`,
            detail: props.available.length > 0
                ? [`Available subcommands: ${props.available.join(', ')}`]
                : [],
        });
    }

    /** Diagnostic for AST / structure issues in a feature file */
    static structureError(props: StructureErrorDiagProps): Diagnostic {
        return new Diagnostic({
            type: 'error',
            title: props.message,
            location: props.location || { file: props.file },
            detail: props.detail || [],
        });
    }
}
