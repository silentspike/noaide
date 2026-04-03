//! Request body rewriting — model override, parameter tweaks, and pure mode.
//!
//! Apply per-session rewrites to API request bodies before forwarding to upstream.
//! Supports model override, temperature, max tokens, thinking type, and pure mode
//! (strip everything except model + messages + stream).

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tracing::debug;

/// Per-session rewrite configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RewriteConfig {
    /// Override the model name in the request
    pub model_override: Option<String>,
    /// Override temperature
    pub temperature: Option<f64>,
    /// Override max tokens
    pub max_tokens: Option<u64>,
    /// Override thinking type (for Anthropic extended thinking)
    pub thinking_type: Option<String>,
    /// Pure mode: strip everything except model + messages + stream
    pub pure_mode: bool,
}

impl RewriteConfig {
    pub fn is_active(&self) -> bool {
        self.model_override.is_some()
            || self.temperature.is_some()
            || self.max_tokens.is_some()
            || self.thinking_type.is_some()
            || self.pure_mode
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

    let mut modified = false;

    // Pure mode: strip to essentials first
    if config.pure_mode {
        strip_to_essentials(body, provider);
        modified = true;
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
            ApiProvider::Google | ApiProvider::GoogleCodeAssist => {
                if body.get("generationConfig").is_none() {
                    body["generationConfig"] = serde_json::json!({});
                }
                body["generationConfig"]["temperature"] = serde_json::json!(temp);
                modified = true;
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
            ApiProvider::Google | ApiProvider::GoogleCodeAssist => {
                if body.get("generationConfig").is_none() {
                    body["generationConfig"] = serde_json::json!({});
                }
                body["generationConfig"]["maxOutputTokens"] = serde_json::json!(max);
                modified = true;
            }
        }
    }

    // Thinking type override (Anthropic only)
    if let Some(ref thinking) = config.thinking_type {
        if provider == ApiProvider::Anthropic {
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
/// Keeps only: model, messages/contents/input, stream
fn strip_to_essentials(body: &mut serde_json::Value, provider: super::handler::ApiProvider) {
    use super::handler::ApiProvider;

    let obj = match body.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    let essential_keys: &[&str] = match provider {
        ApiProvider::Anthropic => &["model", "messages", "stream", "max_tokens"],
        ApiProvider::OpenAI | ApiProvider::ChatGPT => {
            &["model", "messages", "input", "stream", "max_output_tokens"]
        }
        ApiProvider::Google | ApiProvider::GoogleCodeAssist => {
            &["model", "contents", "stream", "generationConfig"]
        }
    };

    obj.retain(|key, _| essential_keys.contains(&key.as_str()));
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
    use super::*;
    use super::super::handler::ApiProvider;

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
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: RewriteConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.model_override, config.model_override);
        assert_eq!(parsed.pure_mode, true);
    }
}
