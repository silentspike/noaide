//! API key rotation — round-robin/least-used key selection with rate-limit tracking.
//!
//! Keys are encrypted at rest using AES-256-GCM with a key derived from /etc/machine-id.
//! Rate limits are tracked from response headers and auto-switch happens on 429.

use dashmap::DashMap;
use ring::aead;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::warn;

/// An API key entry in the key store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyEntry {
    pub id: String,
    pub provider: String,
    /// Base64-encoded encrypted key (AES-256-GCM)
    pub key_encrypted: String,
    pub label: String,
    /// Percentage utilization of 5-hour rate limit (0-100)
    pub rate_limit_5h: f64,
    /// Percentage utilization of 7-day rate limit (0-100)
    pub rate_limit_7d: f64,
    pub last_used: Option<i64>,
    pub active: bool,
    /// Number of requests made with this key
    pub request_count: u64,
}

/// Derive an AES-256 key from /etc/machine-id using HKDF.
fn derive_key() -> aead::LessSafeKey {
    let machine_id = std::fs::read_to_string("/etc/machine-id")
        .unwrap_or_else(|_| "noaide-default-machine-id-fallback".to_string());
    let salt = ring::hkdf::Salt::new(ring::hkdf::HKDF_SHA256, b"noaide-key-encryption");
    let prk = salt.extract(machine_id.trim().as_bytes());
    let okm = prk
        .expand(&[b"noaide-api-keys-v1"], &aead::AES_256_GCM)
        .expect("HKDF expand failed");
    let mut key_bytes = [0u8; 32];
    okm.fill(&mut key_bytes).expect("HKDF fill failed");
    let unbound_key =
        aead::UnboundKey::new(&aead::AES_256_GCM, &key_bytes).expect("AES key creation failed");
    aead::LessSafeKey::new(unbound_key)
}

/// Encrypt an API key string.
pub fn encrypt_key(plaintext: &str) -> String {
    let key = derive_key();
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes).expect("RNG failed");
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = plaintext.as_bytes().to_vec();
    key.seal_in_place_append_tag(nonce, aead::Aad::empty(), &mut in_out)
        .expect("encryption failed");

    // Prepend nonce to ciphertext
    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&in_out);
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result)
}

/// Decrypt an API key string.
pub fn decrypt_key(encrypted: &str) -> Result<String, String> {
    let key = derive_key();
    let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encrypted)
        .map_err(|e| format!("base64 decode error: {e}"))?;

    if data.len() < 12 {
        return Err("ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = aead::Nonce::assume_unique_for_key(
        nonce_bytes
            .try_into()
            .map_err(|_| "invalid nonce".to_string())?,
    );

    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(nonce, aead::Aad::empty(), &mut in_out)
        .map_err(|_| "decryption failed".to_string())?;

    String::from_utf8(plaintext.to_vec()).map_err(|e| format!("UTF-8 error: {e}"))
}

/// Key store with round-robin selection and rate-limit tracking.
pub struct KeyStore {
    keys: DashMap<String, ApiKeyEntry>,
    /// Round-robin counter
    counter: AtomicU64,
}

impl KeyStore {
    pub fn new() -> Self {
        Self {
            keys: DashMap::new(),
            counter: AtomicU64::new(0),
        }
    }

    /// Add a key (encrypts the plaintext key).
    pub fn add_key(&self, provider: &str, plaintext_key: &str, label: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let encrypted = encrypt_key(plaintext_key);
        let entry = ApiKeyEntry {
            id: id.clone(),
            provider: provider.to_string(),
            key_encrypted: encrypted,
            label: label.to_string(),
            rate_limit_5h: 0.0,
            rate_limit_7d: 0.0,
            last_used: None,
            active: true,
            request_count: 0,
        };
        self.keys.insert(id.clone(), entry);
        id
    }

    /// Remove a key by ID.
    pub fn remove_key(&self, id: &str) -> bool {
        self.keys.remove(id).is_some()
    }

    /// Get all keys (without decrypted values).
    pub fn list_keys(&self) -> Vec<ApiKeyEntry> {
        self.keys.iter().map(|r| r.value().clone()).collect()
    }

    /// Select the next active key for a provider using round-robin.
    /// Returns (key_id, decrypted_key) or None if no active keys.
    pub fn select_key(&self, provider: &str) -> Option<(String, String)> {
        let active: Vec<_> = self
            .keys
            .iter()
            .filter(|r| r.value().provider == provider && r.value().active)
            .map(|r| (r.key().clone(), r.value().key_encrypted.clone()))
            .collect();

        if active.is_empty() {
            return None;
        }

        let idx = self.counter.fetch_add(1, Ordering::Relaxed) as usize % active.len();
        let (id, encrypted) = &active[idx];

        match decrypt_key(encrypted) {
            Ok(plaintext) => {
                // Update usage stats
                if let Some(mut entry) = self.keys.get_mut(id) {
                    entry.last_used = Some(
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as i64,
                    );
                    entry.request_count += 1;
                }
                Some((id.clone(), plaintext))
            }
            Err(e) => {
                warn!(key_id = %id, error = %e, "failed to decrypt API key");
                None
            }
        }
    }

