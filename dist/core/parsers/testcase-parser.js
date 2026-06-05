"use strict";
/**
 * @fileoverview Testcase parser.
 *
 * Specializes in extracting individual testcases from feature files.
 * Handles DSL field extraction from tags and steps, and removes consumed elements.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestcaseParser = void 0;
const base_parser_1 = require("./base-parser");
class TestcaseParser extends base_parser_1.BaseParser {
    filter(scenarios, test, scope) {
        const identityPattern = test.identity;
        const fields = test.fields || [];
        const { keywordFields, tagFields } = this.dslFields(fields);
        const identityMatcher = this.compileIdentityMatcher(identityPattern);
        for (const s of scenarios) {
            const customFields = {};
            if (scope) {
                const scopeTag = `@${scope}`;
                if (!s.tags)
                    s.tags = [];
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
            if (s.background) {
                s.background.steps = s.background.steps.filter((step) => {
                    const match = step.text.match(base_parser_1.FIELD_PATTERN);
                    if (!match)
                        return true;
                    const rawName = match[1]?.trim().toLowerCase();
                    const rawValue = match[2]?.trim();
                    if (!rawName || rawValue === undefined)
                        return true;
                    const fieldDef = keywordFields.get(rawName);
                    if (!fieldDef) {
                        (s.custom ??= {}).policy ??= [];
                        s.custom.policy.push({ type: 'undeclared-field', field: rawName });
                        return true;
                    }
                    customFields[fieldDef.name] = rawValue;
                    return false;
                });
                s.steps = [...s.background.steps, ...s.steps];
                s.background.steps = [];
            }
            s.steps = s.steps.filter((step) => {
                const match = step.text.match(base_parser_1.FIELD_PATTERN);
                if (!match)
                    return true;
                const rawName = match[1]?.trim().toLowerCase();
                const rawValue = match[2]?.trim();
                if (!rawName || rawValue === undefined)
                    return true;
                const fieldDef = keywordFields.get(rawName);
                if (!fieldDef) {
                    (s.custom ??= {}).policy ??= [];
                    s.custom.policy.push({ type: 'undeclared-field', field: rawName });
                    return true;
                }
                customFields[fieldDef.name] = rawValue;
                return false;
            });
            const tagFilter = (tag) => {
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
                    s.custom.policy.push({ type: 'required-field', field: fieldDef.name });
                    customFields[fieldDef.name] = "";
                }
                else if (customFields[fieldDef.name] === undefined) {
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
exports.TestcaseParser = TestcaseParser;
