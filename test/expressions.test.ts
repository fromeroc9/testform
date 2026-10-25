import { describe, it, expect } from 'vitest';
import { evaluateExpression, interpolateExpressions } from '../src/core/expressions/evaluator';

describe('AST Expression Engine', () => {
    describe('Text Functions', () => {
        it('should evaluate lower and upper', () => {
            expect(evaluateExpression('lower("HELLO WORLD")')).toBe('hello world');
            expect(evaluateExpression('upper("hello world")')).toBe('HELLO WORLD');
        });

        it('should evaluate trim, trimprefix, trimsuffix', () => {
            expect(evaluateExpression('trim("   padded   ")')).toBe('padded');
            expect(evaluateExpression('trimprefix("https://api.com", "https://")')).toBe('api.com');
            expect(evaluateExpression('trimsuffix("file.case.feature", ".feature")')).toBe('file.case');
        });

        it('should evaluate split, join, replace, format, substr', () => {
            expect(evaluateExpression('split(",", "a,b,c")')).toEqual(['a', 'b', 'c']);
            expect(evaluateExpression('join("-", ["alpha", "beta", "gamma"])')).toBe('alpha-beta-gamma');
            expect(evaluateExpression('replace("foo-bar-foo", "foo", "baz")')).toBe('baz-bar-baz');
            expect(evaluateExpression('format("https://%s:%d/api", "localhost", 8080)')).toBe('https://localhost:8080/api');
            expect(evaluateExpression('substr("Testform", 0, 4)')).toBe('Test');
        });
    });

    describe('Logic and Collections', () => {
        it('should evaluate coalesce', () => {
            expect(evaluateExpression('coalesce("", null, "default")')).toBe('default');
            expect(evaluateExpression('coalesce("first", "second")')).toBe('first');
        });

        it('should evaluate contains with array and string', () => {
            expect(evaluateExpression('contains(["dev", "staging", "prod"], "staging")')).toBe(true);
            expect(evaluateExpression('contains(["dev", "staging", "prod"], "test")')).toBe(false);
            expect(evaluateExpression('contains("regression-suite", "suite")')).toBe(true);
        });

        it('should evaluate length, element, slice', () => {
            expect(evaluateExpression('length(["a", "b", "c"])')).toBe(3);
            expect(evaluateExpression('length("hello")')).toBe(5);
            expect(evaluateExpression('element(["zero", "one", "two"], 1)')).toBe('one');
            expect(evaluateExpression('slice(["a", "b", "c", "d"], 1, 3)')).toEqual(['b', 'c']);
        });
    });

    describe('Binary and Comparison Operators', () => {
        it('should evaluate logical AND, OR, NOT and equality', () => {
            const ctx = {
                vars: {
                    concurrency: 25,
                    environment: 'staging'
                }
            };
            expect(evaluateExpression('var.concurrency > 0 && var.concurrency <= 100', ctx)).toBe(true);
            expect(evaluateExpression('var.concurrency > 50 || var.environment == "staging"', ctx)).toBe(true);
            expect(evaluateExpression('!(var.environment == "prod")', ctx)).toBe(true);
            expect(evaluateExpression('var.concurrency == 25', ctx)).toBe(true);
            expect(evaluateExpression('var.concurrency != 50', ctx)).toBe(true);
        });
    });

    describe('Template Interpolation', () => {
        it('should interpolate nested expressions in strings', () => {
            const ctx = {
                vars: {
                    host: "qa-server.internal",
                    env: "STAGING"
                },
                locals: {
                    base_path: "/v2"
                }
            };
            const result = interpolateExpressions('https://${lower(var.env)}.${var.host}${local.base_path}/health', ctx);
            expect(result).toBe('https://staging.qa-server.internal/v2/health');
        });
    });
});
