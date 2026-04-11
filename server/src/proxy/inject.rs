//! System prompt injection with configurable presets.
//!
//! Supports injecting text into API request bodies for Anthropic, Google, and OpenAI
//! providers. Presets provide pre-defined injection texts; custom text can also be used.

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
// tracing used by inject_into_body callers, not here directly

/// Available injection presets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    /// Prevent lazy/incomplete responses
    AntiLaziness,
    /// Require evidence/verification for claims
    VerifyEvidence,
    /// Optimize for speed/conciseness
    Speed,
    /// Request verbose/detailed responses
    Verbose,
    /// Respond only in German
    GermanOnly,
    /// noaide media-aware context (built-in default)
    NoaideContext,
}

impl Preset {
    pub fn text(&self) -> &'static str {
        match self {
            Preset::AntiLaziness => {
                "\
[ANTI-LAZINESS] You MUST complete ALL requested work. Never use shortcuts like \
'// ... rest of the code remains the same', '... (remaining code omitted)', or \
similar truncation patterns. If asked to write code, write the COMPLETE code. \
If asked to make changes, show the FULL changed file, not just snippets. \
Incomplete work is UNACCEPTABLE."
            }

            Preset::VerifyEvidence => {
                "\
[VERIFY-EVIDENCE] For every claim or assertion you make, provide concrete evidence: \
exact command output, file contents, test results, or measurements. \
Never write PASS, OK, or 'verified' without an actual executed command and its output. \
'Code looks correct' is NOT evidence. Default state of any claim is UNTESTED."
            }

            Preset::Speed => {
                "\
[SPEED] Be concise and efficient. Skip preamble, go straight to the answer. \
No unnecessary explanations unless asked. Prefer bullet points over paragraphs."
            }

            Preset::Verbose => {
                "\
[VERBOSE] Provide detailed explanations with step-by-step reasoning. \
Show your thought process. Include relevant context and alternatives considered."
            }

            Preset::GermanOnly => {
                "\
[SPRACHE] Antworte AUSSCHLIESSLICH auf Deutsch. Technische Fachbegriffe und \
Code-Identifier bleiben auf Englisch, aber alle Erklaerungen, Kommentare und \
Kommunikation MUESSEN auf Deutsch sein."
            }

            Preset::NoaideContext => {
                "\
[noaide] You are running inside noaide, a browser-based IDE. \
Media files you create (images, GIFs, SVGs, audio, video) via Bash or Write tools \
are rendered inline in the chat. The user sees them directly. \
Supported: PNG, JPG, GIF, SVG, WEBP, MP4, WEBM, MP3, WAV, OGG. \
To show an image, just create the file (e.g. python3, ImageMagick, ffmpeg, \
or write SVG directly)."
            }
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Preset::AntiLaziness => "Anti-Laziness",
            Preset::VerifyEvidence => "Verify Evidence",
            Preset::Speed => "Speed",
            Preset::Verbose => "Verbose",
            Preset::GermanOnly => "German Only",
            Preset::NoaideContext => "noaide Context",
        }
    }
}

/// Per-session injection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectConfig {
    pub presets: Vec<Preset>,
    pub custom_text: Option<String>,
}

impl Default for InjectConfig {
    fn default() -> Self {
        Self {
            presets: vec![Preset::NoaideContext],
            custom_text: None,
        }
    }
}

/// Build the full injection text from active presets + custom text.
pub fn build_injection(config: &InjectConfig) -> String {
    let mut parts: Vec<&str> = config.presets.iter().map(|p| p.text()).collect();
    if let Some(ref custom) = config.custom_text
        && !custom.is_empty()
    {
        parts.push(custom);
    }
    parts.join("\n\n")
}

