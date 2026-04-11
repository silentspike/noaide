//! Request body rewriting — model override, parameter tweaks, and pure mode.
//!
//! Apply per-session rewrites to API request bodies before forwarding to upstream.
//! Supports model override, temperature, max tokens, thinking type, and pure mode
//! (strip provider-specific requests to their essential fields).

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::Map;
use tracing::debug;

/// Per-session rewrite configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct RewriteConfig {
    /// Override the model name in the request
    pub model_override: Option<String>,
    /// Override temperature
    pub temperature: Option<f64>,
    /// Override max tokens
    pub max_tokens: Option<u64>,
    /// Override thinking type (for Anthropic extended thinking)
    pub thinking_type: Option<String>,
    /// Pure mode: strip provider-specific request bodies to essentials
    pub pure_mode: bool,
    /// Remove top-level system prompt fields / system messages
    pub strip_system_prompt: bool,
    /// Remove tool declarations and tool-choice hints
    pub strip_tools: bool,
}

impl RewriteConfig {
    pub fn is_active(&self) -> bool {
        self.model_override.is_some()
            || self.temperature.is_some()
            || self.max_tokens.is_some()
            || self.thinking_type.is_some()
            || self.pure_mode
            || self.strip_system_prompt
            || self.strip_tools
    }
}

/// Apply rewrites to an API request body.
///
/// Returns `true` if any modifications were made.
pub fn apply_rewrites(
    body: &mut serde_json::Value,
    provider: super::handler::ApiProvider,
    config: &RewriteConfig,
) -> bool {
    use super::handler::ApiProvider;

    if !config.is_active() {
        return false;
    }

    if provider == ApiProvider::GoogleCodeAssist && !is_code_assist_conversation_body(body) {
        return false;
    }

    let mut modified = false;

    // Pure mode: strip to essentials first
    if config.pure_mode {
        strip_to_essentials(body, provider);
        modified = true;
    }

    if config.strip_system_prompt {
        modified |= strip_system_prompt(body, provider);
    }

    if config.strip_tools {
        modified |= strip_tools(body, provider);
    }

    // Model override
    if let Some(ref model) = config.model_override {
        match provider {
            ApiProvider::Anthropic | ApiProvider::OpenAI | ApiProvider::ChatGPT => {
                body["model"] = serde_json::Value::String(model.clone());
                modified = true;
            }
            ApiProvider::Google | ApiProvider::GoogleCodeAssist => {
                body["model"] = serde_json::Value::String(model.clone());
                if !google_model_supports_thinking(model) {
                    strip_google_thinking_config(body, provider);
                }
                modified = true;
            }
        }
    }

    // Temperature override
    if let Some(temp) = config.temperature {
        match provider {
            ApiProvider::Anthropic | ApiProvider::OpenAI | ApiProvider::ChatGPT => {
                body["temperature"] = serde_json::json!(temp);
                modified = true;
            }
            ApiProvider::Google => {
                if body.get("generationConfig").is_none() {
                    body["generationConfig"] = serde_json::json!({});
                }
                body["generationConfig"]["temperature"] = serde_json::json!(temp);
                modified = true;
            }
            ApiProvider::GoogleCodeAssist => {
                if let Some(config) = ensure_object_path(body, &["request", "generationConfig"]) {
                    config.insert("temperature".to_string(), serde_json::json!(temp));
                    modified = true;
                }
            }
        }
    }

    // Max tokens override
    if let Some(max) = config.max_tokens {
        match provider {
            ApiProvider::Anthropic => {
                body["max_tokens"] = serde_json::json!(max);
                modified = true;
            }
            ApiProvider::OpenAI | ApiProvider::ChatGPT => {
                body["max_output_tokens"] = serde_json::json!(max);
                modified = true;
            }
            ApiProvider::Google => {
                if body.get("generationConfig").is_none() {
                    body["generationConfig"] = serde_json::json!({});
                }
                body["generationConfig"]["maxOutputTokens"] = serde_json::json!(max);
                modified = true;
            }
            ApiProvider::GoogleCodeAssist => {
                if let Some(config) = ensure_object_path(body, &["request", "generationConfig"]) {
                    config.insert("maxOutputTokens".to_string(), serde_json::json!(max));
                    modified = true;
                }
            }
        }
    }

    // Thinking type override (Anthropic only)
    if let Some(ref thinking) = config.thinking_type
        && provider == ApiProvider::Anthropic
    {
        if thinking == "remove" {
            if let Some(obj) = body.as_object_mut() {
                modified |= obj.remove("thinking").is_some();
            }
        } else {
            if body.get("thinking").is_none() {
                body["thinking"] = serde_json::json!({});
            }
            body["thinking"]["type"] = serde_json::Value::String(thinking.clone());
            modified = true;
        }
    }

    if modified {
        debug!(provider = %provider.label(), "applied request body rewrites");
    }

    modified
}

