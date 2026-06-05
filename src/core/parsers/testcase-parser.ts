/**
 * @fileoverview Testcase parser.
 *
 * Specializes in extracting individual testcases from feature files.
 * Handles DSL field extraction from tags and steps, and removes consumed elements.
 */

import { BaseParser, FIELD_PATTERN } from './base-parser';
import { ITest, IScope, ParserScenario } from '../../types';

export class TestcaseParser extends BaseParser {
    public filter(scenarios: ParserScenario[], test: ITest, scope?: IScope): ParserScenario[] {
        const identityPattern = test.identity;
        const fields = test.fields || [];
        const { keywordFields, tagFields } = this.dslFields(fields);
        const identityMatcher = this.compileIdentityMatcher(identityPattern);

        for (const s of scenarios) {
            const customFields: Record<string, string> = {};

            if (scope) {
                const scopeTag = `@${scope}`;
                if (!s.tags) s.tags = [];
                if (!s.tags.includes(scopeTag)) {
                    s.tags.push(scopeTag);
                }
            }

            const { identityValue, tagToRemove } = identityMatcher
                ? this.matchIdentity(s.tags, identityMatcher)
                : {};

            s.tags = s.tags.filter((tag) => tag !== "@unique");

            if (tagToRemove) {
                s.tags = s.tags.filter((tag) => tag !== tagToRemove);
            }

            if (s.description) {
                const descMatch = s.description.match(/^\s*\*\s*link\s+status\s*=\s*(.*)$/im);
                if (descMatch) {
                    customFields['status'] = descMatch[1]?.trim();
                }
            }

            if (s.background) {
                s.background.steps = s.background.steps.filter((step) => {
                    const linkMatch = step.text.match(/^\s*\*\s*link\s+status\s*=\s*(.*)$/i);
                    if (linkMatch) {
                        customFields['status'] = linkMatch[1]?.trim();
                        return false;
                    }

                    const match = step.text.match(FIELD_PATTERN);
                    if (!match) return true;

                    const rawName = match[1]?.trim().toLowerCase();
                    const rawValue = match[2]?.trim();
                    if (!rawName || rawValue === undefined) return true;

                    const fieldDef = keywordFields.get(rawName);
                    if (!fieldDef) {
                        (s.custom ??= {}).policy ??= [];
                        s.custom.policy!.push({ type: 'undeclared-field', field: rawName });
                        return true;
                    }

                    customFields[fieldDef.name] = rawValue;
                    return false;
                });

                s.steps = [...s.background.steps, ...s.steps];
                s.background.steps = [];
            }

            s.steps = s.steps.filter((step) => {
                const linkMatch = step.text.match(/^\s*\*\s*link\s+status\s*=\s*(.*)$/i);
                if (linkMatch) {
                    customFields['status'] = linkMatch[1]?.trim();
                    return false;
                }

                const match = step.text.match(FIELD_PATTERN);
                if (!match) return true;

                const rawName = match[1]?.trim().toLowerCase();
                const rawValue = match[2]?.trim();
                if (!rawName || rawValue === undefined) return true;

                const fieldDef = keywordFields.get(rawName);
                if (!fieldDef) {
                    (s.custom ??= {}).policy ??= [];
                    s.custom.policy!.push({ type: 'undeclared-field', field: rawName });
                    return true;
                }

                customFields[fieldDef.name] = rawValue;
                return false;
            });

            const tagFilter = (tag: string) => {
                for (const fieldDef of tagFields.values()) {
                    const values = Array.isArray(fieldDef.values)
                        ? fieldDef.values
                        : typeof fieldDef.values === "string"
                            ? [fieldDef.values]
                            : [];

                    if (values.includes(tag)) {
                        customFields[fieldDef.name] = tag;
                        return false;
                    }
                }
                return true;
            };

            s.tags = s.tags.filter(tagFilter);
            if (s.feature && s.feature.tags) {
                s.feature.tags = s.feature.tags.filter(tagFilter);
            }

            for (const fieldDef of fields) {
                if (customFields[fieldDef.name] === undefined && fieldDef.default !== undefined) {
                    const defaultVal = Array.isArray(fieldDef.default) ? fieldDef.default[0] : fieldDef.default;
                    if (defaultVal !== undefined) {
                        customFields[fieldDef.name] = defaultVal;
                    }
                }

                if (fieldDef.required && !customFields[fieldDef.name]) {
                    (s.custom ??= {}).policy ??= [];
                    s.custom.policy!.push({ type: 'required-field', field: fieldDef.name });
                    customFields[fieldDef.name] = "";
                } else if (customFields[fieldDef.name] === undefined) {
                    customFields[fieldDef.name] = "";
                }
            }

            s.custom = {
                ...(s.custom ?? {}),
                identity: identityValue,
                fields: customFields,
            };
        }

        return scenarios;
    }
}
