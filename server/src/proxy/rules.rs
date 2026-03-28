//! Per-session network rules engine for the CONNECT MITM proxy.
//!
//! Allows blocking, allowing, or delaying network connections on a
//! per-session + per-domain basis. Rules are stored in a DashMap
//! keyed by session ID for zero-contention concurrent access.

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::classify::TrafficCategory;

/// Action to take when a rule matches.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase", tag = "type")]
pub enum RuleAction {
    Allow,
    Block,
    Delay { ms: u64 },
}

/// A single network rule for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkRule {
    pub id: String,
    pub session_id: String,
    /// Domain pattern: exact ("play.googleapis.com") or suffix glob ("*.datadoghq.com").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain_pattern: Option<String>,
    /// Match by traffic category (applies to all domains of that category).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_filter: Option<TrafficCategory>,
    pub action: RuleAction,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Lower number = higher priority. Default = 100.
    #[serde(default = "default_priority")]
    pub priority: u32,
}

fn default_true() -> bool {
    true
}
fn default_priority() -> u32 {
    100
}

/// Per-session network rules engine.
///
/// Thread-safe via DashMap. No rules = Allow (default open).
pub struct NetworkRulesEngine {
    rules: DashMap<String, Vec<NetworkRule>>,
}

impl NetworkRulesEngine {
    pub fn new() -> Self {
        Self {
            rules: DashMap::new(),
        }
    }

    /// Evaluate rules for a connection. Returns the action to take.
    ///
    /// Rules are sorted by priority (lowest first). First matching rule wins.
    /// No rules = Allow.
    pub fn evaluate(
        &self,
        session_id: Option<&str>,
        host: &str,
        _path: &str,
        category: TrafficCategory,
    ) -> RuleAction {
        let sid = match session_id {
            Some(s) => s,
            None => return RuleAction::Allow,
        };

        let entry = match self.rules.get(sid) {
            Some(e) => e,
            None => return RuleAction::Allow,
        };

        let mut sorted: Vec<&NetworkRule> = entry.iter().filter(|r| r.enabled).collect();
        sorted.sort_by_key(|r| r.priority);

        for rule in sorted {
            if rule_matches(rule, host, category) {
                return rule.action.clone();
            }
        }

        RuleAction::Allow
    }

    /// Get all rules for a session.
    pub fn get_rules(&self, session_id: &str) -> Vec<NetworkRule> {
        self.rules
            .get(session_id)
            .map(|r| r.clone())
            .unwrap_or_default()
    }

    /// Replace all rules for a session.
    pub fn set_rules(&self, session_id: &str, rules: Vec<NetworkRule>) {
        self.rules.insert(session_id.to_string(), rules);
    }

    /// Add a single rule to a session. Returns the rule ID.
    pub fn add_rule(&self, session_id: &str, mut rule: NetworkRule) -> String {
        if rule.id.is_empty() {
            rule.id = Uuid::new_v4().to_string();
        }
        rule.session_id = session_id.to_string();
        let id = rule.id.clone();
        self.rules
            .entry(session_id.to_string())
            .or_default()
            .push(rule);
        id
    }

    /// Remove a rule by ID. Returns true if found and removed.
    pub fn remove_rule(&self, session_id: &str, rule_id: &str) -> bool {
        if let Some(mut rules) = self.rules.get_mut(session_id) {
            let before = rules.len();
            rules.retain(|r| r.id != rule_id);
            rules.len() < before
        } else {
            false
        }
    }
}