/// Strip request body to essential fields only (pure mode).
///
/// Keeps only the minimum provider-specific payload required for prompting.
fn strip_to_essentials(body: &mut serde_json::Value, provider: super::handler::ApiProvider) {
    use super::handler::ApiProvider;

    let obj = match body.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    match provider {
        ApiProvider::Anthropic => {
            obj.retain(|key, _| {
                ["model", "messages", "stream", "max_tokens"].contains(&key.as_str())
            });
        }
        ApiProvider::OpenAI => {
            obj.retain(|key, _| {
                ["model", "messages", "input", "stream", "max_output_tokens"]
                    .contains(&key.as_str())
            });
        }
        ApiProvider::ChatGPT => {
            obj.retain(|key, _| ["model", "input"].contains(&key.as_str()));
        }
        ApiProvider::Google => {
            obj.retain(|key, _| {
                ["model", "contents", "stream", "generationConfig"].contains(&key.as_str())
            });
        }
        ApiProvider::GoogleCodeAssist => {
            let model = obj.remove("model");
            let project = obj.remove("project");
            let user_prompt_id = obj.remove("user_prompt_id");
            let request = obj.remove("request");

            obj.clear();

            if let Some(model) = model {
                obj.insert("model".to_string(), model);
            }
            if let Some(project) = project {
                obj.insert("project".to_string(), project);
            }
            if let Some(user_prompt_id) = user_prompt_id {
                obj.insert("user_prompt_id".to_string(), user_prompt_id);
            }
            if let Some(mut request) = request {
                if let Some(request_obj) = request.as_object_mut() {
                    request_obj.retain(|key, _| {
                        ["contents", "generationConfig", "session_id"].contains(&key.as_str())
                    });
                }
                obj.insert("request".to_string(), request);
            }
        }
    }
}

fn strip_system_prompt(
    body: &mut serde_json::Value,
    provider: super::handler::ApiProvider,
) -> bool {
    use super::handler::ApiProvider;

    match provider {
        ApiProvider::Anthropic => body
            .as_object_mut()
            .map(|obj| obj.remove("system").is_some())
            .unwrap_or(false),
        ApiProvider::OpenAI | ApiProvider::ChatGPT => {
            let Some(obj) = body.as_object_mut() else {
                return false;
            };
            let mut modified = obj.remove("system").is_some();

            if let Some(messages) = obj.get_mut("messages").and_then(|v| v.as_array_mut()) {
                let before = messages.len();
                messages.retain(|msg| msg.get("role").and_then(|r| r.as_str()) != Some("system"));
                modified |= messages.len() != before;
            }

            if let Some(input) = obj.get_mut("input").and_then(|v| v.as_array_mut()) {
                let before = input.len();
                input.retain(|msg| msg.get("role").and_then(|r| r.as_str()) != Some("system"));
                modified |= input.len() != before;
            }

            modified
        }
        ApiProvider::Google => {
            let Some(obj) = body.as_object_mut() else {
                return false;
            };
            obj.remove("system_instruction").is_some() | obj.remove("systemInstruction").is_some()
        }
        ApiProvider::GoogleCodeAssist => {
            let mut modified = false;
            if let Some(obj) = body.as_object_mut() {
                modified |= obj.remove("system_instruction").is_some();
                modified |= obj.remove("systemInstruction").is_some();
            }
            if let Some(request) = object_at_path(body, &["request"]) {
                modified |= request.remove("system_instruction").is_some();
                modified |= request.remove("systemInstruction").is_some();
            }

            modified
        }
    }
}

