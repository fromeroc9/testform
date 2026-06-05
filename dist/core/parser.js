"use strict";
/**
 * @fileoverview Parser facade.
 *
 * Provides a unified interface to the specialized Gherkin parsers.
 * Delegates parsing and filtering logic based on the requested scope
 * to maintain backward compatibility with existing commands.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
const base_parser_1 = require("./parsers/base-parser");
const testcase_parser_1 = require("./parsers/testcase-parser");
const testrun_parser_1 = require("./parsers/testrun-parser");
const testplan_parser_1 = require("./parsers/testplan-parser");
/**
 * Minimal concrete implementation of BaseParser to handle reading
 * and formatting feature files before filtering.
 */
class ReaderParser extends base_parser_1.BaseParser {
    filter(scenarios) {
        return scenarios;
    }
}
class Parser {
    dir;
    variables;
    reader;
    constructor(dir, variables) {
        this.dir = dir;
        this.variables = variables;
        this.reader = new ReaderParser(dir, variables);
    }
    /**
     * Reads and parses all feature files in the directory.
     * @returns Raw, un-filtered parser scenarios.
     */
    content() {
        return this.reader.content();
    }
    /**
     * Filters and enriches raw scenarios based on the given scope and DSL test config.
     */
    filter(scenarios, test, scope) {
        let delegate;
        switch (scope) {
            case 'testcase':
                delegate = new testcase_parser_1.TestcaseParser(this.dir, this.variables);
                break;
            case 'testrun':
                delegate = new testrun_parser_1.TestrunParser(this.dir, this.variables);
                break;
            case 'testplan':
                delegate = new testplan_parser_1.TestplanParser(this.dir, this.variables);
                break;
            default:
                // Fallback to testcase parser logic for unknown scopes
                delegate = new testcase_parser_1.TestcaseParser(this.dir, this.variables);
        }
        return delegate.filter(scenarios, test, scope);
    }
}
exports.Parser = Parser;
