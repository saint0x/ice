use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxProfile {
    pub language_id: String,
    pub display_name: String,
    pub line_comment: Option<String>,
    pub block_comment_start: Option<String>,
    pub block_comment_end: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxToken {
    pub line: usize,
    pub start: usize,
    pub length: usize,
    pub token_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxTokensResponse {
    pub profile: SyntaxProfile,
    pub tokens: Vec<SyntaxToken>,
}

pub struct SyntaxService;

impl SyntaxService {
    pub fn new() -> Self {
        Self
    }

    pub fn profile_for_path(&self, path: &str) -> SyntaxProfile {
        detect_language_profile(path)
    }

    pub fn tokens_for_text(&self, path: &str, content: &str) -> SyntaxTokensResponse {
        let profile = detect_language_profile(path);
        let language = language_spec(&profile.language_id);
        let tokens = collect_tokens(content, language);
        SyntaxTokensResponse { profile, tokens }
    }
}

#[derive(Debug, Clone, Copy)]
struct LanguageSpec {
    id: &'static str,
    display_name: &'static str,
    keywords: &'static [&'static str],
    line_comment: Option<&'static str>,
    block_comment_start: Option<&'static str>,
    block_comment_end: Option<&'static str>,
}

const RUST_KEYWORDS: &[&str] = &[
    "as", "async", "await", "break", "const", "continue", "crate", "else", "enum", "extern",
    "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub",
    "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type",
    "unsafe", "use", "where", "while",
];
const JS_KEYWORDS: &[&str] = &[
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "yield",
];
const TS_KEYWORDS: &[&str] = &[
    "abstract",
    "any",
    "as",
    "async",
    "await",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "infer",
    "instanceof",
    "interface",
    "keyof",
    "let",
    "module",
    "namespace",
    "new",
    "null",
    "number",
    "readonly",
    "return",
    "satisfies",
    "static",
    "string",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "unknown",
    "var",
    "void",
    "while",
];
const PYTHON_KEYWORDS: &[&str] = &[
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
    "else", "except", "False", "finally", "for", "from", "if", "import", "in", "is", "lambda",
    "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with",
    "yield",
];
const GO_KEYWORDS: &[&str] = &[
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
];
const SHELL_KEYWORDS: &[&str] = &[
    "case", "coproc", "do", "done", "elif", "else", "esac", "export", "fi", "for", "function",
    "if", "in", "local", "readonly", "return", "select", "then", "time", "until", "while",
];
const JSON_KEYWORDS: &[&str] = &["true", "false", "null"];
const YAML_KEYWORDS: &[&str] = &["true", "false", "null", "yes", "no", "on", "off"];
const TOML_KEYWORDS: &[&str] = &["true", "false"];
const HTML_KEYWORDS: &[&str] = &[
    "html", "head", "body", "div", "span", "script", "style", "link", "meta", "title", "main",
    "section", "article", "header", "footer", "nav", "button", "input", "textarea", "form",
];
const CSS_KEYWORDS: &[&str] = &[
    "@media",
    "@supports",
    "display",
    "position",
    "absolute",
    "relative",
    "grid",
    "flex",
    "color",
    "background",
    "padding",
    "margin",
    "border",
    "font",
    "height",
    "width",
];
const SQL_KEYWORDS: &[&str] = &[
    "select", "from", "where", "join", "left", "right", "inner", "outer", "insert", "update",
    "delete", "create", "alter", "drop", "table", "index", "view", "into", "values", "order",
    "group", "by", "limit", "offset", "having", "union", "distinct", "as", "and", "or", "not",
];
const MARKDOWN_KEYWORDS: &[&str] = &[];

fn detect_language_profile(path: &str) -> SyntaxProfile {
    let spec = language_spec(detect_language_id(path));
    SyntaxProfile {
        language_id: spec.id.to_string(),
        display_name: spec.display_name.to_string(),
        line_comment: spec.line_comment.map(str::to_string),
        block_comment_start: spec.block_comment_start.map(str::to_string),
        block_comment_end: spec.block_comment_end.map(str::to_string),
    }
}

fn detect_language_id(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".rs") {
        "rust"
    } else if lower.ends_with(".tsx") || lower.ends_with(".ts") {
        "typescript"
    } else if lower.ends_with(".jsx") || lower.ends_with(".js") || lower.ends_with(".mjs") {
        "javascript"
    } else if lower.ends_with(".py") {
        "python"
    } else if lower.ends_with(".go") {
        "go"
    } else if lower.ends_with(".json") {
        "json"
    } else if lower.ends_with(".yaml") || lower.ends_with(".yml") {
        "yaml"
    } else if lower.ends_with(".toml") {
        "toml"
    } else if lower.ends_with(".md") {
        "markdown"
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        "html"
    } else if lower.ends_with(".css") {
        "css"
    } else if lower.ends_with(".sql") {
        "sql"
    } else if lower.ends_with(".sh") || lower.ends_with(".zsh") || lower.ends_with(".bashrc") {
        "shell"
    } else {
        "plaintext"
    }
}

