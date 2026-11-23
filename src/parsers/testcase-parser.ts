/**
 * @fileoverview Testcase parser.
 *
 * Specializes in extracting individual testcases from feature files.
 * Handles DSL field extraction from tags and steps, and removes consumed elements.
 */

import { BaseParser, FIELD_PATTERN } from './base-parser';
import { ITest, IScope, ParserScenario } from '../core/types';
import { normalizeScenarioAddress } from '../core/selector';

const VALID_SET_MARKS_BY_SCOPE: Record<string, { background: Set<string>; scenario: Set<string> }> = {
    testcase: {
        background: new Set(),
        scenario: new Set()
    },
    testrun: {
        background: new Set(['duration', 'attach', 'trace']),
        scenario: new Set(['status'])
    },
    bug: {
        background: new Set(['run']),
        scenario: new Set(['status', 'attach', 'trace', 'target'])
    },
    testplan: {
        background: new Set(['attach']),
        scenario: new Set()
    }
};

export class TestcaseParser extends BaseParser {
    public filter(scenarios: ParserScenario[], test: ITest, scope?: IScope): ParserScenario[] {
        const identityPattern = test.identity;
        const fields = test.fields || [];
        const { keywordFields, tagFields } = this.dslFields(fields);
        const identityMatcher = this.compileIdentityMatcher(identityPattern);

        for (const s of scenarios) {
            const rawTags = s.tags ? [...s.tags] : [];
            const rawSteps = s.background && s.background.steps && s.background.steps.length > 0
                ? [...s.background.steps.map((st: any) => ({ ...st })), ...(s.steps || []).map((st: any) => ({ ...st }))]
                : [...(s.steps || []).map((st: any) => ({ ...st }))];
            const customFields: Record<string, string> = {};
            const setMarks: Record<string, any> = {};

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

            s.tags = s.tags.filter((tag: any) => tag !== "@unique");

            if (tagToRemove) {
                s.tags = s.tags.filter((tag: any) => tag !== tagToRemove);
            }

            if (s.description) {
                const descMatch = s.description.match(/^\s*\*\s*set\s+status\s*=\s*(.*)$/im);
                if (descMatch) {
                    setMarks['status'] = descMatch[1]?.trim();
                }
            }

            const currentScopeKey = scope || 'testcase';
            const isCustomScope = !VALID_SET_MARKS_BY_SCOPE[currentScopeKey];
            const allowedBgMarks = VALID_SET_MARKS_BY_SCOPE[currentScopeKey]?.background ?? new Set(['duration', 'attach', 'trace', 'status']);
            const allowedScenMarks = VALID_SET_MARKS_BY_SCOPE[currentScopeKey]?.scenario ?? new Set(['status', 'attach', 'trace', 'duration', 'target', 'error']);

            if (s.background) {
                s.background.steps = s.background.steps.filter((step: any) => {
                    const setMatch = step.text.match(/^\s*(?:\*\s*)?set\s+([a-zA-Z0-9_-]+)\s*=\s*(.*)$/i);
                    if (setMatch) {
                        const setKey = setMatch[1].trim().toLowerCase();
                        const setVal = setMatch[2]?.trim();

                        if (currentScopeKey === 'testcase') {
                            (s.custom ??= {}).policy ??= [];
                            s.custom.policy!.push({
                                type: 'invalid-set-mark',
                                field: setKey,
                                message: `'set' is not allowed in testcase specifications. Use standard Gherkin steps or '* field ${setKey} = <value>' for metadata.`
                            });
                            return false;
                        }

                        if (currentScopeKey === 'testrun' && setKey === 'status') {
                            (s.custom ??= {}).policy ??= [];
                            s.custom.policy!.push({
                                type: 'invalid-set-mark',
                                field: setKey,
                                message: `Suite status in testruns is autocalculated from scenarios. Do not set status manually in Background.`
                            });
                            return false;
                        }

                        if (setKey === 'attach' && scope === 'bug') {
                            (s.custom ??= {}).policy ??= [];
                            s.custom.policy!.push({
                                type: 'attach-governance' as any,
                                field: setKey,
                                message: 'Attachments in bug specifications are prohibited in Background. Attachments must be specified at the Scenario level.'
                            } as any);
                            return false;
                        }

                        if (!allowedBgMarks.has(setKey)) {
                            (s.custom ??= {}).policy ??= [];
                            s.custom.policy!.push({
                                type: 'invalid-set-mark',
                                field: setKey,
                                message: `Mark "${setKey}" is not valid in Background for ${scope}. Allowed background marks: ${Array.from(allowedBgMarks).join(', ') || 'none'}.`
                            });
                            return false;
                        }

                        if (setKey === 'attach') {
                            let parsedVal: any = setVal;
                            try {
                                if (setVal.startsWith('[') && setVal.endsWith(']')) {
                                    parsedVal = JSON.parse(setVal);
                                }
                            } catch {
                                parsedVal = setVal;
                            }
                            setMarks['attach'] = parsedVal;
                        } else {
                            setMarks[setKey] = setVal;
                        }
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
                        if (tagFields.has(rawName)) {
                            s.custom.policy!.push({
                                type: 'tag-field-as-step',
                                field: rawName,
                                message: `Field "${rawName}" is configured with source: "tag" in main.yml. It cannot be defined as a step ("* field ${rawName}"). Use a tag (e.g. "@${rawName}") instead.`
                            });
                        } else {
                            s.custom.policy!.push({ type: 'undeclared-field', field: rawName });
                        }
                        return false;
                    }

                    customFields[fieldDef.name] = rawValue;
                    return false;
                });

                s.steps = [...s.background.steps, ...s.steps];
                s.background.steps = [];
            }

            s.steps = s.steps.filter((step: any) => {
                const setMatch = step.text.match(/^\s*(?:\*\s*)?set\s+([a-zA-Z0-9_-]+)\s*=\s*(.*)$/i);
                if (setMatch) {
                    const setKey = setMatch[1].trim().toLowerCase();
                    const setVal = setMatch[2]?.trim();

                    if (currentScopeKey === 'testcase') {
                        (s.custom ??= {}).policy ??= [];
                        s.custom.policy!.push({
                            type: 'invalid-set-mark',
                            field: setKey,
                            message: `'set' is not allowed in testcase specifications. Use standard Gherkin steps or '* field ${setKey} = <value>' for metadata.`
                        });
                        return false;
                    }

                    if (setKey === 'attach' && scope === 'testplan') {
                        (s.custom ??= {}).policy ??= [];
                        s.custom.policy!.push({
                            type: 'attach-governance' as any,
                            field: setKey,
                            message: 'Attachments in testplan specifications are only applicable in Background.'
                        } as any);
                        return false;
                    }

                    if (!allowedScenMarks.has(setKey)) {
                        (s.custom ??= {}).policy ??= [];
                        s.custom.policy!.push({
                            type: 'invalid-set-mark',
                            field: setKey,
                            message: `Mark "${setKey}" is not a valid execution mark for ${scope} scenarios. Allowed marks: ${Array.from(allowedScenMarks).join(', ') || 'none'}. If "${setKey}" is a contract field, use "* field ${setKey} = <value>".`
                        });
                        return false;
                    }

                    if (setKey === 'attach') {
                        let parsedVal: any = setVal;
                        try {
                            if (setVal.startsWith('[') && setVal.endsWith(']')) {
                                parsedVal = JSON.parse(setVal);
                            } else {
                                parsedVal = setVal;
                            }
                        } catch {
                            parsedVal = setVal;
                        }
                        setMarks['attach'] = parsedVal;
                    } else {
                        setMarks[setKey] = setVal;
                    }
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
                    if (tagFields.has(rawName)) {
                        s.custom.policy!.push({
                            type: 'tag-field-as-step',
                            field: rawName,
                            message: `Field "${rawName}" is configured with source: "tag" in main.yml. It cannot be defined as a step ("* field ${rawName}"). Use a tag (e.g. "@${rawName}") instead.`
                        });
                    } else {
                        s.custom.policy!.push({ type: 'undeclared-field', field: rawName });
                    }
                    return false;
                }

                customFields[fieldDef.name] = rawValue;
                return false;
            });

            const tagFilter = (tag: string) => {
                for (const fieldDef of tagFields.values()) {
                    const rawEnum = fieldDef.enum ?? (fieldDef as any).values;
                    const enumValues = Array.isArray(rawEnum)
                        ? rawEnum
                        : typeof rawEnum === "string"
                            ? [rawEnum]
                            : [];

                    if (enumValues.includes(tag)) {
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

            if (scope === 'bug' && !customFields['target']) {
                let targetTag = '';
                let targetAddr = '';

                for (const t of rawTags) {
                    const cleanTag = t.startsWith('@') ? t.substring(1) : t;
                    const m = cleanTag.match(/^depends_on\s*\(\s*(.*?)\s*\)$/i);
                    if (m) {
                        const inner = m[1].trim().replace(/^['"]|['"]$/g, '');
                        if (inner.includes('.feature') || inner.includes('/')) {
                            targetAddr = inner;
                        } else if (inner.startsWith('@') || /^[a-zA-Z0-9_-]+$/.test(inner)) {
                            targetTag = inner.startsWith('@') ? inner : `@${inner}`;
                        }
                    }
                }

                if (!targetTag && !targetAddr) {
                    const tcTag = rawTags.find(t => /^@tc(-\d+)?$/i.test(t));
                    if (tcTag) {
                        targetTag = tcTag;
                    }
                }

                if (s.rule?.name) {
                    const ruleFile = s.rule.name.trim();
                    if (targetTag) {
                        setMarks['target'] = normalizeScenarioAddress(ruleFile, targetTag);
                    } else if (targetAddr) {
                        setMarks['target'] = normalizeScenarioAddress(ruleFile, targetAddr);
                    }
                } else if (targetAddr) {
                    setMarks['target'] = targetAddr;
                } else if (targetTag) {
                    setMarks['target'] = targetTag;
                }
            }

            s.custom = {
                ...(s.custom ?? {}),
                identity: identityValue,
                fields: customFields,
                set: setMarks,
                rawTags,
                rawSteps,
            };
        }

        return scenarios;
    }
}
