//! Traffic classification for CONNECT MITM proxy.
//!
//! Classifies network traffic by domain into categories
//! (Api, Telemetry, Auth, Update, Git, Unknown) for the
//! network rules engine and Network Tab display.

use serde::{Deserialize, Serialize};

/// Traffic category for CONNECT-tunneled connections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrafficCategory {
    Api,
    Telemetry,
    Auth,
    Update,
    Git,
    Unknown,
}

impl std::fmt::Display for TrafficCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Api => write!(f, "api"),
            Self::Telemetry => write!(f, "telemetry"),
            Self::Auth => write!(f, "auth"),
            Self::Update => write!(f, "update"),
            Self::Git => write!(f, "git"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

/// Classification rules: (domain pattern, category).
/// More specific patterns MUST come before less specific ones.
/// Matching is done via `host == pattern` or `host.ends_with(pattern_with_dot)`.
static RULES: &[(&str, TrafficCategory)] = &[
    // Telemetry (MUST be before Api — ab.chatgpt.com is telemetry, not api)
    ("ab.chatgpt.com", TrafficCategory::Telemetry),
    ("datadoghq.com", TrafficCategory::Telemetry),
    ("play.googleapis.com", TrafficCategory::Telemetry),
    ("segment.io", TrafficCategory::Telemetry),
    ("sentry.io", TrafficCategory::Telemetry),
    ("statsigapi.net", TrafficCategory::Telemetry),
    ("amplitude.com", TrafficCategory::Telemetry),
    // Auth
    ("oauth2.googleapis.com", TrafficCategory::Auth),
    ("accounts.google.com", TrafficCategory::Auth),
    // Update
    ("downloads.claude.ai", TrafficCategory::Update),
    ("update.electronjs.org", TrafficCategory::Update),
    // Git
    ("raw.githubusercontent.com", TrafficCategory::Git),
    ("github.com", TrafficCategory::Git),
    ("gitlab.com", TrafficCategory::Git),
    ("bitbucket.org", TrafficCategory::Git),
    // Api (least specific — chatgpt.com AFTER ab.chatgpt.com)
    ("api.anthropic.com", TrafficCategory::Api),
    ("mcp-proxy.anthropic.com", TrafficCategory::Api),
    ("cloudcode-pa.googleapis.com", TrafficCategory::Api),
    ("chatgpt.com", TrafficCategory::Api),
];

/// Classify a domain (host without port) into a traffic category.
///
/// Matching rules:
/// - Exact match: `host == pattern`
/// - Suffix match: `host.ends_with(".{pattern}")` (subdomain)
///
/// Returns `Unknown` if no rule matches.
pub fn classify_domain(host: &str) -> TrafficCategory {
    // Strip port if present (e.g. "github.com:443" → "github.com")
    let domain = host.split(':').next().unwrap_or(host);

    for &(pattern, category) in RULES {
        if domain == pattern {
            return category;
        }
        // Suffix match for subdomains: "http-intake.logs.us5.datadoghq.com" matches "datadoghq.com"
        let dot_pattern = format!(".{pattern}");
        if domain.ends_with(&dot_pattern) {
            return category;
        }
    }

    TrafficCategory::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    // Telemetry
    #[test]
    fn test_datadoghq() {
        assert_eq!(
            classify_domain("http-intake.logs.us5.datadoghq.com"),
            TrafficCategory::Telemetry
        );
    }

    #[test]
    fn test_ab_chatgpt_is_telemetry() {
        // ab.chatgpt.com is Codex A/B testing telemetry, NOT Api
        assert_eq!(
            classify_domain("ab.chatgpt.com"),
            TrafficCategory::Telemetry
        );
    }

    #[test]
    fn test_play_googleapis() {
        assert_eq!(
            classify_domain("play.googleapis.com"),
            TrafficCategory::Telemetry
        );
    }

    #[test]
    fn test_segment() {
        assert_eq!(
            classify_domain("cdn.segment.io"),
            TrafficCategory::Telemetry
        );
    }

    // Auth
    #[test]
    fn test_oauth2() {
        assert_eq!(
            classify_domain("oauth2.googleapis.com"),
            TrafficCategory::Auth
        );
    }

    #[test]
    fn test_google_accounts() {
        assert_eq!(
            classify_domain("accounts.google.com"),
            TrafficCategory::Auth
        );
    }

    // Update
    #[test]
    fn test_downloads_claude() {
        assert_eq!(
            classify_domain("downloads.claude.ai"),
            TrafficCategory::Update
        );
    }

    // Git
    #[test]
    fn test_github() {
        assert_eq!(classify_domain("github.com"), TrafficCategory::Git);
    }

    #[test]
    fn test_github_with_port() {
        assert_eq!(classify_domain("github.com:443"), TrafficCategory::Git);
    }

    #[test]
    fn test_raw_githubusercontent() {
        assert_eq!(
            classify_domain("raw.githubusercontent.com"),
            TrafficCategory::Git
        );
    }

    // Api
    #[test]
    fn test_anthropic() {
        assert_eq!(classify_domain("api.anthropic.com"), TrafficCategory::Api);
    }

    #[test]
    fn test_chatgpt_is_api() {
        // chatgpt.com (without subdomain) is Api, NOT telemetry
        assert_eq!(classify_domain("chatgpt.com"), TrafficCategory::Api);
    }

    #[test]
    fn test_cloudcode() {
        assert_eq!(
            classify_domain("cloudcode-pa.googleapis.com"),
            TrafficCategory::Api
        );
    }

    #[test]
    fn test_mcp_proxy() {
        assert_eq!(
            classify_domain("mcp-proxy.anthropic.com"),
            TrafficCategory::Api
        );
    }

    // Unknown
    #[test]
    fn test_unknown() {
        assert_eq!(
            classify_domain("random-domain.com"),
            TrafficCategory::Unknown
        );
    }

    #[test]
    fn test_unknown_empty() {
        assert_eq!(classify_domain(""), TrafficCategory::Unknown);
    }
}