fn language_spec(id: &str) -> LanguageSpec {
    match id {
        "rust" => LanguageSpec {
            id: "rust",
            display_name: "Rust",
            keywords: RUST_KEYWORDS,
            line_comment: Some("//"),
            block_comment_start: Some("/*"),
            block_comment_end: Some("*/"),
        },
        "typescript" => LanguageSpec {
            id: "typescript",
            display_name: "TypeScript",
            keywords: TS_KEYWORDS,
            line_comment: Some("//"),
            block_comment_start: Some("/*"),
            block_comment_end: Some("*/"),
        },
        "javascript" => LanguageSpec {
            id: "javascript",
            display_name: "JavaScript",
            keywords: JS_KEYWORDS,
            line_comment: Some("//"),
            block_comment_start: Some("/*"),
            block_comment_end: Some("*/"),
        },
        "python" => LanguageSpec {
            id: "python",
            display_name: "Python",
            keywords: PYTHON_KEYWORDS,
            line_comment: Some("#"),
            block_comment_start: None,
            block_comment_end: None,
        },
        "go" => LanguageSpec {
            id: "go",
            display_name: "Go",
            keywords: GO_KEYWORDS,
            line_comment: Some("//"),
            block_comment_start: Some("/*"),
            block_comment_end: Some("*/"),
        },
        "json" => LanguageSpec {
            id: "json",
            display_name: "JSON",
            keywords: JSON_KEYWORDS,
            line_comment: None,
            block_comment_start: None,
            block_comment_end: None,
        },
        "yaml" => LanguageSpec {
            id: "yaml",
            display_name: "YAML",
            keywords: YAML_KEYWORDS,
            line_comment: Some("#"),
            block_comment_start: None,
            block_comment_end: None,
        },
        "toml" => LanguageSpec {
            id: "toml",
            display_name: "TOML",
            keywords: TOML_KEYWORDS,
            line_comment: Some("#"),
            block_comment_start: None,
            block_comment_end: None,
        },
        "markdown" => LanguageSpec {
            id: "markdown",
            display_name: "Markdown",
            keywords: MARKDOWN_KEYWORDS,
            line_comment: None,
            block_comment_start: None,
            block_comment_end: None,
        },
        "html" => LanguageSpec {
            id: "html",
            display_name: "HTML",
            keywords: HTML_KEYWORDS,
            line_comment: None,
            block_comment_start: Some("<!--"),
            block_comment_end: Some("-->"),
        },
        "css" => LanguageSpec {
            id: "css",
            display_name: "CSS",
            keywords: CSS_KEYWORDS,
            line_comment: None,
            block_comment_start: Some("/*"),
            block_comment_end: Some("*/"),
        },
        "sql" => LanguageSpec {
            id: "sql",
            display_name: "SQL",
            keywords: SQL_KEYWORDS,
            line_comment: Some("--"),
            block_comment_start: Some("/*"),
            block_comment_end: Some("*/"),
        },
        "shell" => LanguageSpec {
            id: "shell",
            display_name: "Shell",
            keywords: SHELL_KEYWORDS,
            line_comment: Some("#"),
            block_comment_start: None,
            block_comment_end: None,
        },
        _ => LanguageSpec {
            id: "plaintext",
            display_name: "Plain Text",
            keywords: &[],
            line_comment: None,
            block_comment_start: None,
            block_comment_end: None,
        },
    }
}