/// Inject text into an API request body for the given provider.
///
/// Returns `true` if injection was successful.
pub fn inject_into_body(
    body: &mut serde_json::Value,
    provider: super::handler::ApiProvider,
    text: &str,
) -> bool {
    use super::handler::ApiProvider;

    match provider {
        ApiProvider::Anthropic => {
            match body.get("system") {
                Some(serde_json::Value::String(s)) => {
                    body["system"] = serde_json::Value::String(format!("{s}\n\n{text}"));
                }
                Some(serde_json::Value::Array(_)) => {
                    if let Some(arr) = body["system"].as_array_mut() {
                        arr.push(serde_json::json!({
                            "type": "text",
                            "text": text,
                        }));
                    }
                }
                _ => {
                    body["system"] = serde_json::Value::String(text.to_string());
                }
            }
            true
        }
        ApiProvider::Google => {
            // Google APIs commonly expose camelCase JSON names, but keep reading
            // existing snake_case variants for backward compatibility.
            for target in [
                &["systemInstruction", "parts"][..],
                &["system_instruction", "parts"][..],
                &["request", "systemInstruction", "parts"][..],
                &["request", "system_instruction", "parts"][..],
            ] {
                if append_text_part(body, target, text) {
                    return true;
                }
            }

            body["systemInstruction"] = serde_json::json!({
                "parts": [{"text": text}]
            });
            true
        }
        ApiProvider::GoogleCodeAssist => {
            // Gemini Code Assist uses nested request.systemInstruction with
            // camelCase field names. Top-level snake_case breaks the request
            // with INVALID_ARGUMENT on cloudcode-pa.googleapis.com.
            for target in [
                &["request", "systemInstruction", "parts"][..],
                &["request", "system_instruction", "parts"][..],
                &["systemInstruction", "parts"][..],
                &["system_instruction", "parts"][..],
            ] {
                if append_text_part(body, target, text) {
                    return true;
                }
            }

            if !body.get("request").is_some_and(|value| value.is_object()) {
                body["request"] = serde_json::json!({});
            }
            body["request"]["systemInstruction"] = serde_json::json!({
                "role": "user",
                "parts": [{"text": text}]
            });
            true
        }
        ApiProvider::OpenAI | ApiProvider::ChatGPT => {
            // Codex/Responses API keeps the system prompt in a top-level
            // "instructions" string instead of a messages/input system block.
            if let Some(instructions) = body.get_mut("instructions").and_then(|v| v.as_str()) {
                let merged = if instructions.is_empty() {
                    text.to_string()
                } else {
                    format!("{instructions}\n\n{text}")
                };
                body["instructions"] = serde_json::Value::String(merged);
                return true;
            }

            // Otherwise prepend a system message to messages/input.
            let msg_key = if body.get("input").is_some() {
                "input"
            } else {
                "messages"
            };
            if let Some(arr) = body.get_mut(msg_key).and_then(|v| v.as_array_mut()) {
                arr.insert(
                    0,
                    serde_json::json!({
                        "role": "system",
                        "content": text,
                    }),
                );
                true
            } else {
                false
            }
        }
    }
}

fn append_text_part(body: &mut serde_json::Value, path: &[&str], text: &str) -> bool {
    let mut cursor = body;
    for (index, key) in path.iter().enumerate() {
        if index == path.len() - 1 {
            if let Some(parts) = cursor.get_mut(*key).and_then(|value| value.as_array_mut()) {
                parts.push(serde_json::json!({ "text": text }));
                return true;
            }
            return false;
        }

        let Some(next) = cursor.get_mut(*key) else {
            return false;
        };
        cursor = next;
    }

    false
}

/// Per-session inject config storage.
pub struct InjectStore {
    configs: DashMap<String, InjectConfig>,
}

impl InjectStore {
    pub fn new() -> Self {
        Self {
            configs: DashMap::new(),
        }
    }

    pub fn get(&self, session_id: &str) -> InjectConfig {
        self.configs
            .get(session_id)
            .map(|r| r.value().clone())
            .unwrap_or_default()
    }

    pub fn set(&self, session_id: String, config: InjectConfig) {
        self.configs.insert(session_id, config);
    }
}

