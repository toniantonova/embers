/**
 * expression-eval.ts — Safe arithmetic evaluator for template expressions.
 *
 * Evaluates expressions like "{{speed * 2.0 + index * 0.25}}" by:
 *   1. Stripping {{ }} delimiters
 *   2. Tokenizing into numbers, operators, variables, parentheses
 *   3. Recursive-descent parsing (respects operator precedence)
 *
 * NO eval() or Function() — purely hand-written for safety.
 *
 * Supported operations: +, -, *, /, parentheses
 * Supported variables: speed, index, amplitudeScale, count, and any
 * custom key passed via the variables record.
 */

// ── TYPES ───────────────────────────────────────────────────────

type TokenType = 'NUMBER' | 'VARIABLE' | 'OPERATOR' | 'LPAREN' | 'RPAREN';

interface Token {
    type: TokenType;
    value: string;
}

export interface ExpressionVariables {
    [key: string]: number;
}


// ── TOKENIZER ───────────────────────────────────────────────────

const WHITESPACE = /\s/;
const DIGIT_OR_DOT = /[\d.]/;
const IDENTIFIER_START = /[a-zA-Z_]/;
const IDENTIFIER_CHAR = /[a-zA-Z0-9_]/;
const OPERATORS = new Set(['+', '-', '*', '/']);

function tokenize(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < expr.length) {
        const ch = expr[i];

        // Skip whitespace
        if (WHITESPACE.test(ch)) {
            i++;
            continue;
        }

        // Number literal (including decimals and negative sign after operator/start)
        if (DIGIT_OR_DOT.test(ch)) {
            let num = '';
            while (i < expr.length && DIGIT_OR_DOT.test(expr[i])) {
                num += expr[i++];
            }
            tokens.push({ type: 'NUMBER', value: num });
            continue;
        }

        // Variable name
        if (IDENTIFIER_START.test(ch)) {
            let name = '';
            while (i < expr.length && IDENTIFIER_CHAR.test(expr[i])) {
                name += expr[i++];
            }
            tokens.push({ type: 'VARIABLE', value: name });
            continue;
        }

        // Operators
        if (OPERATORS.has(ch)) {
            tokens.push({ type: 'OPERATOR', value: ch });
            i++;
            continue;
        }

        // Parentheses
        if (ch === '(') {
            tokens.push({ type: 'LPAREN', value: '(' });
            i++;
            continue;
        }
        if (ch === ')') {
            tokens.push({ type: 'RPAREN', value: ')' });
            i++;
            continue;
        }

        throw new Error(`[ExpressionEval] Unexpected character '${ch}' in expression: "${expr}"`);
    }

    return tokens;
}


// ── RECURSIVE DESCENT PARSER ────────────────────────────────────
// Grammar:
//   expr       → addSub
//   addSub     → mulDiv ( ('+' | '-') mulDiv )*
//   mulDiv     → unary ( ('*' | '/') unary )*
//   unary      → '-' unary | primary
//   primary    → NUMBER | VARIABLE | '(' expr ')'

class Parser {
    private tokens: Token[];
    private pos: number;
    private variables: ExpressionVariables;

    constructor(tokens: Token[], variables: ExpressionVariables) {
        this.tokens = tokens;
        this.pos = 0;
        this.variables = variables;
    }

    parse(): number {
        const result = this.addSub();
        if (this.pos < this.tokens.length) {
            throw new Error(
                `[ExpressionEval] Unexpected token '${this.tokens[this.pos].value}' at position ${this.pos}`
            );
        }
        return result;
    }

    private peek(): Token | null {
        return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
    }

    private advance(): Token {
        return this.tokens[this.pos++];
    }

    private addSub(): number {
        let left = this.mulDiv();
        while (this.peek()?.type === 'OPERATOR' &&
            (this.peek()!.value === '+' || this.peek()!.value === '-')) {
            const op = this.advance().value;
            const right = this.mulDiv();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }

    private mulDiv(): number {
        let left = this.unary();
        while (this.peek()?.type === 'OPERATOR' &&
            (this.peek()!.value === '*' || this.peek()!.value === '/')) {
            const op = this.advance().value;
            const right = this.unary();
            if (op === '/') {
                if (right === 0) throw new Error('[ExpressionEval] Division by zero');
                left = left / right;
            } else {
                left = left * right;
            }
        }
        return left;
    }

    private unary(): number {
        // Handle unary minus: -expr
        if (this.peek()?.type === 'OPERATOR' && this.peek()!.value === '-') {
            this.advance();
            return -this.unary();
        }
        return this.primary();
    }

    private primary(): number {
        const token = this.peek();

        if (!token) {
            throw new Error('[ExpressionEval] Unexpected end of expression');
        }

        // Number literal
        if (token.type === 'NUMBER') {
            this.advance();
            const val = parseFloat(token.value);
            if (isNaN(val)) {
                throw new Error(`[ExpressionEval] Invalid number: "${token.value}"`);
            }
            return val;
        }

        // Variable
        if (token.type === 'VARIABLE') {
            this.advance();
            if (!(token.value in this.variables)) {
                throw new Error(
                    `[ExpressionEval] Unknown variable '${token.value}'. Available: ${Object.keys(this.variables).join(', ')}`
                );
            }
            return this.variables[token.value];
        }

        // Parenthesized sub-expression
        if (token.type === 'LPAREN') {
            this.advance(); // consume '('
            const result = this.addSub();
            const closing = this.peek();
            if (!closing || closing.type !== 'RPAREN') {
                throw new Error('[ExpressionEval] Missing closing parenthesis');
            }
            this.advance(); // consume ')'
            return result;
        }

        throw new Error(`[ExpressionEval] Unexpected token '${token.value}'`);
    }
}


// ── PUBLIC API ──────────────────────────────────────────────────

/**
 * Check if a value is a template expression string like "{{speed * 2.0}}".
 */
export function isExpression(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}');
}

/**
 * Strip the {{ }} delimiters from an expression string.
 */
function stripDelimiters(expr: string): string {
    return expr.slice(2, -2).trim();
}

/**
 * Evaluate a template expression string.
 *
 * @param expr - Expression like "{{speed * 2.0}}" or "2.5"
 * @param variables - Variable values for substitution
 * @returns The computed number
 *
 * @example
 * evaluateExpression("{{speed * 2.0}}", { speed: 1.5 }); // → 3.0
 * evaluateExpression("{{speed * 2.0 + index * 0.25}}", { speed: 1.0, index: 2 }); // → 2.5
 */
export function evaluateExpression(expr: string, variables: ExpressionVariables = {}): number {
    const inner = stripDelimiters(expr);
    const tokens = tokenize(inner);
    const parser = new Parser(tokens, variables);
    return parser.parse();
}

/**
 * Resolve a param value — either a literal number or a template expression.
 */
export function resolveParamValue(
    value: number | string,
    variables: ExpressionVariables = {}
): number {
    if (typeof value === 'number') return value;
    if (isExpression(value)) return evaluateExpression(value, variables);
    // Try parsing as a plain number string
    const num = parseFloat(value);
    if (!isNaN(num)) return num;
    throw new Error(`[ExpressionEval] Cannot resolve param value: "${value}"`);
}