fn strip_tools(body: &mut serde_json::Value, provider: super::handler::ApiProvider) -> bool {
    use super::handler::ApiProvider;

    match provider {
        ApiProvider::Anthropic | ApiProvider::OpenAI | ApiProvider::ChatGPT => {
            let Some(obj) = body.as_object_mut() else {
                return false;
            };
            let mut modified = false;
            for key in ["tools", "tool_choice", "parallel_tool_calls"] {
                modified |= obj.remove(key).is_some();
            }

            modified
        }
        ApiProvider::Google => {
            let Some(obj) = body.as_object_mut() else {
                return false;
            };
            let mut modified = false;
            for key in ["tools", "toolConfig", "tool_config"] {
                modified |= obj.remove(key).is_some();
            }

            modified
        }
        ApiProvider::GoogleCodeAssist => {
            let mut modified = false;
            if let Some(obj) = body.as_object_mut() {
                for key in ["tools", "toolConfig", "tool_config"] {
                    modified |= obj.remove(key).is_some();
                }
            }
            for key in ["tools", "toolConfig", "tool_config"] {
                if let Some(request) = object_at_path(body, &["request"]) {
                    modified |= request.remove(key).is_some();
                }
            }

            modified
        }
    }
}

fn ensure_object_path<'a>(
    value: &'a mut serde_json::Value,
    path: &[&str],
) -> Option<&'a mut Map<String, serde_json::Value>> {
    let mut cursor = value;
    for key in path {
        let obj = cursor.as_object_mut()?;
        cursor = obj
            .entry((*key).to_string())
            .or_insert_with(|| serde_json::Value::Object(Map::new()));
        if !cursor.is_object() {
            *cursor = serde_json::Value::Object(Map::new());
        }
    }

    cursor.as_object_mut()
}

fn object_at_path<'a>(
    value: &'a mut serde_json::Value,
    path: &[&str],
) -> Option<&'a mut Map<String, serde_json::Value>> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get_mut(*key)?;
    }

    cursor.as_object_mut()
}

fn google_model_supports_thinking(model: &str) -> bool {
    model.to_ascii_lowercase().contains("flash")
}

fn strip_google_thinking_config(
    body: &mut serde_json::Value,
    provider: super::handler::ApiProvider,
) -> bool {
    use super::handler::ApiProvider;

    match provider {
        ApiProvider::Google => body
            .get_mut("generationConfig")
            .and_then(|value| value.as_object_mut())
            .map(|config| config.remove("thinkingConfig").is_some())
            .unwrap_or(false),
        ApiProvider::GoogleCodeAssist => object_at_path(body, &["request", "generationConfig"])
            .map(|config| config.remove("thinkingConfig").is_some())
            .unwrap_or(false),
        _ => false,
    }
}

fn is_code_assist_conversation_body(body: &serde_json::Value) -> bool {
    body.get("request")
        .and_then(|request| request.get("contents"))
        .is_some_and(|contents| contents.is_array())
}

/// Per-session rewrite config storage.
pub struct RewriteStore {
    configs: DashMap<String, RewriteConfig>,
}

impl RewriteStore {
    pub fn new() -> Self {
        Self {
            configs: DashMap::new(),
        }
    }

    pub fn get(&self, session_id: &str) -> RewriteConfig {
        self.configs
            .get(session_id)
            .map(|r| r.value().clone())
            .unwrap_or_default()
    }

    pub fn set(&self, session_id: String, config: RewriteConfig) {
        self.configs.insert(session_id, config);
    }
}

