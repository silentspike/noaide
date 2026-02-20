use pulldown_cmark::{Parser, html};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn render(markdown: &str) -> String {
    let parser = Parser::new(markdown);
    let mut output = String::new();
    html::push_html(&mut output, parser);
    output
}