impl Default for InjectStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_noaide_preset() {
        let config = InjectConfig::default();
        assert_eq!(config.presets, vec![Preset::NoaideContext]);
    }

    #[test]
    fn build_injection_combines_presets_and_custom() {
        let config = InjectConfig {
            presets: vec![Preset::AntiLaziness, Preset::GermanOnly],
            custom_text: Some("Custom instruction".to_string()),
        };
        let text = build_injection(&config);
        assert!(text.contains("[ANTI-LAZINESS]"));
        assert!(text.contains("[SPRACHE]"));
        assert!(text.contains("Custom instruction"));
    }

    #[test]
    fn inject_anthropic_string_system() {
        let mut body = serde_json::json!({
            "model": "claude-opus-4-6",
            "system": "You are helpful.",
            "messages": []
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::Anthropic,
            "injected text",
        );
        assert!(result);
        let system = body["system"].as_str().unwrap();
        assert!(system.contains("You are helpful."));
        assert!(system.contains("injected text"));
    }

    #[test]
    fn inject_anthropic_array_system() {
        let mut body = serde_json::json!({
            "model": "claude-opus-4-6",
            "system": [{"type": "text", "text": "existing"}],
            "messages": []
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::Anthropic,
            "injected",
        );
        assert!(result);
        let arr = body["system"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }

    #[test]
    fn inject_anthropic_no_system() {
        let mut body = serde_json::json!({
            "model": "claude-opus-4-6",
            "messages": []
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::Anthropic,
            "new system",
        );
        assert!(result);
        assert_eq!(body["system"].as_str().unwrap(), "new system");
    }

    #[test]
    fn inject_google_system_instruction() {
        let mut body = serde_json::json!({
            "system_instruction": {"parts": [{"text": "existing"}]},
            "contents": []
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::Google,
            "injected",
        );
        assert!(result);
        let parts = body["system_instruction"]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn inject_google_creates_system_instruction() {
        let mut body = serde_json::json!({
            "contents": []
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::Google,
            "new instruction",
        );
        assert!(result);
        assert!(body["systemInstruction"]["parts"].is_array());
    }

    #[test]
    fn inject_google_codeassist_creates_nested_system_instruction() {
        let mut body = serde_json::json!({
            "model": "gemini-2.5-flash-lite",
            "request": {
                "contents": []
            }
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::GoogleCodeAssist,
            "new instruction",
        );
        assert!(result);
        assert_eq!(body["request"]["systemInstruction"]["role"], "user");
        assert!(body["request"]["systemInstruction"]["parts"].is_array());
        assert!(body.get("system_instruction").is_none());
    }

    #[test]
    fn inject_google_codeassist_appends_existing_nested_system_instruction() {
        let mut body = serde_json::json!({
            "request": {
                "systemInstruction": {
                    "role": "user",
                    "parts": [{"text": "existing"}]
                },
                "contents": []
            }
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::GoogleCodeAssist,
            "injected",
        );
        assert!(result);
        let parts = body["request"]["systemInstruction"]["parts"]
            .as_array()
            .unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["text"], "injected");
    }

    #[test]
    fn inject_openai_prepends_system_message() {
        let mut body = serde_json::json!({
            "model": "gpt-4",
            "messages": [{"role": "user", "content": "hello"}]
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::OpenAI,
            "system text",
        );
        assert!(result);
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert!(
            messages[0]["content"]
                .as_str()
                .unwrap()
                .contains("system text")
        );
    }

    #[test]
    fn inject_chatgpt_appends_instructions_string() {
        let mut body = serde_json::json!({
            "type": "response.create",
            "model": "gpt-5.4",
            "instructions": "existing instructions",
            "input": [{"role": "user", "content": "hello"}]
        });
        let result = inject_into_body(
            &mut body,
            super::super::handler::ApiProvider::ChatGPT,
            "system text",
        );
        assert!(result);
        let instructions = body["instructions"].as_str().unwrap();
        assert!(instructions.contains("existing instructions"));
        assert!(instructions.contains("system text"));
        let input = body["input"].as_array().unwrap();
        assert_eq!(input.len(), 1, "instructions path should not prepend input");
    }

    #[test]
    fn preset_serde_roundtrip() {
        let json = serde_json::to_string(&Preset::AntiLaziness).unwrap();
        assert_eq!(json, "\"anti_laziness\"");
        let parsed: Preset = serde_json::from_str("\"verify_evidence\"").unwrap();
        assert_eq!(parsed, Preset::VerifyEvidence);
    }
}
