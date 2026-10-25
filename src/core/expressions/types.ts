export type ASTNode =
    | LiteralNode
    | IdentifierNode
    | ArrayNode
    | UnaryNode
    | BinaryNode
    | CallNode
    | MemberNode;

export interface LiteralNode {
    type: 'Literal';
    value: any;
}

export interface IdentifierNode {
    type: 'Identifier';
    name: string;
}

export interface ArrayNode {
    type: 'Array';
    elements: ASTNode[];
}

export interface UnaryNode {
    type: 'Unary';
    operator: string;
    argument: ASTNode;
}

export interface BinaryNode {
    type: 'Binary';
    operator: string;
    left: ASTNode;
    right: ASTNode;
}

export interface CallNode {
    type: 'Call';
    callee: string;
    args: ASTNode[];
}

export interface MemberNode {
    type: 'Member';
    object: ASTNode;
    property: string;
}

export interface EvaluationContext {
    vars?: Record<string, any>;
    locals?: Record<string, any>;
    data?: any;
    workDir?: string;
    env?: Record<string, string | undefined>;
    extraFunctions?: Record<string, (...args: any[]) => any>;
}
