use anyhow::Context;

use crate::bus::EventEnvelope;

// ── Codec IDs ────────────────────────────────────────────────────────────────

/// Codec identifier byte in the frame header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CodecId {
    /// MessagePack (flexible, used for all paths currently).
    MessagePack = 0x01,
    /// FlatBuffers (zero-copy, reserved for future hot path optimization).
    FlatBuffers = 0x02,
}

impl CodecId {
    fn from_byte(b: u8) -> anyhow::Result<Self> {
        match b {
            0x01 => Ok(Self::MessagePack),
            0x02 => Ok(Self::FlatBuffers),
            _ => anyhow::bail!("unknown codec id: 0x{b:02x}"),
        }
    }
}

/// Which codec path to use for a given topic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodecPath {
    /// High-frequency events (~200/sec): session/messages, files/changes.
    Hot,
    /// Low-frequency events (~2/sec): system/events, api/requests, etc.
    Cold,
}

/// Determine the codec path for a topic.
pub fn codec_path_for_topic(topic: &str) -> CodecPath {
    match topic {
        "session/messages" | "files/changes" => CodecPath::Hot,
        _ => CodecPath::Cold,
    }
}

// ── Wire Codec ───────────────────────────────────────────────────────────────

/// Wire codec for encoding/decoding EventEnvelopes.
///
/// Frame format: `[1 byte codec_id][4 bytes payload_len (BE)][compressed payload]`
///
/// Currently uses MessagePack for both hot and cold paths.
/// FlatBuffers hot path is reserved for future optimization once
/// the schema is compiled and integrated.
pub struct WireCodec;

/// Zstd compression level (3 = fast, good ratio).
const ZSTD_LEVEL: i32 = 3;

impl WireCodec {
    /// Encode an EventEnvelope into a framed wire format.
    ///
    /// 1. Serialize to MessagePack
    /// 2. Compress with Zstd
    /// 3. Prepend frame header (codec_id + length)
    pub fn encode(envelope: &EventEnvelope, _path: CodecPath) -> anyhow::Result<Vec<u8>> {
        // Serialize with MessagePack (both paths for now)
        let serialized = rmp_serde::to_vec_named(envelope).context("msgpack encode failed")?;

        // Compress
        let compressed = Self::compress(&serialized)?;

        // Frame: [codec_id: 1][length: 4 BE][payload]
        let codec_id = CodecId::MessagePack as u8;
        let len = compressed.len() as u32;
        let mut frame = Vec::with_capacity(5 + compressed.len());
        frame.push(codec_id);
        frame.extend_from_slice(&len.to_be_bytes());
        frame.extend_from_slice(&compressed);

        Ok(frame)
    }

    /// Decode a framed wire format back to an EventEnvelope.
    pub fn decode(data: &[u8]) -> anyhow::Result<EventEnvelope> {
        anyhow::ensure!(data.len() >= 5, "frame too short: {} bytes", data.len());

        let codec_id = CodecId::from_byte(data[0])?;
        let len = u32::from_be_bytes([data[1], data[2], data[3], data[4]]) as usize;

        anyhow::ensure!(
            data.len() >= 5 + len,
            "frame truncated: expected {} payload bytes, got {}",
            len,
            data.len() - 5
        );

        let compressed = &data[5..5 + len];
        let decompressed = Self::decompress(compressed)?;

        match codec_id {
            CodecId::MessagePack => {
                let envelope: EventEnvelope =
                    rmp_serde::from_slice(&decompressed).context("msgpack decode failed")?;
                Ok(envelope)
            }
            CodecId::FlatBuffers => {
                anyhow::bail!("FlatBuffers decode not yet implemented")
            }
        }
    }

    /// Compress data with Zstd.
    pub fn compress(data: &[u8]) -> anyhow::Result<Vec<u8>> {
        zstd::encode_all(data, ZSTD_LEVEL).context("zstd compress failed")
    }

