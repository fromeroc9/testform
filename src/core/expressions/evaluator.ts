import { ASTNode, EvaluationContext } from './types';
import { standardFunctions } from './functions';
import { Lexer } from './lexer';
import { Parser } from './parser';

export class Evaluator {
    evaluate(node: ASTNode, ctx: EvaluationContext = {}): any {
        switch (node.type) {
            case 'Literal':
                return node.value;

            case 'Array':
                return node.elements.map(el => this.evaluate(el, ctx));

            case 'Identifier':
                return this.resolveIdentifier(node.name, ctx);

            case 'Unary': {
                const arg = this.evaluate(node.argument, ctx);
                if (node.operator === '!') {
                    return !this.isTruthy(arg);
                }
                if (node.operator === '-') {
                    return -Number(arg);
                }
                throw new Error(`Unsupported unary operator: '${node.operator}'`);
            }

            case 'Binary': {
                const left = this.evaluate(node.left, ctx);

                // Short-circuit logical operators
                if (node.operator === '&&') {
                    if (!this.isTruthy(left)) return false;
                    const right = this.evaluate(node.right, ctx);
                    return this.isTruthy(right);
                }
                if (node.operator === '||') {
                    if (this.isTruthy(left)) return true;
                    const right = this.evaluate(node.right, ctx);
                    return this.isTruthy(right);
                }

                const right = this.evaluate(node.right, ctx);

                switch (node.operator) {
                    case '==':
                        if (left === right) return true;
                        // Loose comparison for numbers as strings
                        if (typeof left === 'number' || typeof right === 'number') {
                            return Number(left) === Number(right);
                        }
                        return String(left ?? '') === String(right ?? '');

                    case '!=':
                        if (left === right) return false;
                        if (typeof left === 'number' || typeof right === 'number') {
                            return Number(left) !== Number(right);
                        }
                        return String(left ?? '') !== String(right ?? '');

                    case '<':
                        return Number(left) < Number(right);
                    case '<=':
                        return Number(left) <= Number(right);
                    case '>':
                        return Number(left) > Number(right);
                    case '>=':
                        return Number(left) >= Number(right);

                    case '+':
                        if (typeof left === 'string' || typeof right === 'string') {
                            return String(left ?? '') + String(right ?? '');
                        }
                        return Number(left) + Number(right);

                    case '-':
                        return Number(left) - Number(right);
                    case '*':
                        return Number(left) * Number(right);
                    case '/':
                        return Number(left) / Number(right);

                    default:
                        throw new Error(`Unsupported binary operator: '${node.operator}'`);
                }
            }

            case 'Call': {
                const fnName = node.callee.toLowerCase();
                const fn = ctx.extraFunctions?.[fnName] || standardFunctions[fnName];
                if (!fn) {
                    throw new Error(`Unknown function: '${node.callee}()'`);
                }
                const evaluatedArgs = node.args.map(argNode => this.evaluate(argNode, ctx));
                // Provide workDir to file() if needed
                if (fnName === 'file' && evaluatedArgs.length === 1 && ctx.workDir) {
                    evaluatedArgs.push(ctx.workDir);
                }
                return fn(...evaluatedArgs);
            }

            default:
                throw new Error(`Unknown AST node type: ${(node as any).type}`);
        }
    }

    private resolveIdentifier(name: string, ctx: EvaluationContext): any {
        // Handle var.NAME
        if (name.startsWith('var.')) {
            const key = name.slice(4);
            return (ctx.vars || ctx.variables)?.[key];
        }

        // Handle local.NAME
        if (name.startsWith('local.')) {
            const key = name.slice(6);
            return ctx.locals?.[key];
        }

        // Handle env.NAME
        if (name.startsWith('env.')) {
            const key = name.slice(4);
            return process.env[key] ?? '';
        }

        // Handle data.PATH
        if (name.startsWith('data.')) {
            const key = name.slice(5);
            if (ctx.data && typeof ctx.data.resolvePath === 'function') {
                return ctx.data.resolvePath(key);
            }
            return ctx.data?.[key];
        }

        // Fallback: direct name in vars or locals
        if (ctx.vars && name in ctx.vars) {
            return ctx.vars[name];
        }
        if (ctx.locals && name in ctx.locals) {
            return ctx.locals[name];
        }

        return undefined;
    }

    private isTruthy(val: any): boolean {
        if (val === false || val === null || val === undefined || val === 0 || val === '') {
            return false;
        }
        return true;
    }
}

export const evaluator = new Evaluator();

/**
 * Parses and evaluates an expression string (e.g. "${lower(var.env)}" or "var.count > 0").
 */
export function evaluateExpression(expr: string, context: EvaluationContext = {}): any {
    const lexer = new Lexer(expr);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return evaluator.evaluate(ast, context);
}

/**
 * Interpolates all ${...} expressions inside a template string.
 * Example: "https://${var.host}:${var.port}/api" -> "https://localhost:8080/api"
 */
export function interpolateExpressions(template: string, context: EvaluationContext = {}): string {
    if (typeof template !== 'string' || !template.includes('${')) {
        return template;
    }

    return template.replace(/\$\{([^}]+)\}/g, (match, expr) => {
        try {
            const res = evaluateExpression(expr, context);
            if (res === null || res === undefined) return '';
            if (typeof res === 'object') return JSON.stringify(res);
            return String(res);
        } catch {
            return match; // Keep unchanged on expression parse/eval failure
        }
    });
}
