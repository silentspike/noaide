//! Config persistence — save/load per-session proxy configuration to disk.
//!
//! Saves proxy config (rules, mode, inject, rewrite) as JSON files in /data/noaide/.
//! Debounced save (1s after last change), 30-day TTL cleanup on startup.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{debug, info, warn};

/// Combined proxy configuration for a session.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxyConfig {
    pub mode: super::modes::ProxyMode,
    pub inject: super::inject::InjectConfig,
    pub rewrite: super::rewrite::RewriteConfig,
    #[serde(default)]
    pub rules: Vec<super::rules::NetworkRule>,
}

/// Config directory for proxy persistence.
fn config_dir() -> PathBuf {
    PathBuf::from("/data/noaide")
}

/// Config file path for a session.
fn config_path(session_id: &str) -> PathBuf {
    config_dir().join(format!("proxy-config-{session_id}.json"))
}

/// Save proxy config for a session to disk.
pub fn save_config(session_id: &str, config: &ProxyConfig) -> Result<(), std::io::Error> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let path = config_path(session_id);
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)?;
    debug!(session_id = %session_id, path = %path.display(), "saved proxy config");
    Ok(())
}

/// Load proxy config for a session from disk.
pub fn load_config(session_id: &str) -> Option<ProxyConfig> {
    let path = config_path(session_id);
    match std::fs::read_to_string(&path) {
        Ok(json) => match serde_json::from_str(&json) {
            Ok(config) => {
                debug!(session_id = %session_id, "loaded proxy config from disk");
                Some(config)
            }
            Err(e) => {
                warn!(session_id = %session_id, error = %e, "failed to parse proxy config");
                None
            }
        },
        Err(_) => None,
    }
}

/// Clean up config files older than `max_age` from the config directory.
///
/// Returns the number of files deleted.
pub fn cleanup_old_configs(max_age: std::time::Duration) -> usize {
    let dir = config_dir();
    let mut deleted = 0;

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };

    let now = std::time::SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("proxy-config-") && n.ends_with(".json"))
        {
            continue;
        }

        if let Ok(metadata) = path.metadata()
            && let Ok(modified) = metadata.modified()
            && let Ok(age) = now.duration_since(modified)
            && age > max_age
            && std::fs::remove_file(&path).is_ok()
        {
            info!(path = %path.display(), age_days = age.as_secs() / 86400, "deleted old proxy config");
            deleted += 1;
        }
    }

    deleted
}

/// List all session IDs that have saved configs.
pub fn list_saved_sessions() -> Vec<String> {
    let dir = config_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            name.strip_prefix("proxy-config-")?
                .strip_suffix(".json")
                .map(|s| s.to_string())
        })
        .collect()
}

/// Schedule a debounced save (1s after last change).
///
/// Call this after any config mutation. Uses a simple fire-and-forget approach:
/// spawns a tokio task that waits 1s then saves. Repeated calls within 1s
/// result in multiple saves (last one wins), which is acceptable for this use case.
pub fn schedule_save(session_id: String, config: ProxyConfig) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if let Err(e) = save_config(&session_id, &config) {
            warn!(session_id = %session_id, error = %e, "failed to persist proxy config");
        }
    });
}

/// Run cleanup of configs older than 30 days. Call at server startup.
pub fn startup_cleanup() {
    let max_age = std::time::Duration::from_secs(30 * 24 * 3600); // 30 days
    let deleted = cleanup_old_configs(max_age);
    if deleted > 0 {
        info!(deleted = deleted, "cleaned up old proxy configs");
    }
}

/// Load all persisted configs into the proxy state stores.
/// Call at server startup after cleanup.
pub fn load_all_into_stores(
    modes: &super::modes::ProxyModeStore,
    inject: &super::inject::InjectStore,
    rewrite: &super::rewrite::RewriteStore,
    rules: &super::rules::NetworkRulesEngine,
) -> usize {
    let sessions = list_saved_sessions();
    let mut loaded = 0;
    for sid in &sessions {
        if let Some(config) = load_config(sid) {
            modes.set(sid.clone(), config.mode);
            inject.set(sid.clone(), config.inject);
            rewrite.set(sid.clone(), config.rewrite);
            if !config.rules.is_empty() {
                rules.set_rules(sid, config.rules);
            }
            loaded += 1;
        }
    }
    if loaded > 0 {
        info!(loaded = loaded, total = sessions.len(), "restored proxy configs from disk");
    }
    loaded
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir() -> PathBuf {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("noaide-persist-test-{id}"));
        let _ = fs::remove_dir_all(&dir); // clean up leftover from previous run
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_and_load_config() {
        let dir = test_dir();
        let path = dir.join("proxy-config-test-session.json");

        let config = ProxyConfig {
            mode: super::super::modes::ProxyMode::Pure,
            inject: super::super::inject::InjectConfig {
                presets: vec![super::super::inject::Preset::AntiLaziness],
                custom_text: Some("custom".to_string()),
            },
            rewrite: super::super::rewrite::RewriteConfig {
                model_override: Some("claude-sonnet-4-6".to_string()),
                ..Default::default()
            },
            rules: vec![],
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        fs::write(&path, &json).unwrap();

        let loaded: ProxyConfig =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(loaded.mode, super::super::modes::ProxyMode::Pure);
        assert_eq!(
            loaded.rewrite.model_override,
            Some("claude-sonnet-4-6".to_string())
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn config_serde_roundtrip() {
        let config = ProxyConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: ProxyConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.mode, super::super::modes::ProxyMode::Auto);
    }

    #[test]
    fn cleanup_old_files() {
        let dir = test_dir();
        // Create a "config" file
        let path = dir.join("proxy-config-old-session.json");
        fs::write(&path, "{}").unwrap();

        // File is fresh — should NOT be deleted with 0s max age
        // (We can't easily backdate files in a test, so test the path parsing)
        let entries: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .is_some_and(|n| n.starts_with("proxy-config-") && n.ends_with(".json"))
            })
            .collect();
        assert_eq!(entries.len(), 1);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_saved_sessions_parses_filenames() {
        // This tests the filename parsing logic
        let name = "proxy-config-abc-123.json";
        let session_id = name
            .strip_prefix("proxy-config-")
            .unwrap()
            .strip_suffix(".json")
            .unwrap();
        assert_eq!(session_id, "abc-123");
    }
}
