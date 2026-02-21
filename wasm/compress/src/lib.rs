use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn decompress(data: &[u8]) -> Result<Vec<u8>, JsError> {
    zstd::stream::decode_all(data).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn compress(data: &[u8], level: i32) -> Result<Vec<u8>, JsError> {
    zstd::stream::encode_all(data, level).map_err(|e| JsError::new(&e.to_string()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn roundtrip_compress_decompress() {
        let original = b"Hello, World! This is a test of Zstd compression in WASM.";
        let compressed = zstd::stream::encode_all(&original[..], 3).unwrap();
        let decompressed = zstd::stream::decode_all(&compressed[..]).unwrap();
        assert_eq!(decompressed, original);
    }

    #[test]
    fn decompress_empty_fails() {
        let result = zstd::stream::decode_all(&[][..]);
        assert!(result.is_err());
    }

    #[test]
    fn compress_empty_input() {
        let compressed = zstd::stream::encode_all(&[][..], 3).unwrap();
        let decompressed = zstd::stream::decode_all(&compressed[..]).unwrap();
        assert!(decompressed.is_empty());
    }
}
