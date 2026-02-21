use pulldown_cmark::{Options, Parser, html};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn render(markdown: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(markdown, options);
    let mut output = String::with_capacity(markdown.len() * 2);
    html::push_html(&mut output, parser);

    // Basic sanitization: strip script tags
    sanitize_html(&mut output);

    output
}

#[wasm_bindgen]
pub fn render_with_code_classes(markdown: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(markdown, options);
    let mut output = String::with_capacity(markdown.len() * 2);
    html::push_html(&mut output, parser);

    sanitize_html(&mut output);

    output
}

fn sanitize_html(html: &mut String) {
    // Remove script tags (case-insensitive)
    while let Some(start) = html.to_lowercase().find("<script") {
        if let Some(end) = html.to_lowercase()[start..].find("</script>") {
            html.replace_range(start..start + end + 9, "");
        } else {
            // Unclosed script tag — remove to end
            html.truncate(start);
            break;
        }
    }
    // Remove event handlers
    let patterns = ["onclick=", "onerror=", "onload=", "onmouseover="];
    for pat in patterns {
        while html.contains(pat) {
            if let Some(pos) = html.find(pat) {
                // Find the end of the attribute value
                let after = &html[pos + pat.len()..];
                let end = if after.starts_with('"') {
                    after[1..].find('"').map(|p| pos + pat.len() + p + 2)
                } else if after.starts_with('\'') {
                    after[1..].find('\'').map(|p| pos + pat.len() + p + 2)
                } else {
                    after.find([' ', '>', '/']).map(|p| pos + pat.len() + p)
                };
                if let Some(end) = end {
                    html.replace_range(pos..end, "");
                } else {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_basic_markdown() {
        let result = render("# Hello\n\nWorld");
        assert!(result.contains("<h1>Hello</h1>"));
        assert!(result.contains("<p>World</p>"));
    }

    #[test]
    fn renders_tables() {
        let md = "| A | B |\n|---|---|\n| 1 | 2 |";
        let result = render(md);
        assert!(result.contains("<table>"));
        assert!(result.contains("<td>1</td>"));
    }

    #[test]
    fn renders_task_lists() {
        let md = "- [x] Done\n- [ ] Todo";
        let result = render(md);
        assert!(result.contains("checked"));
    }

    #[test]
    fn renders_strikethrough() {
        let md = "~~deleted~~";
        let result = render(md);
        assert!(result.contains("<del>deleted</del>"));
    }

    #[test]
    fn renders_code_blocks() {
        let md = "```rust\nfn main() {}\n```";
        let result = render(md);
        assert!(result.contains("<code"));
        assert!(result.contains("fn main()"));
    }

    #[test]
    fn sanitizes_script_tags() {
        let mut html = String::from("<p>Hello</p><script>alert('xss')</script><p>World</p>");
        sanitize_html(&mut html);
        assert!(!html.contains("script"));
        assert!(html.contains("Hello"));
        assert!(html.contains("World"));
    }
}