/// Check if a rule matches a given host + category.
fn rule_matches(rule: &NetworkRule, host: &str, category: TrafficCategory) -> bool {
    let domain_match = match &rule.domain_pattern {
        None => true, // no domain filter = match all
        Some(pattern) => {
            if let Some(suffix) = pattern.strip_prefix("*.") {
                // Glob: *.datadoghq.com matches http-intake.logs.us5.datadoghq.com
                host == suffix || host.ends_with(&format!(".{suffix}"))
            } else {
                // Exact match
                host == pattern
            }
        }
    };

    let category_match = match &rule.category_filter {
        None => true, // no category filter = match all
        Some(cat) => *cat == category,
    };

    domain_match && category_match
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_engine() -> NetworkRulesEngine {
        NetworkRulesEngine::new()
    }

    #[test]
    fn test_no_rules_allows() {
        let engine = make_engine();
        let action = engine.evaluate(
            Some("sess-1"),
            "datadoghq.com",
            "/",
            TrafficCategory::Telemetry,
        );
        assert_eq!(action, RuleAction::Allow);
    }

    #[test]
    fn test_no_session_allows() {
        let engine = make_engine();
        let action = engine.evaluate(None, "datadoghq.com", "/", TrafficCategory::Telemetry);
        assert_eq!(action, RuleAction::Allow);
    }

    #[test]
    fn test_exact_domain_block() {
        let engine = make_engine();
        engine.add_rule(
            "sess-1",
            NetworkRule {
                id: String::new(),
                session_id: String::new(),
                domain_pattern: Some("play.googleapis.com".into()),
                category_filter: None,
                action: RuleAction::Block,
                enabled: true,
                priority: 100,
            },
        );

        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "play.googleapis.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Block
        );
        // Different domain: not blocked
        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "api.anthropic.com",
                "/",
                TrafficCategory::Api
            ),
            RuleAction::Allow
        );
    }

    #[test]
    fn test_wildcard_domain_block() {
        let engine = make_engine();
        engine.add_rule(
            "sess-1",
            NetworkRule {
                id: String::new(),
                session_id: String::new(),
                domain_pattern: Some("*.datadoghq.com".into()),
                category_filter: None,
                action: RuleAction::Block,
                enabled: true,
                priority: 100,
            },
        );

        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "http-intake.logs.us5.datadoghq.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Block
        );
        // datadoghq.com itself matches
        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "datadoghq.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Block
        );
    }

    #[test]
    fn test_category_block() {
        let engine = make_engine();
        engine.add_rule(
            "sess-1",
            NetworkRule {
                id: String::new(),
                session_id: String::new(),
                domain_pattern: None,
                category_filter: Some(TrafficCategory::Telemetry),
                action: RuleAction::Block,
                enabled: true,
                priority: 100,
            },
        );

        // Any telemetry domain blocked
        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "datadoghq.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Block
        );
        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "play.googleapis.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Block
        );
        // API not blocked
        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "api.anthropic.com",
                "/",
                TrafficCategory::Api
            ),
            RuleAction::Allow
        );
    }

    #[test]
    fn test_priority_ordering() {
        let engine = make_engine();
        // Low priority (100): block all telemetry
        engine.add_rule(
            "sess-1",
            NetworkRule {
                id: "block-all".into(),
                session_id: String::new(),
                domain_pattern: None,
                category_filter: Some(TrafficCategory::Telemetry),
                action: RuleAction::Block,
                enabled: true,
                priority: 100,
            },
        );
        // High priority (10): allow play.googleapis.com specifically
        engine.add_rule(
            "sess-1",
            NetworkRule {
                id: "allow-play".into(),
                session_id: String::new(),
                domain_pattern: Some("play.googleapis.com".into()),
                category_filter: None,
                action: RuleAction::Allow,
                enabled: true,
                priority: 10,
            },
        );

        // play.googleapis.com: higher-prio Allow wins over lower-prio Block
        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "play.googleapis.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Allow
        );
        // Other telemetry: still blocked
        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "datadoghq.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Block
        );
    }

    #[test]
    fn test_session_isolation() {
        let engine = make_engine();
        engine.add_rule(
            "sess-A",
            NetworkRule {
                id: String::new(),
                session_id: String::new(),
                domain_pattern: Some("datadoghq.com".into()),
                category_filter: None,
                action: RuleAction::Block,
                enabled: true,
                priority: 100,
            },
        );

        // Session A: blocked
        assert_eq!(
            engine.evaluate(
                Some("sess-A"),
                "datadoghq.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Block
        );
        // Session B: not blocked (no rules)
        assert_eq!(
            engine.evaluate(
                Some("sess-B"),
                "datadoghq.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Allow
        );
    }

    #[test]
    fn test_disabled_rule_ignored() {
        let engine = make_engine();
        engine.add_rule(
            "sess-1",
            NetworkRule {
                id: String::new(),
                session_id: String::new(),
                domain_pattern: Some("datadoghq.com".into()),
                category_filter: None,
                action: RuleAction::Block,
                enabled: false, // disabled!
                priority: 100,
            },
        );

        assert_eq!(
            engine.evaluate(
                Some("sess-1"),
                "datadoghq.com",
                "/",
                TrafficCategory::Telemetry
            ),
            RuleAction::Allow // disabled rule doesn't match
        );
    }

    #[test]
    fn test_crud_operations() {
        let engine = make_engine();

        // Add
        let id = engine.add_rule(
            "sess-1",
            NetworkRule {
                id: String::new(),
                session_id: String::new(),
                domain_pattern: Some("test.com".into()),
                category_filter: None,
                action: RuleAction::Block,
                enabled: true,
                priority: 100,
            },
        );
        assert!(!id.is_empty());

        // Get
        let rules = engine.get_rules("sess-1");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].domain_pattern.as_deref(), Some("test.com"));

        // Remove
        assert!(engine.remove_rule("sess-1", &id));
        assert!(engine.get_rules("sess-1").is_empty());

        // Remove non-existent
        assert!(!engine.remove_rule("sess-1", "fake-id"));

        // Set (replace all)
        engine.set_rules(
            "sess-1",
            vec![
                NetworkRule {
                    id: "r1".into(),
                    session_id: "sess-1".into(),
                    domain_pattern: Some("a.com".into()),
                    category_filter: None,
                    action: RuleAction::Allow,
                    enabled: true,
                    priority: 10,
                },
                NetworkRule {
                    id: "r2".into(),
                    session_id: "sess-1".into(),
                    domain_pattern: Some("b.com".into()),
                    category_filter: None,
                    action: RuleAction::Block,
                    enabled: true,
                    priority: 20,
                },
            ],
        );
        assert_eq!(engine.get_rules("sess-1").len(), 2);
    }
}
