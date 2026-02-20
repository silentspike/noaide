use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Result<Vec<u8>, JsError> {
    zstd::stream::decode_all(data).map_err(|e| JsError::new(&e.to_string()))
}
