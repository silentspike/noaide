//! Gate status extraction
//!
//! Gates are primarily parsed from the Master-Checkliste via `checklist.rs`.
//! This module provides a convenience function to collect gate statuses
//! into the HashMap<u8, GateStatus> format used by PlanDocument.

use std::collections::HashMap;
use crate::schema::GateStatus;
use super::checklist;

/// Extract gate statuses from a checklist block (typically the Master-Checkliste).
///
/// Returns a HashMap mapping gate numbers to their status.
pub fn extract_gates(checklist_text: &str) -> HashMap<u8, GateStatus> {
    let (_sections, gates) = checklist::parse_checklist(checklist_text);
    gates.into_iter().collect()
}

/// Initialize all 5 gates (0-4) as Pending, then overlay parsed results.
pub fn extract_gates_with_defaults(checklist_text: &str) -> HashMap<u8, GateStatus> {
    let mut map: HashMap<u8, GateStatus> = (0..=4)
        .map(|n| (n, GateStatus::Pending))
        .collect();

    let parsed = extract_gates(checklist_text);
    map.extend(parsed);
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_gates_from_checklist() {
        let text = r#"
- [x] P.1 Architecture Engagement Record
- [x] → **GATE 0 bestanden**
- [x] A.1 Vision Statement
- [ ] → **GATE 1 bestanden**
"#;
        let gates = extract_gates(text);
        assert_eq!(gates.len(), 2);
        assert_eq!(gates[&0], GateStatus::Pass);
        assert_eq!(gates[&1], GateStatus::Pending);
    }

    #[test]
    fn extract_gates_with_defaults_fills_missing() {
        let text = "- [x] → **GATE 0 bestanden**\n- [x] → **GATE 2 bestanden**";
        let gates = extract_gates_with_defaults(text);
        assert_eq!(gates.len(), 5);
        assert_eq!(gates[&0], GateStatus::Pass);
        assert_eq!(gates[&1], GateStatus::Pending);
        assert_eq!(gates[&2], GateStatus::Pass);
        assert_eq!(gates[&3], GateStatus::Pending);
        assert_eq!(gates[&4], GateStatus::Pending);
    }
}
