//! P.1 Header block extractor -> PlanMeta
//!
//! Parses the code block in P.1 section:
//! ```text
//! # Plan: noaide - Browser-basierte Real-time IDE
//! TOGAF Tailoring Level: L (Architecture)
//! Scope: scope:full
//! ADM-Iteration: 1
//! Status: In Progress
//! Version: v2.2 | Erstellt: 2026-02-20 | ...
//! Confidence: 88% - ...
//! Kanban WIP-Limit: 3 (L-Size)
//! GitHub Repo: silentspike/noaide
//! ```

use regex::Regex;
use std::sync::LazyLock;

use crate::schema::{PlanMeta, PlanStatus, TailoringLevel};

static TITLE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^#\s+Plan:\s+(.+)$").unwrap());

static TAILORING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)TOGAF\s+Tailoring\s+Level:\s*([SML])").unwrap());

static SCOPE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)Scope:\s*(.+)$").unwrap());

static ITERATION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)ADM-Iteration:\s*(\d+)").unwrap());

static STATUS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)Status:\s*(.+)$").unwrap());

static VERSION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Version:\s*(v[\d.]+)").unwrap());

static DATE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Erstellt:\s*(\d{4}-\d{2}-\d{2})").unwrap());

static CONFIDENCE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Confidence:\s*(\d+)%").unwrap());

static WIP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Kanban\s+WIP-Limit:\s*(\d+)").unwrap());

static GITHUB_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)GitHub\s+Repo:\s*(.+)$").unwrap());

/// Extract PlanMeta from a code block (the P.1 content)
pub fn extract_meta(code_block: &str) -> PlanMeta {
    let mut meta = PlanMeta::default();

    for line in code_block.lines() {
        let line = line.trim();

        if let Some(caps) = TITLE_RE.captures(line) {
            meta.title = caps[1].trim().to_string();
        }
        if let Some(caps) = TAILORING_RE.captures(line) {
            meta.tailoring = match caps[1].to_uppercase().as_str() {
                "S" => TailoringLevel::S,
                "M" => TailoringLevel::M,
                _ => TailoringLevel::L,
            };
        }
        if let Some(caps) = SCOPE_RE.captures(line) {
            // Only match if line starts with "Scope:"
            if line.starts_with("Scope:") || line.starts_with("scope:") {
                meta.scope = caps[1].trim().to_string();
            }
        }
        if let Some(caps) = ITERATION_RE.captures(line) {
            meta.adm_iteration = caps[1].parse().unwrap_or(1);
        }
        if let Some(caps) = STATUS_RE.captures(line) {
            if line.starts_with("Status:") {
                let status_str = caps[1].trim();
                meta.status = match status_str {
                    "Draft" => PlanStatus::Draft,
                    "In Progress" => PlanStatus::InProgress,
                    "Review" => PlanStatus::Review,
                    "Final" => PlanStatus::Final,
                    _ => PlanStatus::Draft,
                };
            }
        }
        if let Some(caps) = VERSION_RE.captures(line) {
            meta.version = caps[1].to_string();
        }
        if let Some(caps) = DATE_RE.captures(line) {
            meta.date = caps[1].to_string();
        }
        if let Some(caps) = CONFIDENCE_RE.captures(line) {
            meta.confidence = caps[1].parse().unwrap_or(0);
        }
        if let Some(caps) = WIP_RE.captures(line) {
            meta.wip_limit = caps[1].parse().unwrap_or(3);
        }
        if let Some(caps) = GITHUB_RE.captures(line) {
            meta.github_repo = Some(caps[1].trim().to_string());
        }
    }

    meta
}

/// Try to extract the title from the first line of the markdown
/// (the `# Plan: ...` heading before any sections)
pub fn extract_title_from_heading(heading: &str) -> Option<String> {
    TITLE_RE
        .captures(heading.trim())
        .map(|caps| caps[1].trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_P1: &str = r#"
# Plan: noaide - Browser-basierte Real-time IDE fuer Claude Code
TOGAF Tailoring Level: L (Architecture)
Scope: scope:full
ADM-Iteration: 1
Status: In Progress
Version: v2.2 | Erstellt: 2026-02-20 | v2.0 TOGAF Migration
Confidence: 88% - Architektur vollstaendig
Kanban WIP-Limit: 3 (L-Size)
GitHub Repo: silentspike/noaide
"#;

    #[test]
    fn extract_meta_full() {
        let meta = extract_meta(SAMPLE_P1);
        assert_eq!(
            meta.title,
            "noaide - Browser-basierte Real-time IDE fuer Claude Code"
        );
        assert_eq!(meta.tailoring, TailoringLevel::L);
        assert_eq!(meta.scope, "scope:full");
        assert_eq!(meta.adm_iteration, 1);
        assert_eq!(meta.status, PlanStatus::InProgress);
        assert_eq!(meta.version, "v2.2");
        assert_eq!(meta.date, "2026-02-20");
        assert_eq!(meta.confidence, 88);
        assert_eq!(meta.wip_limit, 3);
        assert_eq!(meta.github_repo, Some("silentspike/noaide".to_string()));
    }

    #[test]
    fn extract_meta_minimal() {
        let meta = extract_meta("TOGAF Tailoring Level: S\nStatus: Draft");
        assert_eq!(meta.tailoring, TailoringLevel::S);
        assert_eq!(meta.status, PlanStatus::Draft);
        assert_eq!(meta.title, ""); // No title
    }

    #[test]
    fn extract_title() {
        assert_eq!(
            extract_title_from_heading("# Plan: My Cool Project"),
            Some("My Cool Project".to_string())
        );
        assert_eq!(extract_title_from_heading("## Not a title"), None);
    }
}
