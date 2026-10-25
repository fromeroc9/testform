import chalk from 'chalk';
import { standardFunctions } from '../core/expressions/functions';
import { evaluateExpression } from '../core/expressions/evaluator';

const { bold, cyan, green, yellow, gray, white, magenta } = chalk;

export interface FunctionDoc {
    name: string;
    category: 'String & Text' | 'Collections & Logic' | 'System & Encoding';
    signature: string;
    returnType: string;
    description: string;
    arguments: { name: string; type: string; optional?: boolean; description: string }[];
    examples: { expression: string; result: string; note?: string }[];
}

export const FUNCTIONS_CATALOG: Record<string, FunctionDoc> = {
    // ─── String & Text ──────────────────────────────────────────────────────────
    lower: {
        name: 'lower',
        category: 'String & Text',
        signature: 'lower(string)',
        returnType: 'string',
        description: 'Converts all letters in a string to lowercase.',
        arguments: [
            { name: 'string', type: 'string', description: 'The string to convert.' }
        ],
        examples: [
            { expression: 'lower("HELLO WORLD")', result: '"hello world"' },
            { expression: 'lower(var.environment)', result: '"staging"' }
        ]
    },
    upper: {
        name: 'upper',
        category: 'String & Text',
        signature: 'upper(string)',
        returnType: 'string',
        description: 'Converts all letters in a string to uppercase.',
        arguments: [
            { name: 'string', type: 'string', description: 'The string to convert.' }
        ],
        examples: [
            { expression: 'upper("testform")', result: '"TESTFORM"' },
            { expression: 'upper(var.tier)', result: '"ENTERPRISE"' }
        ]
    },
    trim: {
        name: 'trim',
        category: 'String & Text',
        signature: 'trim(string, [cutset])',
        returnType: 'string',
        description: 'Removes leading and trailing whitespace or specified characters.',
        arguments: [
            { name: 'string', type: 'string', description: 'The input string.' },
            { name: 'cutset', type: 'string', optional: true, description: 'Characters to strip (defaults to whitespace).' }
        ],
        examples: [
            { expression: 'trim("  hello  ")', result: '"hello"' },
            { expression: 'trim("!?hello!?", "!?")', result: '"hello"' }
        ]
    },
    trimprefix: {
        name: 'trimprefix',
        category: 'String & Text',
        signature: 'trimprefix(string, prefix)',
        returnType: 'string',
        description: 'Removes the specified prefix from the beginning of a string if present.',
        arguments: [
            { name: 'string', type: 'string', description: 'The input string.' },
            { name: 'prefix', type: 'string', description: 'The prefix to remove.' }
        ],
        examples: [
            { expression: 'trimprefix("v1.2.3", "v")', result: '"1.2.3"' }
        ]
    },
    trimsuffix: {
        name: 'trimsuffix',
        category: 'String & Text',
        signature: 'trimsuffix(string, suffix)',
        returnType: 'string',
        description: 'Removes the specified suffix from the end of a string if present.',
        arguments: [
            { name: 'string', type: 'string', description: 'The input string.' },
            { name: 'suffix', type: 'string', description: 'The suffix to remove.' }
        ],
        examples: [
            { expression: 'trimsuffix("index.case.feature", ".case.feature")', result: '"index"' }
        ]
    },
    startswith: {
        name: 'startswith',
        category: 'String & Text',
        signature: 'startswith(string, prefix)',
        returnType: 'boolean',
        description: 'Returns true if the string begins with the specified prefix.',
        arguments: [
            { name: 'string', type: 'string', description: 'The string to test.' },
            { name: 'prefix', type: 'string', description: 'The prefix to check.' }
        ],
        examples: [
            { expression: 'startswith(var.image_tag, "v")', result: 'true' }
        ]
    },
    endswith: {
        name: 'endswith',
        category: 'String & Text',
        signature: 'endswith(string, suffix)',
        returnType: 'boolean',
        description: 'Returns true if the string ends with the specified suffix.',
        arguments: [
            { name: 'string', type: 'string', description: 'The string to test.' },
            { name: 'suffix', type: 'string', description: 'The suffix to check.' }
        ],
        examples: [
            { expression: 'endswith(var.filename, ".feature")', result: 'true' }
        ]
    },
    replace: {
        name: 'replace',
        category: 'String & Text',
        signature: 'replace(string, search, replacement)',
        returnType: 'string',
        description: 'Replaces all occurrences of a search string with a replacement string.',
        arguments: [
            { name: 'string', type: 'string', description: 'The source string.' },
            { name: 'search', type: 'string', description: 'Substring to search for.' },
            { name: 'replacement', type: 'string', description: 'Replacement string.' }
        ],
        examples: [
            { expression: 'replace("10.0.0.1", ".", "-")', result: '"10-0-0-1"' }
        ]
    },
    split: {
        name: 'split',
        category: 'String & Text',
        signature: 'split(separator, string)',
        returnType: 'list',
        description: 'Divides a string into a list of substrings separated by the specified delimiter.',
        arguments: [
            { name: 'separator', type: 'string', description: 'Delimiter used to split.' },
            { name: 'string', type: 'string', description: 'The input string.' }
        ],
        examples: [
            { expression: 'split(",", "dev,staging,prod")', result: '["dev", "staging", "prod"]' }
        ]
    },
    join: {
        name: 'join',
        category: 'String & Text',
        signature: 'join(separator, list)',
        returnType: 'string',
        description: 'Concatenates elements of a list into a single string separated by the delimiter.',
        arguments: [
            { name: 'separator', type: 'string', description: 'Delimiter inserted between elements.' },
            { name: 'list', type: 'list', description: 'List of elements to concatenate.' }
        ],
        examples: [
            { expression: 'join("-", ["test", "run", "1"])', result: '"test-run-1"' }
        ]
    },
    format: {
        name: 'format',
        category: 'String & Text',
        signature: 'format(format, ...args)',
        returnType: 'string',
        description: 'Formats a string using verbs (%s for string, %d for integer, %j for JSON, %% for literal %).',
        arguments: [
            { name: 'format', type: 'string', description: 'Format string containing placeholders.' },
            { name: 'args', type: 'any...', description: 'Values to interpolate.' }
        ],
        examples: [
            { expression: 'format("%s/%s", var.base_url, "api/v1")', result: '"https://example.com/api/v1"' },
            { expression: 'format("run-%03d", 5)', result: '"run-5"' }
        ]
    },
    substr: {
        name: 'substr',
        category: 'String & Text',
        signature: 'substr(string, offset, length)',
        returnType: 'string',
        description: 'Extracts a substring from offset up to length characters.',
        arguments: [
            { name: 'string', type: 'string', description: 'The source string.' },
            { name: 'offset', type: 'number', description: 'Zero-based starting position.' },
            { name: 'length', type: 'number', description: 'Number of characters to extract.' }
        ],
        examples: [
            { expression: 'substr("abcdef", 1, 3)', result: '"bcd"' }
        ]
    },

    // ─── Collections & Logic ───────────────────────────────────────────────────
    coalesce: {
        name: 'coalesce',
        category: 'Collections & Logic',
        signature: 'coalesce(...args)',
        returnType: 'any',
        description: 'Returns the first argument that is not null, undefined, or empty string.',
        arguments: [
            { name: 'args', type: 'any...', description: 'Sequence of values to evaluate.' }
        ],
        examples: [
            { expression: 'coalesce(var.custom_title, var.default_title, "Untitled")', result: '"Untitled"' }
        ]
    },
    lookup: {
        name: 'lookup',
        category: 'Collections & Logic',
        signature: 'lookup(map, key, [default])',
        returnType: 'any',
        description: 'Retrieves the value of a key from a map, returning default if not present.',
        arguments: [
            { name: 'map', type: 'map', description: 'The map to query.' },
            { name: 'key', type: 'string', description: 'The attribute name.' },
            { name: 'default', type: 'any', optional: true, description: 'Fallback value if key is not found.' }
        ],
        examples: [
            { expression: 'lookup(local.env_urls, var.env, "http://localhost:3000")', result: '"https://api.dev.com"' }
        ]
    },
    contains: {
        name: 'contains',
        category: 'Collections & Logic',
        signature: 'contains(list_or_string, value)',
        returnType: 'boolean',
        description: 'Checks whether a list contains an element or a string contains a substring.',
        arguments: [
            { name: 'list_or_string', type: 'list | string', description: 'The collection or text.' },
            { name: 'value', type: 'any', description: 'Value to search for.' }
        ],
        examples: [
            { expression: 'contains(["dev", "staging", "prod"], var.environment)', result: 'true' },
            { expression: 'contains("hello world", "world")', result: 'true' }
        ]
    },
    length: {
        name: 'length',
        category: 'Collections & Logic',
        signature: 'length(value)',
        returnType: 'number',
        description: 'Returns the number of elements in a list, keys in a map, or characters in a string.',
        arguments: [
            { name: 'value', type: 'list | map | string', description: 'Target value.' }
        ],
        examples: [
            { expression: 'length(["a", "b", "c"])', result: '3' },
            { expression: 'length("hello")', result: '5' }
        ]
    },
    element: {
        name: 'element',
        category: 'Collections & Logic',
        signature: 'element(list, index)',
        returnType: 'any',
        description: 'Retrieves an element at the specified index with safe wrapping modulo behavior.',
        arguments: [
            { name: 'list', type: 'list', description: 'Target list.' },
            { name: 'index', type: 'number', description: 'Zero-based index.' }
        ],
        examples: [
            { expression: 'element(["a", "b", "c"], 1)', result: '"b"' }
        ]
    },
    slice: {
        name: 'slice',
        category: 'Collections & Logic',
        signature: 'slice(list, start, [end])',
        returnType: 'list',
        description: 'Returns a sublist of elements from start index up to end index.',
        arguments: [
            { name: 'list', type: 'list', description: 'Target list.' },
            { name: 'start', type: 'number', description: 'Starting index.' },
            { name: 'end', type: 'number', optional: true, description: 'Ending index (exclusive).' }
        ],
        examples: [
            { expression: 'slice(["a", "b", "c", "d"], 1, 3)', result: '["b", "c"]' }
        ]
    },
    merge: {
        name: 'merge',
        category: 'Collections & Logic',
        signature: 'merge(...maps)',
        returnType: 'map',
        description: 'Merges multiple maps into a single map, with rightmost keys overriding leftmost.',
        arguments: [
            { name: 'maps', type: 'map...', description: 'Maps to merge.' }
        ],
        examples: [
            { expression: 'merge({ a: 1 }, { b: 2, a: 3 })', result: '{ a: 3, b: 2 }' }
        ]
    },

    // ─── System & Encoding ─────────────────────────────────────────────────────
    env: {
        name: 'env',
        category: 'System & Encoding',
        signature: 'env(name)',
        returnType: 'string',
        description: 'Reads an environment variable from the host process.',
        arguments: [
            { name: 'name', type: 'string', description: 'Environment variable name.' }
        ],
        examples: [
            { expression: 'env("CI")', result: '"true"' },
            { expression: 'env("GITHUB_TOKEN")', result: '"ghp_..."' }
        ]
    },
    uuid: {
        name: 'uuid',
        category: 'System & Encoding',
        signature: 'uuid()',
        returnType: 'string',
        description: 'Generates a random RFC 4122 version 4 UUID.',
        arguments: [],
        examples: [
            { expression: 'uuid()', result: '"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"' }
        ]
    },
    timestamp: {
        name: 'timestamp',
        category: 'System & Encoding',
        signature: 'timestamp()',
        returnType: 'string',
        description: 'Returns current UTC date and time formatted in ISO 8601.',
        arguments: [],
        examples: [
            { expression: 'timestamp()', result: '"2026-10-25T05:00:00.000Z"' }
        ]
    },
    jsonencode: {
        name: 'jsonencode',
        category: 'System & Encoding',
        signature: 'jsonencode(value)',
        returnType: 'string',
        description: 'Serializes a value into a standard JSON string.',
        arguments: [
            { name: 'value', type: 'any', description: 'Value or data structure to serialize.' }
        ],
        examples: [
            { expression: 'jsonencode({ active: true, retries: 3 })', result: '\'{"active":true,"retries":3}\'' }
        ]
    },
    jsondecode: {
        name: 'jsondecode',
        category: 'System & Encoding',
        signature: 'jsondecode(string)',
        returnType: 'any',
        description: 'Parses a JSON string into its native data structure (object, list, etc.).',
        arguments: [
            { name: 'string', type: 'string', description: 'JSON formatted string.' }
        ],
        examples: [
            { expression: 'jsondecode(\'{"env":"qa"}\')', result: '{ env: "qa" }' }
        ]
    },
    file: {
        name: 'file',
        category: 'System & Encoding',
        signature: 'file(path)',
        returnType: 'string',
        description: 'Reads the contents of a local file as UTF-8 text.',
        arguments: [
            { name: 'path', type: 'string', description: 'Relative or absolute file path.' }
        ],
        examples: [
            { expression: 'file("config.json")', result: '"{\\n  \\"version\\": 1\\n}"' }
        ]
    }
};

