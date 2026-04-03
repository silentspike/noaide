//! Proxy mode presets — 5 modes that configure per-session proxy behavior.
//!
//! Each mode applies a set of default rules and behaviors:
//! - Auto: Default allow, no special rules
//! - Manual: Intercept all requests for manual review
//! - Custom: User-defined rules, no auto-changes
//! - Pure: Block telemetry + strip non-essential fields
//! - Lockdown: Block everything except Api category

use dashmap::DashMap;
use serde::{Deserialize, Serialize};

/// Proxy operation mode for a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum ProxyMode {
    /// Default: allow all traffic, no interception
    #[default]
    Auto,
    /// Intercept all requests for manual review
    Manual,
    /// User-defined rules only, no automatic changes
    Custom,
    /// Block telemetry, strip non-essential request fields
    Pure,
    /// Block everything except Api-category traffic
    Lockdown,
}

/// Per-session proxy mode storage.
pub struct ProxyModeStore {
    modes: DashMap<String, ProxyMode>,
}

impl ProxyModeStore {
    pub fn new() -> Self {
        Self {
            modes: DashMap::new(),
        }
    }

    pub fn get(&self, session_id: &str) -> ProxyMode {
        self.modes
            .get(session_id)
            .map(|r| *r.value())
            .unwrap_or_default()
    }

    pub fn set(&self, session_id: String, mode: ProxyMode) {
        self.modes.insert(session_id, mode);
    }

    /// Check if a request should be blocked based on the current mode and category.
    pub fn should_block(&self, session_id: &str, category: &str) -> bool {
        let mode = self.get(session_id);
        match mode {
            ProxyMode::Lockdown => category != "Api",
            ProxyMode::Pure => category == "Telemetry",
            _ => false,
        }
    }

    /// Check if session is in Manual intercept mode.
    pub fn is_manual(&self, session_id: &str) -> bool {
        self.get(session_id) == ProxyMode::Manual
    }
}

impl Default for ProxyModeStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_mode_is_auto() {
        let store = ProxyModeStore::new();
        assert_eq!(store.get("unknown-session"), ProxyMode::Auto);
    }

    #[test]
    fn set_and_get_mode() {
        let store = ProxyModeStore::new();
        store.set("session-1".to_string(), ProxyMode::Lockdown);
        assert_eq!(store.get("session-1"), ProxyMode::Lockdown);
    }

    #[test]
    fn lockdown_blocks_non_api() {
        let store = ProxyModeStore::new();
        store.set("s1".to_string(), ProxyMode::Lockdown);
        assert!(store.should_block("s1", "Telemetry"));
        assert!(store.should_block("s1", "Update"));
        assert!(store.should_block("s1", "Auth"));
        assert!(!store.should_block("s1", "Api"));
    }

    #[test]
    fn pure_blocks_telemetry_only() {
        let store = ProxyModeStore::new();
        store.set("s1".to_string(), ProxyMode::Pure);
        assert!(store.should_block("s1", "Telemetry"));
        assert!(!store.should_block("s1", "Api"));
        assert!(!store.should_block("s1", "Auth"));
        assert!(!store.should_block("s1", "Update"));
    }

    #[test]
    fn auto_blocks_nothing() {
        let store = ProxyModeStore::new();
        store.set("s1".to_string(), ProxyMode::Auto);
        assert!(!store.should_block("s1", "Telemetry"));
        assert!(!store.should_block("s1", "Api"));
    }

    #[test]
    fn manual_mode_detected() {
        let store = ProxyModeStore::new();
        store.set("s1".to_string(), ProxyMode::Manual);
        assert!(store.is_manual("s1"));
        assert!(!store.is_manual("s2"));
    }

    #[test]
    fn mode_serde_roundtrip() {
        let json = serde_json::to_string(&ProxyMode::Lockdown).unwrap();
        assert_eq!(json, "\"lockdown\"");
        let parsed: ProxyMode = serde_json::from_str("\"pure\"").unwrap();
        assert_eq!(parsed, ProxyMode::Pure);
    }
}
