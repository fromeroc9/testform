export type TokenType =
    | 'STRING'
    | 'NUMBER'
    | 'BOOLEAN'
    | 'NULL'
    | 'IDENTIFIER'
    | 'OPERATOR'
    | 'LPAREN'
    | 'RPAREN'
    | 'LBRACKET'
    | 'RBRACKET'
    | 'COMMA'
    | 'QUESTION'
    | 'COLON'
    | 'EOF';

export interface Token {
    type: TokenType;
    value: any;
    raw: string;
    pos: number;
}

export class Lexer {
    private pos = 0;
    private input = '';

    constructor(input: string) {
        this.input = input.trim();
        // If wrapped in ${...}, strip the wrapper
        if (this.input.startsWith('${') && this.input.endsWith('}')) {
            this.input = this.input.substring(2, this.input.length - 1).trim();
        }
    }

    tokenize(): Token[] {
        const tokens: Token[] = [];
        while (this.pos < this.input.length) {
            this.skipWhitespace();
            if (this.pos >= this.input.length) break;

            const char = this.input[this.pos];
            const startPos = this.pos;

            // Punctuation
            if (char === '(') {
                tokens.push({ type: 'LPAREN', value: '(', raw: '(', pos: startPos });
                this.pos++;
            } else if (char === ')') {
                tokens.push({ type: 'RPAREN', value: ')', raw: ')', pos: startPos });
                this.pos++;
            } else if (char === '[') {
                tokens.push({ type: 'LBRACKET', value: '[', raw: '[', pos: startPos });
                this.pos++;
            } else if (char === ']') {
                tokens.push({ type: 'RBRACKET', value: ']', raw: ']', pos: startPos });
                this.pos++;
            } else if (char === ',') {
                tokens.push({ type: 'COMMA', value: ',', raw: ',', pos: startPos });
                this.pos++;
            } else if (char === '?') {
                tokens.push({ type: 'QUESTION', value: '?', raw: '?', pos: startPos });
                this.pos++;
            } else if (char === ':') {
                tokens.push({ type: 'COLON', value: ':', raw: ':', pos: startPos });
                this.pos++;
            }
            // Multi-char operators (&&, ||, ==, !=, <=, >=)
            else if (this.matchAhead('&&') || this.matchAhead('||') || this.matchAhead('==') || this.matchAhead('!=')) {
                const op = this.input.substring(this.pos, this.pos + 2);
                tokens.push({ type: 'OPERATOR', value: op, raw: op, pos: startPos });
                this.pos += 2;
            } else if (this.matchAhead('<=') || this.matchAhead('>=')) {
                const op = this.input.substring(this.pos, this.pos + 2);
                tokens.push({ type: 'OPERATOR', value: op, raw: op, pos: startPos });
                this.pos += 2;
            } else if (char === '<' || char === '>' || char === '!' || char === '+' || char === '-' || char === '*' || char === '/') {
                tokens.push({ type: 'OPERATOR', value: char, raw: char, pos: startPos });
                this.pos++;
            }
            // Strings: '...' or "..."
            else if (char === '"' || char === "'") {
                tokens.push(this.readString(char, startPos));
            }
            // Numbers: digits
            else if (this.isDigit(char)) {
                tokens.push(this.readNumber(startPos));
            }
            // Identifiers or Booleans or Null (e.g. var.foo, local.bar, lower, true, false)
            else if (this.isIdentifierStart(char)) {
                tokens.push(this.readIdentifier(startPos));
            } else {
                throw new Error(`Unexpected character '${char}' at position ${this.pos} in expression: "${this.input}"`);
            }
        }

        tokens.push({ type: 'EOF', value: null, raw: '', pos: this.pos });
        return tokens;
    }

    private skipWhitespace() {
        while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
            this.pos++;
        }
    }

    private matchAhead(str: string): boolean {
        return this.input.startsWith(str, this.pos);
    }

    private isDigit(char: string): boolean {
        return char >= '0' && char <= '9';
    }

    private isIdentifierStart(char: string): boolean {
        return /[a-zA-Z_]/.test(char);
    }

    private isIdentifierChar(char: string): boolean {
        return /[a-zA-Z0-9_\.\-]/.test(char);
    }

    private readString(quote: string, startPos: number): Token {
        this.pos++; // skip opening quote
        let str = '';
        while (this.pos < this.input.length) {
            const char = this.input[this.pos];
            if (char === '\\') {
                this.pos++;
                if (this.pos < this.input.length) {
                    str += this.input[this.pos];
                    this.pos++;
                }
            } else if (char === quote) {
                this.pos++; // skip closing quote
                return {
                    type: 'STRING',
                    value: str,
                    raw: this.input.substring(startPos, this.pos),
                    pos: startPos
                };
            } else {
                str += char;
                this.pos++;
            }
        }
        throw new Error(`Unterminated string starting at position ${startPos} in expression: "${this.input}"`);
    }

    private readNumber(startPos: number): Token {
        let isFloat = false;
        while (this.pos < this.input.length) {
            const char = this.input[this.pos];
            if (this.isDigit(char)) {
                this.pos++;
            } else if (char === '.' && !isFloat && this.pos + 1 < this.input.length && this.isDigit(this.input[this.pos + 1])) {
                isFloat = true;
                this.pos++;
            } else {
                break;
            }
        }
        const raw = this.input.substring(startPos, this.pos);
        const num = isFloat ? parseFloat(raw) : parseInt(raw, 10);
        return {
            type: 'NUMBER',
            value: num,
            raw,
            pos: startPos
        };
    }

    private readIdentifier(startPos: number): Token {
        while (this.pos < this.input.length && this.isIdentifierChar(this.input[this.pos])) {
            this.pos++;
        }
        const raw = this.input.substring(startPos, this.pos);
        if (raw === 'true') {
            return { type: 'BOOLEAN', value: true, raw, pos: startPos };
        }
        if (raw === 'false') {
            return { type: 'BOOLEAN', value: false, raw, pos: startPos };
        }
        if (raw === 'null') {
            return { type: 'NULL', value: null, raw, pos: startPos };
        }
        return {
            type: 'IDENTIFIER',
            value: raw,
            raw,
            pos: startPos
        };
    }
}