export interface FunctionsCmdOptions {
    name?: string;
    evalExpr?: string;
}

export async function functionsCmd(options: FunctionsCmdOptions): Promise<void> {
    const { name, evalExpr } = options;

    // 1. Direct Evaluation mode
    if (evalExpr) {
        try {
            const result = evaluateExpression(evalExpr, {
                vars: {},
                locals: {},
                extraFunctions: standardFunctions
            });
            console.log(bold(cyan('\nExpression Evaluation:')));
            console.log(`  ${gray('Input:')}  ${white(evalExpr)}`);
            console.log(`  ${gray('Type:')}   ${yellow(typeof result === 'object' ? (Array.isArray(result) ? 'list' : 'map') : typeof result)}`);
            console.log(`  ${gray('Result:')} ${green(JSON.stringify(result, null, 2))}\n`);
        } catch (err: any) {
            console.error(chalk.red(`\nEvaluation Error: ${err.message}\n`));
            throw err;
        }
        return;
    }

    // 2. Specific function detail mode
    if (name) {
        const fnName = name.toLowerCase().trim();
        const doc = FUNCTIONS_CATALOG[fnName];
        if (!doc) {
            console.log(chalk.red(`\nUnknown function: "${name}".`));
            console.log(gray(`Run 'testform functions' to view all available built-in functions.\n`));
            return;
        }

        console.log(bold(cyan(`\nTestform Expression Function: ${magenta(doc.name)}`)));
        console.log(`  ${gray('Category:')}    ${doc.category}`);
        console.log(`  ${gray('Signature:')}   ${yellow(doc.signature)} -> ${cyan(doc.returnType)}`);
        console.log(`  ${gray('Description:')} ${white(doc.description)}`);

        if (doc.arguments.length > 0) {
            console.log(bold('\nArguments:'));
            for (const arg of doc.arguments) {
                const opt = arg.optional ? gray(' (optional)') : '';
                console.log(`  - ${cyan(arg.name)} ${yellow(`[${arg.type}]`)}${opt}: ${arg.description}`);
            }
        } else {
            console.log(bold('\nArguments: none'));
        }

        if (doc.examples.length > 0) {
            console.log(bold('\nExamples:'));
            for (const ex of doc.examples) {
                console.log(`  ${gray('$')} ${white(ex.expression)}`);
                console.log(`    ${green('=>')} ${cyan(ex.result)}`);
                if (ex.note) console.log(`    ${gray(`(${ex.note})`)}`);
            }
        }
        console.log('');
        return;
    }

    // 3. Catalogue Overview mode
    console.log(bold(cyan('\nTestform Expression Engine — Built-in Functions Catalog\n')));
    console.log(gray('Available in locals.yml expressions, variables.yml validation conditions, and CLI:'));

    const categories: Array<'String & Text' | 'Collections & Logic' | 'System & Encoding'> = [
        'String & Text',
        'Collections & Logic',
        'System & Encoding'
    ];

    for (const cat of categories) {
        console.log(bold(yellow(`\n• ${cat}:`)));
        const fns = Object.values(FUNCTIONS_CATALOG).filter(f => f.category === cat);
        for (const fn of fns) {
            const sig = fn.signature.padEnd(38, ' ');
            console.log(`  ${cyan(sig)} ${gray('→')} ${white(fn.description)}`);
        }
    }

    console.log(gray('\nRun \'testform functions <name>\' for detailed documentation and examples on a specific function.'));
    console.log(gray('Run \'testform functions --eval "<expression>"\' to test expressions live in your terminal.\n'));
}