fn collect_tokens(content: &str, language: LanguageSpec) -> Vec<SyntaxToken> {
    let mut tokens = Vec::new();
    let line_comment = language.line_comment.map(str::as_bytes);

    for (line_idx, raw_line) in content.lines().enumerate() {
        let bytes = raw_line.as_bytes();
        if raw_line.trim().is_empty() {
            continue;
        }

        let mut cursor = 0usize;
        while cursor < bytes.len() {
            if let Some(marker) = line_comment {
                if matches_marker(bytes, cursor, marker) {
                    tokens.push(SyntaxToken {
                        line: line_idx,
                        start: cursor,
                        length: raw_line.len().saturating_sub(cursor),
                        token_type: "comment".to_string(),
                    });
                    break;
                }
            }

            let byte = bytes[cursor];
            if byte == b'"' || byte == b'\'' || byte == b'`' {
                let quote = byte;
                let start = cursor;
                cursor += 1;
                while cursor < bytes.len() {
                    if bytes[cursor] == b'\\' && cursor + 1 < bytes.len() {
                        cursor += 2;
                        continue;
                    }
                    if bytes[cursor] == quote {
                        cursor += 1;
                        break;
                    }
                    cursor += 1;
                }
                tokens.push(SyntaxToken {
                    line: line_idx,
                    start,
                    length: cursor.saturating_sub(start),
                    token_type: "string".to_string(),
                });
                continue;
            }

            if is_ident_start(byte) {
                let start = cursor;
                cursor += 1;
                while cursor < bytes.len() && is_ident_continue(bytes[cursor]) {
                    cursor += 1;
                }
                let ident = &raw_line[start..cursor];
                let lower = ident.to_ascii_lowercase();

                if language
                    .keywords
                    .iter()
                    .any(|keyword| *keyword == ident || *keyword == lower)
                {
                    tokens.push(SyntaxToken {
                        line: line_idx,
                        start,
                        length: ident.len(),
                        token_type: "keyword".to_string(),
                    });
                    continue;
                }

                if is_function_token(raw_line, start, cursor) {
                    tokens.push(SyntaxToken {
                        line: line_idx,
                        start,
                        length: ident.len(),
                        token_type: "function".to_string(),
                    });
                    continue;
                }

                if ident
                    .chars()
                    .next()
                    .is_some_and(|ch| ch.is_ascii_uppercase())
                {
                    tokens.push(SyntaxToken {
                        line: line_idx,
                        start,
                        length: ident.len(),
                        token_type: "type".to_string(),
                    });
                    continue;
                }

                tokens.push(SyntaxToken {
                    line: line_idx,
                    start,
                    length: ident.len(),
                    token_type: "variable".to_string(),
                });
                continue;
            }

            if byte.is_ascii_digit() {
                let start = cursor;
                cursor += 1;
                while cursor < bytes.len()
                    && (bytes[cursor].is_ascii_digit()
                        || matches!(bytes[cursor], b'.' | b'_' | b'x' | b'b'))
                {
                    cursor += 1;
                }
                tokens.push(SyntaxToken {
                    line: line_idx,
                    start,
                    length: cursor.saturating_sub(start),
                    token_type: "number".to_string(),
                });
                continue;
            }

            if is_operator(byte) {
                tokens.push(SyntaxToken {
                    line: line_idx,
                    start: cursor,
                    length: 1,
                    token_type: "operator".to_string(),
                });
            }

            cursor += 1;
        }
    }

    tokens.sort_by_key(|token| (token.line, token.start));
    tokens
}

fn is_function_token(line: &str, start: usize, end: usize) -> bool {
    let tail = &line[end..];
    if tail.trim_start().starts_with('(') {
        return true;
    }
    let before = &line[..start];
    before.ends_with("fn ")
        || before.ends_with("function ")
        || before.ends_with("func ")
        || before.ends_with("def ")
        || before.ends_with("class ")
        || before.ends_with("struct ")
}

fn is_ident_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_ident_continue(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'$')
}

fn is_operator(byte: u8) -> bool {
    matches!(
        byte,
        b'=' | b'+' | b'-' | b'*' | b'/' | b'!' | b'<' | b'>' | b'&' | b'|' | b'%' | b':' | b'?'
    )
}

fn matches_marker(line: &[u8], start: usize, marker: &[u8]) -> bool {
    start + marker.len() <= line.len() && &line[start..start + marker.len()] == marker
}

#[cfg(test)]
mod tests {
    use super::{detect_language_id, SyntaxService};

    #[test]
    fn detects_language_by_extension() {
        assert_eq!(detect_language_id("src/main.rs"), "rust");
        assert_eq!(detect_language_id("src/app.tsx"), "typescript");
        assert_eq!(detect_language_id("notes.md"), "markdown");
        assert_eq!(detect_language_id("unknown.txt"), "plaintext");
    }

    #[test]
    fn tokenizes_rust_keywords_strings_and_numbers() {
        let service = SyntaxService::new();
        let response = service.tokens_for_text(
            "src/main.rs",
            "fn main() { let value = 42; println!(\"hi\"); } // tail",
        );
        assert!(response
            .tokens
            .iter()
            .any(|token| token.token_type == "keyword"));
        assert!(response
            .tokens
            .iter()
            .any(|token| token.token_type == "function"));
        assert!(response
            .tokens
            .iter()
            .any(|token| token.token_type == "number"));
        assert!(response
            .tokens
            .iter()
            .any(|token| token.token_type == "string"));
        assert!(response
            .tokens
            .iter()
            .any(|token| token.token_type == "comment"));
    }

    #[test]
    fn tokenizes_typescript_profile() {
        let service = SyntaxService::new();
        let response = service.tokens_for_text(
            "src/app.tsx",
            "export function App(): JSX.Element { return <div /> }",
        );
        assert_eq!(response.profile.language_id, "typescript");
        assert!(response
            .tokens
            .iter()
            .any(|token| token.token_type == "keyword"));
        assert!(response
            .tokens
            .iter()
            .any(|token| token.token_type == "function"));
    }

    #[test]
    fn does_not_tokenize_keywords_inside_line_comments() {
        let service = SyntaxService::new();
        let response = service.tokens_for_text("src/main.rs", "let value = 1; // return fn");
        let comment = response
            .tokens
            .iter()
            .find(|token| token.token_type == "comment")
            .expect("comment token should be present");
        assert_eq!(comment.start, 15);
        assert_eq!(
            response
                .tokens
                .iter()
                .filter(|token| token.line == 0
                    && token.start >= comment.start
                    && token.token_type != "comment")
                .count(),
            0
        );
    }
}