impl Default for RewriteStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::super::handler::ApiProvider;
    use super::*;

    #[test]
    fn model_override_anthropic() {
        let mut body = serde_json::json!({
            "model": "claude-opus-4-6",
            "messages": [],
            "max_tokens": 4096
        });
        let config = RewriteConfig {
            model_override: Some("claude-sonnet-4-6".to_string()),
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::Anthropic, &config);
        assert!(modified);
        assert_eq!(body["model"], "claude-sonnet-4-6");
    }

    #[test]
    fn model_override_openai() {
        let mut body = serde_json::json!({
            "model": "gpt-4",
            "messages": []
        });
        let config = RewriteConfig {
            model_override: Some("gpt-4o".to_string()),
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::OpenAI, &config);
        assert!(modified);
        assert_eq!(body["model"], "gpt-4o");
    }

    #[test]
    fn temperature_override_google() {
        let mut body = serde_json::json!({
            "contents": []
        });
        let config = RewriteConfig {
            temperature: Some(0.5),
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::Google, &config);
        assert!(modified);
        assert_eq!(body["generationConfig"]["temperature"], 0.5);
    }

    #[test]
    fn temperature_override_google_codeassist() {
        let mut body = serde_json::json!({
            "model": "gemini-3-flash-preview",
            "project": "proj",
            "user_prompt_id": "prompt-1",
            "request": {
                "contents": [],
                "session_id": "sess-1"
            }
        });
        let config = RewriteConfig {
            temperature: Some(0.25),
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::GoogleCodeAssist, &config);
        assert!(modified);
        assert_eq!(body["request"]["generationConfig"]["temperature"], 0.25);
        assert!(body.get("generationConfig").is_none());
    }

    #[test]
    fn model_override_google_codeassist_strips_incompatible_thinking_config() {
        let mut body = serde_json::json!({
            "model": "gemini-3-flash-preview",
            "project": "proj",
            "user_prompt_id": "prompt-1",
            "request": {
                "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
                "generationConfig": {
                    "thinkingConfig": {
                        "includeThoughts": true,
                        "thinkingLevel": "HIGH"
                    },
                    "temperature": 1
                },
                "session_id": "sess-1"
            }
        });
        let config = RewriteConfig {
            model_override: Some("gemini-2.5-pro".to_string()),
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::GoogleCodeAssist, &config);
        assert!(modified);
        assert_eq!(body["model"], "gemini-2.5-pro");
        assert!(
            body["request"]["generationConfig"]
                .get("thinkingConfig")
                .is_none()
        );
        assert_eq!(body["request"]["generationConfig"]["temperature"], 1);
    }

    #[test]
    fn google_codeassist_non_conversation_requests_are_ignored() {
        let original = serde_json::json!({
            "project": "proj"
        });
        let mut body = original.clone();
        let config = RewriteConfig {
            model_override: Some("gemini-2.5-pro".to_string()),
            pure_mode: true,
            strip_system_prompt: true,
            strip_tools: true,
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::GoogleCodeAssist, &config);
        assert!(!modified);
        assert_eq!(body, original);
    }

    #[test]
    fn pure_mode_strips_anthropic() {
        let mut body = serde_json::json!({
            "model": "claude-opus-4-6",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": true,
            "max_tokens": 4096,
            "system": "be helpful",
            "temperature": 0.7,
            "metadata": {"user_id": "test"}
        });
        let config = RewriteConfig {
            pure_mode: true,
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::Anthropic, &config);
        assert!(modified);
        assert!(body.get("model").is_some());
        assert!(body.get("messages").is_some());
        assert!(body.get("stream").is_some());
        assert!(body.get("max_tokens").is_some());
        assert!(body.get("system").is_none());
        assert!(body.get("temperature").is_none());
        assert!(body.get("metadata").is_none());
    }

    #[test]
    fn pure_mode_strips_openai() {
        let mut body = serde_json::json!({
            "model": "gpt-4",
            "messages": [],
            "stream": true,
            "temperature": 0.7,
            "tools": [],
            "tool_choice": "auto"
        });
        let config = RewriteConfig {
            pure_mode: true,
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::OpenAI, &config);
        assert!(modified);
        assert!(body.get("model").is_some());
        assert!(body.get("messages").is_some());
        assert!(body.get("stream").is_some());
        assert!(body.get("tools").is_none());
        assert!(body.get("tool_choice").is_none());
    }

    #[test]
    fn pure_mode_strips_chatgpt_to_model_and_input() {
        let mut body = serde_json::json!({
            "type": "response.create",
            "model": "gpt-5.4",
            "input": [{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}],
            "stream": true,
            "instructions": "be helpful",
            "tools": [{"type": "function"}]
        });
        let config = RewriteConfig {
            pure_mode: true,
            ..Default::default()
        };

        let modified = apply_rewrites(&mut body, ApiProvider::ChatGPT, &config);

        assert!(modified);
        let obj = body.as_object().unwrap();
        assert_eq!(obj.len(), 2);
        assert!(obj.get("model").is_some());
        assert!(obj.get("input").is_some());
        assert!(obj.get("stream").is_none());
        assert!(obj.get("instructions").is_none());
        assert!(obj.get("tools").is_none());
    }

    #[test]
    fn pure_mode_strips_google_codeassist() {
        let mut body = serde_json::json!({
            "model": "gemini-3-flash-preview",
            "project": "proj",
            "user_prompt_id": "prompt-1",
            "request": {
                "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
                "systemInstruction": {"parts": [{"text": "secret"}]},
                "tools": [{"functionDeclarations": []}],
                "generationConfig": {"temperature": 1},
                "session_id": "sess-1",
                "metadata": {"foo": "bar"}
            },
            "trace_id": "trace-1"
        });
        let config = RewriteConfig {
            pure_mode: true,
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::GoogleCodeAssist, &config);
        assert!(modified);
        assert_eq!(body["model"], "gemini-3-flash-preview");
        assert_eq!(body["project"], "proj");
        assert_eq!(body["user_prompt_id"], "prompt-1");
        assert!(body.get("trace_id").is_none());
        assert!(body["request"]["contents"].is_array());
        assert!(body["request"]["generationConfig"].is_object());
        assert_eq!(body["request"]["session_id"], "sess-1");
        assert!(body["request"].get("systemInstruction").is_none());
        assert!(body["request"].get("tools").is_none());
        assert!(body["request"].get("metadata").is_none());
    }

    #[test]
    fn inactive_config_no_change() {
        let mut body = serde_json::json!({"model": "test"});
        let config = RewriteConfig::default();
        let modified = apply_rewrites(&mut body, ApiProvider::Anthropic, &config);
        assert!(!modified);
    }

    #[test]
    fn config_serde_roundtrip() {
        let config = RewriteConfig {
            model_override: Some("claude-sonnet-4-6".to_string()),
            temperature: Some(0.5),
            max_tokens: Some(8192),
            thinking_type: Some("enabled".to_string()),
            pure_mode: true,
            strip_system_prompt: true,
            strip_tools: true,
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: RewriteConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.model_override, config.model_override);
        assert!(parsed.pure_mode);
        assert!(parsed.strip_system_prompt);
        assert!(parsed.strip_tools);
    }

    #[test]
    fn strip_system_prompt_anthropic() {
        let mut body = serde_json::json!({
            "model": "claude-sonnet-4-6",
            "system": "secret system",
            "messages": [{"role": "user", "content": "hi"}]
        });
        let config = RewriteConfig {
            strip_system_prompt: true,
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::Anthropic, &config);
        assert!(modified);
        assert!(body.get("system").is_none());
    }

    #[test]
    fn strip_tools_openai() {
        let mut body = serde_json::json!({
            "model": "gpt-4o",
            "messages": [],
            "tools": [{"type": "function"}],
            "tool_choice": "auto",
            "parallel_tool_calls": true
        });
        let config = RewriteConfig {
            strip_tools: true,
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::OpenAI, &config);
        assert!(modified);
        assert!(body.get("tools").is_none());
        assert!(body.get("tool_choice").is_none());
        assert!(body.get("parallel_tool_calls").is_none());
    }

    #[test]
    fn thinking_remove_deletes_block() {
        let mut body = serde_json::json!({
            "model": "claude-sonnet-4-6",
            "messages": [],
            "thinking": {"type": "enabled"}
        });
        let config = RewriteConfig {
            thinking_type: Some("remove".to_string()),
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::Anthropic, &config);
        assert!(modified);
        assert!(body.get("thinking").is_none());
    }

    #[test]
    fn strip_system_prompt_google_codeassist() {
        let mut body = serde_json::json!({
            "model": "gemini-3-flash-preview",
            "request": {
                "contents": [],
                "systemInstruction": {"parts": [{"text": "secret"}]}
            }
        });
        let config = RewriteConfig {
            strip_system_prompt: true,
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::GoogleCodeAssist, &config);
        assert!(modified);
        assert!(body["request"].get("systemInstruction").is_none());
    }

    #[test]
    fn strip_tools_google_codeassist() {
        let mut body = serde_json::json!({
            "model": "gemini-3-flash-preview",
            "request": {
                "contents": [],
                "tools": [{"functionDeclarations": []}],
                "toolConfig": {"mode": "auto"}
            }
        });
        let config = RewriteConfig {
            strip_tools: true,
            ..Default::default()
        };
        let modified = apply_rewrites(&mut body, ApiProvider::GoogleCodeAssist, &config);
        assert!(modified);
        assert!(body["request"].get("tools").is_none());
        assert!(body["request"].get("toolConfig").is_none());
    }
}
