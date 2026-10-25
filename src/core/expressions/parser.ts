import { Token } from './lexer';
import { ASTNode, CallNode, ArrayNode } from './types';

export class Parser {
    private pos = 0;
    private tokens: Token[] = [];

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    parse(): ASTNode {
        const node = this.parseExpression();
        if (this.peek().type !== 'EOF') {
            throw new Error(`Unexpected token '${this.peek().raw}' after expression at pos ${this.peek().pos}`);
        }
        return node;
    }

    private parseExpression(): ASTNode {
        return this.parseLogicalOr();
    }

    private parseLogicalOr(): ASTNode {
        let left = this.parseLogicalAnd();
        while (this.matchOperator('||')) {
            const op = this.previous().value;
            const right = this.parseLogicalAnd();
            left = { type: 'Binary', operator: op, left, right };
        }
        return left;
    }

    private parseLogicalAnd(): ASTNode {
        let left = this.parseEquality();
        while (this.matchOperator('&&')) {
            const op = this.previous().value;
            const right = this.parseEquality();
            left = { type: 'Binary', operator: op, left, right };
        }
        return left;
    }

    private parseEquality(): ASTNode {
        let left = this.parseComparison();
        while (this.matchOperator('==') || this.matchOperator('!=')) {
            const op = this.previous().value;
            const right = this.parseComparison();
            left = { type: 'Binary', operator: op, left, right };
        }
        return left;
    }

    private parseComparison(): ASTNode {
        let left = this.parseAdditive();
        while (
            this.matchOperator('<') ||
            this.matchOperator('>') ||
            this.matchOperator('<=') ||
            this.matchOperator('>=')
        ) {
            const op = this.previous().value;
            const right = this.parseAdditive();
            left = { type: 'Binary', operator: op, left, right };
        }
        return left;
    }

    private parseAdditive(): ASTNode {
        let left = this.parseMultiplicative();
        while (this.matchOperator('+') || this.matchOperator('-')) {
            const op = this.previous().value;
            const right = this.parseMultiplicative();
            left = { type: 'Binary', operator: op, left, right };
        }
        return left;
    }

    private parseMultiplicative(): ASTNode {
        let left = this.parseUnary();
        while (this.matchOperator('*') || this.matchOperator('/')) {
            const op = this.previous().value;
            const right = this.parseUnary();
            left = { type: 'Binary', operator: op, left, right };
        }
        return left;
    }

    private parseUnary(): ASTNode {
        if (this.matchOperator('!') || this.matchOperator('-')) {
            const op = this.previous().value;
            const argument = this.parseUnary();
            return { type: 'Unary', operator: op, argument };
        }
        return this.parsePrimary();
    }

    private parsePrimary(): ASTNode {
        const token = this.peek();

        if (token.type === 'STRING' || token.type === 'NUMBER' || token.type === 'BOOLEAN' || token.type === 'NULL') {
            this.advance();
            return { type: 'Literal', value: token.value };
        }

        if (token.type === 'LBRACKET') {
            this.advance(); // consume '['
            const elements: ASTNode[] = [];
            if (!this.check('RBRACKET')) {
                do {
                    elements.push(this.parseExpression());
                } while (this.match('COMMA'));
            }
            this.consume('RBRACKET', "Expected ']' after array elements");
            return { type: 'Array', elements } as ArrayNode;
        }

        if (token.type === 'LPAREN') {
            this.advance(); // consume '('
            const expr = this.parseExpression();
            this.consume('RPAREN', "Expected ')' after expression");
            return expr;
        }

        if (token.type === 'IDENTIFIER') {
            this.advance();
            const identName = token.value;

            // Check if it's a function call: callee(arg1, arg2)
            if (this.match('LPAREN')) {
                const args: ASTNode[] = [];
                if (!this.check('RPAREN')) {
                    do {
                        args.push(this.parseExpression());
                    } while (this.match('COMMA'));
                }
                this.consume('RPAREN', `Expected ')' after arguments in call to '${identName}'`);
                return {
                    type: 'Call',
                    callee: identName,
                    args
                } as CallNode;
            }

            return {
                type: 'Identifier',
                name: identName
            };
        }

        throw new Error(`Unexpected token '${token.raw}' of type ${token.type} at position ${token.pos}`);
    }

    private match(type: string): boolean {
        if (this.check(type)) {
            this.advance();
            return true;
        }
        return false;
    }

    private matchOperator(op: string): boolean {
        if (this.check('OPERATOR') && this.peek().value === op) {
            this.advance();
            return true;
        }
        return false;
    }

    private check(type: string): boolean {
        if (this.isAtEnd()) return false;
        return this.peek().type === type;
    }

    private advance(): Token {
        if (!this.isAtEnd()) this.pos++;
        return this.previous();
    }

    private isAtEnd(): boolean {
        return this.peek().type === 'EOF';
    }

    private peek(): Token {
        return this.tokens[this.pos];
    }

    private previous(): Token {
        return this.tokens[this.pos - 1];
    }

    private consume(type: string, message: string): Token {
        if (this.check(type)) return this.advance();
        throw new Error(`${message}. Got '${this.peek().raw}' instead at position ${this.peek().pos}`);
    }
}
