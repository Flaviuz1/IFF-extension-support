# IFF Language Support

Visual Studio Code extension for the **IFF programming language** — providing syntax highlighting, smart completions, and real-time diagnostics.

---

## Features

### Syntax Highlighting
Full syntax highlighting for all IFF language constructs:
- Keywords (`if`, `else`, `while`, `for`, `func`, `class`, `var`, ...)
- String literals with single and double quotes
- String interpolation with `${}`
- Numbers, booleans, and `null`
- Line comments `//` and block comments `/* */`
- All operators and punctuation

### Auto Completion
As you type, the extension suggests:
- All language keywords
- Built-in constants (`true`, `false`, `null`)
- Variables, functions, and classes declared anywhere in the current file

### Snippets
Expand common constructs instantly:

| Type | Expands to |
|------|-----------|
| `func` | Function declaration with body |
| `if` | If statement with condition |
| `while` | While loop |
| `for` | For-in loop |
| `class` | Class declaration |

### Diagnostics
Real-time error and warning detection as you type:
- **Missing semicolons** — warns on lines that should end with `;`
- **Unclosed brackets** — detects unmatched `(`, `[`, `{`
- **Unexpected closing brackets** — flags `)`, `]`, `}` with no matching opener
- **Undeclared identifiers** — warns when a variable or function is used before being declared

---

## File Extension

This extension activates on files with the `.iff` extension.

---

## IFF Language

IFF is a custom programming language with a clean, expressive syntax. It supports:
- Variables (`var`)
- Functions (`func`)
- Classes with `self` and `super`
- Control flow: `if/else`, `while`, `for/in`, `match/case`
- String interpolation: `"Hello ${name}"`
- Operators: arithmetic, bitwise, comparison, logical, ternary
- `break`, `continue`, `return`
- Single-line (`//`) and block (`/* */`) comments

---

## Requirements

No dependencies required. The extension works out of the box.

---

## Release Notes

### 0.0.3
Initial release:
- Syntax highlighting
- Auto completion
- Snippet expansion
- Real-time diagnostics