    /// Update rate-limit info from response headers.
    pub fn update_rate_limits(&self, key_id: &str, headers: &[(String, String)]) {
        if let Some(mut entry) = self.keys.get_mut(key_id) {
            for (name, value) in headers {
                let name_lower = name.to_lowercase();
                if name_lower.contains("ratelimit") && name_lower.contains("5h") {
                    if let Ok(v) = value.parse::<f64>() {
                        entry.rate_limit_5h = v;
                    }
                }
                if name_lower.contains("ratelimit") && name_lower.contains("7d") {
                    if let Ok(v) = value.parse::<f64>() {
                        entry.rate_limit_7d = v;
                    }
                }
            }
        }
    }

    /// Mark a key as inactive (e.g., after repeated 429s).
    pub fn deactivate_key(&self, key_id: &str) {
        if let Some(mut entry) = self.keys.get_mut(key_id) {
            entry.active = false;
            warn!(key_id = %key_id, label = %entry.label, "deactivated API key due to rate limiting");
        }
    }

    /// Check if the store has any active keys for a provider.
    pub fn has_active_keys(&self, provider: &str) -> bool {
        self.keys
            .iter()
            .any(|r| r.value().provider == provider && r.value().active)
    }

    /// Get status summary for all keys.
    pub fn status(&self) -> Vec<serde_json::Value> {
        self.keys
            .iter()
            .map(|r| {
                let v = r.value();
                serde_json::json!({
                    "id": v.id,
                    "provider": v.provider,
                    "label": v.label,
                    "active": v.active,
                    "rate_limit_5h": v.rate_limit_5h,
                    "rate_limit_7d": v.rate_limit_7d,
                    "last_used": v.last_used,
                    "request_count": v.request_count,
                })
            })
            .collect()
    }
}

impl Default for KeyStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = "sk-ant-api03-test-key-1234567890";
        let encrypted = encrypt_key(key);
        assert_ne!(encrypted, key);
        let decrypted = decrypt_key(&encrypted).unwrap();
        assert_eq!(decrypted, key);
    }

    #[test]
    fn add_and_select_key() {
        let store = KeyStore::new();
        let id = store.add_key("anthropic", "sk-test-key", "Test Key");
        assert!(!id.is_empty());

        let result = store.select_key("anthropic");
        assert!(result.is_some());
        let (selected_id, plaintext) = result.unwrap();
        assert_eq!(selected_id, id);
        assert_eq!(plaintext, "sk-test-key");
    }

    #[test]
    fn round_robin_distribution() {
        let store = KeyStore::new();
        store.add_key("anthropic", "key-1", "Key 1");
        store.add_key("anthropic", "key-2", "Key 2");

        let mut keys_used = std::collections::HashSet::new();
        for _ in 0..10 {
            if let Some((_, key)) = store.select_key("anthropic") {
                keys_used.insert(key);
            }
        }
        // Both keys should have been used
        assert_eq!(keys_used.len(), 2);
    }

    #[test]
    fn deactivate_key_excluded() {
        let store = KeyStore::new();
        let id1 = store.add_key("anthropic", "key-1", "Key 1");
        store.add_key("anthropic", "key-2", "Key 2");

        store.deactivate_key(&id1);

        // Only key-2 should be selectable
        for _ in 0..5 {
            let (_, key) = store.select_key("anthropic").unwrap();
            assert_eq!(key, "key-2");
        }
    }

    #[test]
    fn no_keys_returns_none() {
        let store = KeyStore::new();
        assert!(store.select_key("anthropic").is_none());
    }

    #[test]
    fn remove_key() {
        let store = KeyStore::new();
        let id = store.add_key("anthropic", "key-1", "Key 1");
        assert!(store.remove_key(&id));
        assert!(store.select_key("anthropic").is_none());
    }

    #[test]
    fn provider_isolation() {
        let store = KeyStore::new();
        store.add_key("anthropic", "key-ant", "Ant Key");
        store.add_key("openai", "key-oai", "OAI Key");

        let (_, key) = store.select_key("anthropic").unwrap();
        assert_eq!(key, "key-ant");

        let (_, key) = store.select_key("openai").unwrap();
        assert_eq!(key, "key-oai");
    }
}
