//! E.3 ADR extraction from markdown
//!
//! Parses the Architecture Decision Records table:
//! ```text
//! | ID | Entscheidung | Status | Kontext | Begruendung | Alternativen | Konsequenzen |
//! |----|-------------|--------|---------|-------------|-------------|-------------|
//! | ADR-1 | Rust Backend | Accepted | ... | ... | ... | ... |
//! ```

use crate::schema::{Adr, AdrStatus};
use super::tables;

/// Extract ADRs from section content (E.3 Architecture Decision Records).
pub fn extract_adrs(section_content: &str) -> Vec<Adr> {
    let table = match tables::parse_table(section_content) {
        Some(t) => t,
        None => return Vec::new(),
    };

    table.rows.iter().filter_map(|row| {
        let id = row.get("ID")?.trim().to_string();
        if id.is_empty() {
            return None;
        }

        let title = row.get("Entscheidung")
            .or_else(|| row.get("Decision"))
            .or_else(|| row.get("Title"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        let status = row.get("Status")
            .map(|s| parse_adr_status(s))
            .unwrap_or(AdrStatus::Proposed);

        let context = row.get("Kontext")
            .or_else(|| row.get("Context"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        let decision = row.get("Begruendung")
            .or_else(|| row.get("Rationale"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        let alternatives = row.get("Alternativen")
            .or_else(|| row.get("Alternatives"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        let consequences = row.get("Konsequenzen")
            .or_else(|| row.get("Consequences"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        Some(Adr {
            id,
            title,
            status,
            date: String::new(),
            context,
            decision,
            alternatives,
            consequences,
        })
    }).collect()
}

/// Parse an ADR status string
fn parse_adr_status(s: &str) -> AdrStatus {
    match s.trim().to_lowercase().as_str() {
        "accepted" | "akzeptiert" => AdrStatus::Accepted,
        "proposed" | "vorgeschlagen" => AdrStatus::Proposed,
        "deprecated" | "veraltet" => AdrStatus::Deprecated,
        "superseded" | "ersetzt" => AdrStatus::Superseded,
        _ => AdrStatus::Proposed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_E3: &str = r#"
| ID | Entscheidung | Status | Kontext | Begruendung | Alternativen | Konsequenzen |
|----|-------------|--------|---------|-------------|-------------|-------------|
| ADR-1 | Rust Backend | Accepted | Brauchen <50ms Latenz | Performance, Safety | Go (GC Pauses), Node | Steile Lernkurve |
| ADR-2 | SolidJS Frontend | Accepted | 120Hz ohne Frame-Drops | Fine-grained Reactivity | React (VDOM), Svelte | Kleineres Ecosystem |
| ADR-3 | Zenoh statt NATS | Accepted | Zero-copy IPC noetig | Rust-native, SHM | NATS, tokio::broadcast | Zenoh kleiner als NATS |
"#;

    #[test]
    fn extract_adrs_from_table() {
        let adrs = extract_adrs(SAMPLE_E3);
        assert_eq!(adrs.len(), 3);

        assert_eq!(adrs[0].id, "ADR-1");
        assert_eq!(adrs[0].title, "Rust Backend");
        assert_eq!(adrs[0].status, AdrStatus::Accepted);
        assert_eq!(adrs[0].context, "Brauchen <50ms Latenz");
        assert_eq!(adrs[0].decision, "Performance, Safety");

        assert_eq!(adrs[2].id, "ADR-3");
        assert_eq!(adrs[2].alternatives, "NATS, tokio::broadcast");
    }

    #[test]
    fn extract_empty_section() {
        let adrs = extract_adrs("No ADRs here.");
        assert!(adrs.is_empty());
    }

    #[test]
    fn parse_adr_statuses() {
        assert_eq!(parse_adr_status("Accepted"), AdrStatus::Accepted);
        assert_eq!(parse_adr_status("Proposed"), AdrStatus::Proposed);
        assert_eq!(parse_adr_status("Deprecated"), AdrStatus::Deprecated);
        assert_eq!(parse_adr_status("Superseded"), AdrStatus::Superseded);
        assert_eq!(parse_adr_status("unknown"), AdrStatus::Proposed);
    }
}
