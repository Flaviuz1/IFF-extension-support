"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
// ─── Keywords & Builtins ────────────────────────────────────────────────────
const KEYWORDS = [
    'if', 'else', 'for', 'while', 'return', 'break', 'continue',
    'match', 'case', 'default', 'import', 'in', 'by', 'var', 'con',
    'func', 'class', 'self', 'super', 'is', 'and', 'or', 'print_placeholder'
];
const BUILTINS = ['true', 'false', 'null'];
// ─── Initialize ─────────────────────────────────────────────────────────────
connection.onInitialize((_params) => {
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
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
async function validateDocument(textDocument) {
    const text = textDocument.getText();
    const lines = text.split('\n');
    const diagnostics = [];
    const stack = [];
    const openFor  = { ')': '(', '}': '{', ']': '[' };
    const closeFor = { '(': ')', '{': '}', '[': ']' };
    let inBlockComment  = false;
    let inString        = false;
    let stringChar      = '';
    let inInterpolation = false;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const lineStartedInBlockComment = inBlockComment;
        let inLineComment = false;
        for (let col = 0; col < line.length; col++) {
            const ch   = line[col];
            const next = line[col + 1];
            // Block comment
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
                inString = true; stringChar = ch; continue;
            }
            if (inString) {
                if (ch === '\\') { col++; continue; }
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
                        severity: node_1.DiagnosticSeverity.Error,
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
        const trimmed = line.trim();
        if (lineStartedInBlockComment ||
            inBlockComment            ||
            trimmed.length === 0      ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*')  ||
            trimmed.endsWith('{')    ||
            trimmed.endsWith('}')    ||
            trimmed.endsWith(',')    ||
            trimmed.endsWith('(')    ||
            trimmed.endsWith(';')    ||
            trimmed.endsWith(':'))
            continue;
        const isBlockStarter = /^\s*(if|else|for|while|func|class|match|case|default)\b/.test(line);
        if (isBlockStarter) continue;
        diagnostics.push({
            severity: node_1.DiagnosticSeverity.Warning,
            range: {
                start: { line: lineNum, character: line.trimEnd().length - 1 },
                end:   { line: lineNum, character: line.trimEnd().length }
            },
            message: 'Missing semicolon.',
            source: 'IFF'
        });
    }
    // Unclosed brackets
    for (const unclosed of stack) {
        diagnostics.push({
            severity: node_1.DiagnosticSeverity.Error,
            range: {
                start: { line: unclosed.line, character: unclosed.col },
                end:   { line: unclosed.line, character: unclosed.col + 1 }
            },
            message: `Unclosed '${unclosed.char}' — expected '${closeFor[unclosed.char]}'.`,
            source: 'IFF'
        });
    }
    // ── Undeclared variable check ──
    const declaredVars  = new Set();
    const declaredCons  = new Set();
    const declaredFuncs = new Set();
    const varDecl   = /\bvar\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const funcDecl  = /\bfunc\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const classDecl = /\bclass\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const conDecl   = /\bcon\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const forVar    = /\bfor\s*\(\s*(?:var|con)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match;
    while ((match = varDecl.exec(text))   !== null) declaredVars.add(match[1]);
    while ((match = conDecl.exec(text))   !== null) declaredCons.add(match[1]);
    while ((match = funcDecl.exec(text))  !== null) declaredFuncs.add(match[1]);
    while ((match = classDecl.exec(text)) !== null) declaredFuncs.add(match[1]);
    while ((match = forVar.exec(text))    !== null) declaredVars.add(match[1]);
    const identifierUsage = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    const allKnown = new Set([
        ...KEYWORDS, ...BUILTINS,
        ...declaredVars, ...declaredFuncs, ...declaredCons
    ]);
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line    = lines[lineNum];
        const trimmed = line.trim();
        if (trimmed.startsWith('//')) continue;
        if (/^\s*["']/.test(line)) continue;
        if (/^\s*(var|con|func|class)\s/.test(line)) continue;
        const strippedLine = line.replace(/(["'])(?:(?!\1)[^\\]|\\.)*\1/g, '""');
        identifierUsage.lastIndex = 0;
        let m;
        while ((m = identifierUsage.exec(strippedLine)) !== null) {
            const name = m[1];
            if (allKnown.has(name)) continue;
            if (/^\d/.test(name)) continue;
            diagnostics.push({
                severity: node_1.DiagnosticSeverity.Warning,
                range: {
                    start: { line: lineNum, character: m.index },
                    end:   { line: lineNum, character: m.index + name.length }
                },
                message: `'${name}' is not declared.`,
                source: 'IFF'
            });
            allKnown.add(name);
        }
    }
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
// ─── Completions ─────────────────────────────────────────────────────────────
connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const text  = doc.getText();
    const items = [];
    for (const kw of KEYWORDS) {
        items.push({ label: kw, kind: node_1.CompletionItemKind.Keyword });
    }
    for (const b of BUILTINS) {
        items.push({ label: b, kind: node_1.CompletionItemKind.Constant });
    }
    const varDecl   = /\bvar\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const conDecl   = /\bcon\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const funcDecl  = /\bfunc\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const classDecl = /\bclass\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const forVar    = /\bfor\s*\(\s*(?:var|con)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let m;
    while ((m = varDecl.exec(text))   !== null) items.push({ label: m[1], kind: node_1.CompletionItemKind.Variable });
    while ((m = conDecl.exec(text))   !== null) items.push({ label: m[1], kind: node_1.CompletionItemKind.Constant });
    while ((m = funcDecl.exec(text))  !== null) items.push({ label: m[1], kind: node_1.CompletionItemKind.Function });
    while ((m = classDecl.exec(text)) !== null) items.push({ label: m[1], kind: node_1.CompletionItemKind.Class    });
    while ((m = forVar.exec(text))    !== null) items.push({ label: m[1], kind: node_1.CompletionItemKind.Variable });
    // Snippets
    items.push({ label: 'func',     kind: node_1.CompletionItemKind.Snippet, insertText: 'func ${1:name}(${2:params}) {\n\t${3}\n}',              insertTextFormat: 2, detail: 'Function declaration' });
    items.push({ label: 'if',       kind: node_1.CompletionItemKind.Snippet, insertText: 'if (${1:condition}) {\n\t${2}\n}',                       insertTextFormat: 2, detail: 'If statement' });
    items.push({ label: 'if-else',  kind: node_1.CompletionItemKind.Snippet, insertText: 'if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}',    insertTextFormat: 2, detail: 'If-else statement' });
    items.push({ label: 'while',    kind: node_1.CompletionItemKind.Snippet, insertText: 'while (${1:condition}) {\n\t${2}\n}',                    insertTextFormat: 2, detail: 'While loop' });
    items.push({ label: 'for',      kind: node_1.CompletionItemKind.Snippet, insertText: 'for (var ${1:i} in ${2:0}->${3:10}) {\n\t${4}\n}',      insertTextFormat: 2, detail: 'For range loop' });
    items.push({ label: 'match',    kind: node_1.CompletionItemKind.Snippet, insertText: 'match (${1:value}) {\n\tcase ${2:val}: ${3}\n\tdefault: ${4}\n}', insertTextFormat: 2, detail: 'Match statement' });
    items.push({ label: 'class',    kind: node_1.CompletionItemKind.Snippet, insertText: 'class ${1:Name} {\n\t${2}\n}',                           insertTextFormat: 2, detail: 'Class declaration' });
    return items;
});
connection.onCompletionResolve((item) => item);
// ─── Start ───────────────────────────────────────────────────────────────────
documents.listen(connection);
connection.listen();