use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn parse_line(line: &str) -> Result<JsValue, JsError> {
    let _value: serde_json::Value =
        serde_json::from_str(line).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(JsValue::TRUE)
}
