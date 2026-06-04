/**
 * @fileoverview Parser facade.
 *
 * Provides a unified interface to the specialized Gherkin parsers.
 * Delegates parsing and filtering logic based on the requested scope
 * to maintain backward compatibility with existing commands.
 */

import { ITest, IScope, ParserScenario } from "../types";
import { VariableParser } from "./variables";
import { BaseParser } from "./parsers/base-parser";
import { TestcaseParser } from "./parsers/testcase-parser";
import { TestrunParser } from "./parsers/testrun-parser";
import { TestplanParser } from "./parsers/testplan-parser";

/**
 * Minimal concrete implementation of BaseParser to handle reading
 * and formatting feature files before filtering.
 */
class ReaderParser extends BaseParser {
    public filter(scenarios: ParserScenario[]): ParserScenario[] {
        return scenarios;
    }
}

export class Parser {
    private dir: string;
    private variables?: VariableParser;
    private reader: ReaderParser;

    constructor(dir: string, variables?: VariableParser) {
        this.dir = dir;
        this.variables = variables;
        this.reader = new ReaderParser(dir, variables);
    }

    /**
     * Reads and parses all feature files in the directory.
     * @returns Raw, un-filtered parser scenarios.
     */
    public content(): ParserScenario[] {
        return this.reader.content();
    }

    /**
     * Filters and enriches raw scenarios based on the given scope and DSL test config.
     */
    public filter(scenarios: ParserScenario[], test: ITest, scope?: IScope): ParserScenario[] {
        let delegate: BaseParser;

        switch (scope) {
            case 'testcase':
                delegate = new TestcaseParser(this.dir, this.variables);
                break;
            case 'testrun':
                delegate = new TestrunParser(this.dir, this.variables);
                break;
            case 'testplan':
                delegate = new TestplanParser(this.dir, this.variables);
                break;
            default:
                // Fallback to testcase parser logic for unknown scopes
                delegate = new TestcaseParser(this.dir, this.variables);
        }

        return delegate.filter(scenarios, test, scope);
    }
}