    /// Decompress Zstd data.
    pub fn decompress(data: &[u8]) -> anyhow::Result<Vec<u8>> {
        zstd::decode_all(data).context("zstd decompress failed")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bus::topics::{EventEnvelope, EventSource};
    use uuid::Uuid;

    fn test_envelope() -> EventEnvelope {
        EventEnvelope::new(
            EventSource::Jsonl,
            1,
            1,
            Some(Uuid::nil()),
            b"test payload data for compression ratio measurement".to_vec(),
        )
    }

    #[test]
    fn encode_decode_roundtrip_cold() {
        let original = test_envelope();
        let encoded = WireCodec::encode(&original, CodecPath::Cold).unwrap();
        let decoded = WireCodec::decode(&encoded).unwrap();

        assert_eq!(decoded.source, original.source);
        assert_eq!(decoded.sequence, original.sequence);
        assert_eq!(decoded.payload, original.payload);
    }

    #[test]
    fn encode_decode_roundtrip_hot() {
        let original = test_envelope();
        let encoded = WireCodec::encode(&original, CodecPath::Hot).unwrap();
        let decoded = WireCodec::decode(&encoded).unwrap();

        assert_eq!(decoded.source, original.source);
        assert_eq!(decoded.payload, original.payload);
    }

    #[test]
    fn frame_format_header() {
        let envelope = test_envelope();
        let encoded = WireCodec::encode(&envelope, CodecPath::Cold).unwrap();

        // First byte is codec ID
        assert_eq!(encoded[0], CodecId::MessagePack as u8);

        // Next 4 bytes are payload length (BE)
        let len = u32::from_be_bytes([encoded[1], encoded[2], encoded[3], encoded[4]]) as usize;
        assert_eq!(encoded.len(), 5 + len);
    }

    #[test]
    fn decode_truncated_frame() {
        assert!(WireCodec::decode(&[0x01, 0, 0, 0]).is_err()); // too short
        assert!(WireCodec::decode(&[0x01, 0, 0, 0, 10]).is_err()); // truncated payload
    }

    #[test]
    fn decode_unknown_codec() {
        let data = [0xFF, 0, 0, 0, 0];
        assert!(WireCodec::decode(&data).is_err());
    }

    #[test]
    fn zstd_compress_decompress() {
        let original = b"hello world repeated many times for better compression ratio hello world hello world hello world";
        let compressed = WireCodec::compress(original).unwrap();
        let decompressed = WireCodec::decompress(&compressed).unwrap();
        assert_eq!(decompressed, original);
        assert!(compressed.len() < original.len());
    }

    #[test]
    fn zstd_compression_ratio() {
        // Simulate a realistic JSONL-like payload
        let payload = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll help you implement that function. Let me read the file first to understand the current code structure and then make the necessary changes."}],"model":"claude-sonnet-4-20250514","stop_reason":"end_turn","usage":{"input_tokens":1500,"output_tokens":200}},"uuid":"abc-123","sessionId":"session-456","timestamp":"2026-02-21T10:00:00.000Z"}"#;

        let compressed = WireCodec::compress(payload.as_bytes()).unwrap();
        let ratio = 1.0 - (compressed.len() as f64 / payload.len() as f64);
        // Zstd achieves ~30%+ on short JSON, ~70%+ on larger payloads
        assert!(
            ratio > 0.25,
            "compression ratio too low: {:.1}% (expected >25%)",
            ratio * 100.0
        );
    }

    #[test]
    fn codec_path_for_topic_mapping() {
        assert_eq!(codec_path_for_topic("session/messages"), CodecPath::Hot);
        assert_eq!(codec_path_for_topic("files/changes"), CodecPath::Hot);
        assert_eq!(codec_path_for_topic("system/events"), CodecPath::Cold);
        assert_eq!(codec_path_for_topic("api/requests"), CodecPath::Cold);
        assert_eq!(codec_path_for_topic("tasks/updates"), CodecPath::Cold);
    }

    #[test]
    fn encode_with_dedup_key() {
        let envelope = test_envelope().with_dedup("pty:1:echo".into());
        let encoded = WireCodec::encode(&envelope, CodecPath::Cold).unwrap();
        let decoded = WireCodec::decode(&encoded).unwrap();
        assert_eq!(decoded.dedup_key, Some("pty:1:echo".into()));
    }

    #[test]
    fn encode_empty_payload() {
        let envelope = EventEnvelope::new(EventSource::User, 0, 0, None, vec![]);
        let encoded = WireCodec::encode(&envelope, CodecPath::Cold).unwrap();
        let decoded = WireCodec::decode(&encoded).unwrap();
        assert!(decoded.payload.is_empty());
    }
}
