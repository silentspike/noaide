//! E.2 Risk table extraction from markdown
//!
//! Parses the risk assessment table:
//! ```text
//! | ID | Risiko | Schwere | Wahrscheinlichkeit | Impact | Mitigation | Owner |
//! |----|--------|---------|---------------------|--------|------------|-------|
//! | R-1 | Limbo-Instabilitaet | High | Medium | DB-Failures | Fallback ... | Claude |
//! ```

use super::tables;
use crate::schema::{Risk, RiskLevel, RiskStatus};

/// Extract risks from section content (E.2 Risk Assessment).
pub fn extract_risks(section_content: &str) -> Vec<Risk> {
    let table = match tables::parse_table(section_content) {
        Some(t) => t,
        None => return Vec::new(),
    };

    table
        .rows
        .iter()
        .filter_map(|row| {
            let id = row.get("ID")?.trim().to_string();
            if id.is_empty() {
                return None;
            }

            let title = row
                .get("Risiko")
                .or_else(|| row.get("Risk"))
                .map(|s| s.trim().to_string())
                .unwrap_or_default();

            let severity = row
                .get("Schwere")
                .or_else(|| row.get("Severity"))
                .map(|s| parse_risk_level(s))
                .unwrap_or(RiskLevel::Medium);

            let likelihood = row
                .get("Wahrscheinlichkeit")
                .or_else(|| row.get("Likelihood"))
                .or_else(|| row.get("Probability"))
                .map(|s| parse_risk_level(s))
                .unwrap_or(RiskLevel::Medium);

            // Impact column is descriptive text, not a level — derive from severity
            let impact = severity;

            let mitigation = row
                .get("Mitigation")
                .map(|s| s.trim().to_string())
                .unwrap_or_default();

            let owner = row
                .get("Owner")
                .map(|s| s.trim().to_string())
                .unwrap_or_default();

            Some(Risk {
                id,
                title,
                likelihood,
                impact,
                severity,
                mitigation,
                owner,
                status: RiskStatus::Open,
            })
        })
        .collect()
}

/// Parse a risk level string like "High", "Medium", "Low", "Critical"
fn parse_risk_level(s: &str) -> RiskLevel {
    match s.trim().to_lowercase().as_str() {
        "critical" | "kritisch" => RiskLevel::Critical,
        "high" | "hoch" => RiskLevel::High,
        "medium" | "mittel" => RiskLevel::Medium,
        "low" | "niedrig" | "gering" => RiskLevel::Low,
        _ => RiskLevel::Medium,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_E2: &str = r#"
| ID | Risiko | Schwere | Wahrscheinlichkeit | Impact | Mitigation | Owner |
|----|--------|---------|---------------------|--------|------------|-------|
| R-1 | Limbo-Instabilitaet (experimentell) | High | Medium | DB-Failures, Data Loss | Fallback auf rusqlite/SQLite | Claude |
| R-2 | eBPF Kernel-Support auf openSUSE | Medium | Medium | Feature nicht verfuegbar | Fallback auf fanotify direkt | Claude |
| R-3 | WebTransport Browser-Support (Safari) | Medium | Low | Safari-User ausgeschlossen | Safari unsupported Phase 1 | Claude |
"#;

    #[test]
    fn extract_risks_from_table() {
        let risks = extract_risks(SAMPLE_E2);
        assert_eq!(risks.len(), 3);

        assert_eq!(risks[0].id, "R-1");
        assert_eq!(risks[0].title, "Limbo-Instabilitaet (experimentell)");
        assert_eq!(risks[0].severity, RiskLevel::High);
        assert_eq!(risks[0].likelihood, RiskLevel::Medium);
        assert_eq!(risks[0].owner, "Claude");

        assert_eq!(risks[2].id, "R-3");
        assert_eq!(risks[2].likelihood, RiskLevel::Low);
    }

    #[test]
    fn extract_empty_section() {
        let risks = extract_risks("No table here, just text.");
        assert!(risks.is_empty());
    }

    #[test]
    fn parse_risk_levels() {
        assert_eq!(parse_risk_level("High"), RiskLevel::High);
        assert_eq!(parse_risk_level("medium"), RiskLevel::Medium);
        assert_eq!(parse_risk_level("Low"), RiskLevel::Low);
        assert_eq!(parse_risk_level("Critical"), RiskLevel::Critical);
        assert_eq!(parse_risk_level("Hoch"), RiskLevel::High);
        assert_eq!(parse_risk_level("unknown"), RiskLevel::Medium);
    }
}
