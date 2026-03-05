import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// ─── Keywords & Builtins ────────────────────────────────────────────────────

const KEYWORDS = [
    'if', 'else', 'for', 'while', 'return', 'break', 'continue',
    'match', 'case', 'import', 'in', 'var', 'func', 'class',
    'self', 'super', 'is', 'and', 'or'
];

const BUILTINS = ['true', 'false', 'null'];

// ─── Initialize ─────────────────────────────────────────────────────────────

connection.onInitialize((_params: InitializeParams): InitializeResult => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['.']
            },
            hoverProvider: false,
        }
    };
});

// ─── Diagnostics ────────────────────────────────────────────────────────────

documents.onDidChangeContent(change => {
    validateDocument(change.document);
});

async function validateDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    const lines = text.split('\n');
    const diagnostics: Diagnostic[] = [];

    // Track bracket/brace/paren balance
    const stack: { char: string, line: number, col: number }[] = [];
    const openFor: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
    const closeFor: Record<string, string> = { '(': ')', '{': '}', '[': ']' };

    let inLineComment = false;
    let inBlockComment = false;
    let inString = false;
    let stringChar = '';
    let inInterpolation = false;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        inLineComment = false;

        for (let col = 0; col < line.length; col++) {
            const ch = line[col];
            const next = line[col + 1];

            // Block comment handling
            if (inBlockComment) {
                if (ch === '*' && next === '/') { inBlockComment = false; col++; }
                continue;
            }
            if (ch === '/' && next === '*') { inBlockComment = true; col++; continue; }

            // Line comment
            if (!inString && ch === '/' && next === '/') { inLineComment = true; break; }
            if (inLineComment) break;

            // String handling
            if (!inString && (ch === '"' || ch === "'")) {
                inString = true;
                stringChar = ch;
                continue;
            }
            if (inString) {
                if (ch === '\\') { col++; continue; } // escape
                if (ch === '$' && next === '{') { inInterpolation = true; col++; continue; }
                if (ch === stringChar && !inInterpolation) { inString = false; stringChar = ''; }
                if (inInterpolation && ch === '}') { inInterpolation = false; }
                continue;
            }

            // Bracket balance
            if ('([{'.includes(ch)) {
                stack.push({ char: ch, line: lineNum, col });
            } else if (')]}'.includes(ch)) {
                if (stack.length === 0 || stack[stack.length - 1].char !== openFor[ch]) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: { line: lineNum, character: col },
                            end:   { line: lineNum, character: col + 1 }
                        },
                        message: `Unexpected '${ch}' — no matching '${openFor[ch]}'.`,
                        source: 'IFF'
                    });
                } else {
                    stack.pop();
                }
            }
        }

        // ── Missing semicolon check ──
        // Skip blank lines, lines ending with { } ( ) , comment lines, and block starters
        const trimmed = line.trim();
        if (
            trimmed.length === 0 ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*') ||
            trimmed.endsWith('{') ||
            trimmed.endsWith('}') ||
            trimmed.endsWith(',') ||
            trimmed.endsWith('(') ||
            trimmed.endsWith(';') ||
            trimmed.endsWith(':')
        ) continue;

        // Lines that are block starters don't need semicolons
        const isBlockStarter = /^\s*(if|else|for|while|func|class|match|case)\b/.test(line);
        if (isBlockStarter) continue;

        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: { line: lineNum, character: line.trimEnd().length - 1 },
                end:   { line: lineNum, character: line.trimEnd().length }
            },
            message: `Missing semicolon.`,
            source: 'IFF'
        });
    }

    // Unclosed brackets
    for (const unclosed of stack) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: unclosed.line, character: unclosed.col },
                end:   { line: unclosed.line, character: unclosed.col + 1 }
            },
            message: `Unclosed '${unclosed.char}' — expected '${closeFor[unclosed.char]}'.`,
            source: 'IFF'
        });
    }

    // ── Undeclared variable check ──
    const declaredVars = new Set<string>();
    const declaredFuncs = new Set<string>();

    // First pass: collect all declarations
    const varDecl    = /\bvar\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const funcDecl   = /\bfunc\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const classDecl  = /\bclass\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;

    let match;
    while ((match = varDecl.exec(text))   !== null) declaredVars.add(match[1]);
    while ((match = funcDecl.exec(text))  !== null) declaredFuncs.add(match[1]);
    while ((match = classDecl.exec(text)) !== null) declaredFuncs.add(match[1]);

    // Second pass: check usages
    const identifierUsage = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    const allKnown = new Set([
        ...KEYWORDS, ...BUILTINS,
        ...declaredVars, ...declaredFuncs
    ]);

    // Reset and scan line by line for better position tracking
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const trimmed = line.trim();

        // Skip comments and strings (rough but effective)
        if (trimmed.startsWith('//')) continue;

        // Skip declaration lines themselves
        if (/^\s*(var|func|class)\s/.test(line)) continue;

        identifierUsage.lastIndex = 0;
        let m;
        while ((m = identifierUsage.exec(line)) !== null) {
            const name = m[1];
            if (allKnown.has(name)) continue;
            if (/^\d/.test(name)) continue; // numbers

            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: { line: lineNum, character: m.index },
                    end:   { line: lineNum, character: m.index + name.length }
                },
                message: `'${name}' is not declared.`,
                source: 'IFF'
            });

            // Add to known so we don't spam the same warning
            allKnown.add(name);
        }
    }

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// ─── Completions ─────────────────────────────────────────────────────────────

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const text = doc.getText();
    const items: CompletionItem[] = [];

    // Keywords
    for (const kw of KEYWORDS) {
        items.push({ label: kw, kind: CompletionItemKind.Keyword });
    }

    // Builtins
    for (const b of BUILTINS) {
        items.push({ label: b, kind: CompletionItemKind.Constant });
    }

    // Variables declared in the file
    const varDecl = /\bvar\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let m;
    while ((m = varDecl.exec(text)) !== null) {
        items.push({ label: m[1], kind: CompletionItemKind.Variable });
    }

    // Functions declared in the file
    const funcDecl = /\bfunc\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    while ((m = funcDecl.exec(text)) !== null) {
        items.push({ label: m[1], kind: CompletionItemKind.Function });
    }

    // Classes declared in the file
    const classDecl = /\bclass\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    while ((m = classDecl.exec(text)) !== null) {
        items.push({ label: m[1], kind: CompletionItemKind.Class });
    }

    // Snippets
    items.push({
        label: 'func',
        kind: CompletionItemKind.Snippet,
        insertText: 'func ${1:name}(${2:params}) {\n\t${3}\n}',
        insertTextFormat: 2, // snippet format
        detail: 'Function declaration'
    });
    items.push({
        label: 'if',
        kind: CompletionItemKind.Snippet,
        insertText: 'if (${1:condition}) {\n\t${2}\n}',
        insertTextFormat: 2,
        detail: 'If statement'
    });
    items.push({
        label: 'while',
        kind: CompletionItemKind.Snippet,
        insertText: 'while (${1:condition}) {\n\t${2}\n}',
        insertTextFormat: 2,
        detail: 'While loop'
    });
    items.push({
        label: 'for',
        kind: CompletionItemKind.Snippet,
        insertText: 'for (${1:i} in ${2:iterable}) {\n\t${3}\n}',
        insertTextFormat: 2,
        detail: 'For loop'
    });
    items.push({
        label: 'class',
        kind: CompletionItemKind.Snippet,
        insertText: 'class ${1:Name} {\n\t${2}\n}',
        insertTextFormat: 2,
        detail: 'Class declaration'
    });

    return items;
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    return item;
});

// ─── Start ───────────────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();