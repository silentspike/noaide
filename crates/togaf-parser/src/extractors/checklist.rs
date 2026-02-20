//! Master-Checkliste [x]/[ ] parser -> section status + gate status
//!
//! Parses lines like:
//! - `- [x] P.1 Architecture Engagement Record` → ("p1", Done)
//! - `- [ ] A.3 Stakeholder Map` → ("a3", Pending)
//! - `- [x] → **GATE 0 bestanden**` → Gate(0, Pass)

use regex::Regex;
use std::sync::LazyLock;

use crate::schema::{GateStatus, SectionStatus};

/// Result of parsing a checklist line
#[derive(Debug, PartialEq)]
pub enum ChecklistItem {
    /// A section status: (section_id, status)
    Section(String, SectionStatus),
    /// A gate status: (gate_number, status)
    Gate(u8, GateStatus),
    /// Not a recognized checklist item
    Unknown,
}

static SECTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^-\s+\[([ xX])\]\s+(P|A|B|C|D|E|F|G|H|RM)\.(\d+)\s+").unwrap());

static GATE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^-\s+\[([ xX])\]\s+.*GATE\s+(\d+)").unwrap());

/// Parse a single checklist line into a ChecklistItem
pub fn parse_checklist_line(line: &str) -> ChecklistItem {
    let trimmed = line.trim();

    // Try section match first
    if let Some(caps) = SECTION_RE.captures(trimmed) {
        let checked = &caps[1] != " ";
        let phase = caps[2].to_lowercase();
        let num = &caps[3];
        let section_id = format!("{}{}", phase, num);
        let status = if checked {
            SectionStatus::Done
        } else {
            SectionStatus::Pending
        };
        return ChecklistItem::Section(section_id, status);
    }

    // Try gate match
    if let Some(caps) = GATE_RE.captures(trimmed) {
        let checked = &caps[1] != " ";
        if let Ok(gate_num) = caps[2].parse::<u8>() {
            let status = if checked {
                GateStatus::Pass
            } else {
                GateStatus::Pending
            };
            return ChecklistItem::Gate(gate_num, status);
        }
    }

    ChecklistItem::Unknown
}

/// Parsed checklist result: (section_statuses, gate_statuses).
pub type ChecklistResult = (Vec<(String, SectionStatus)>, Vec<(u8, GateStatus)>);

/// Parse all checklist lines from a block of text.
pub fn parse_checklist(text: &str) -> ChecklistResult {
    let mut sections = Vec::new();
    let mut gates = Vec::new();

    for line in text.lines() {
        match parse_checklist_line(line) {
            ChecklistItem::Section(id, status) => sections.push((id, status)),
            ChecklistItem::Gate(num, status) => gates.push((num, status)),
            ChecklistItem::Unknown => {}
        }
    }

    (sections, gates)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_checked_section() {
        assert_eq!(
            parse_checklist_line("- [x] P.1 Architecture Engagement Record"),
            ChecklistItem::Section("p1".to_string(), SectionStatus::Done)
        );
    }

    #[test]
    fn parse_unchecked_section() {
        assert_eq!(
            parse_checklist_line("- [ ] A.3 Stakeholder Map"),
            ChecklistItem::Section("a3".to_string(), SectionStatus::Pending)
        );
    }

    #[test]
    fn parse_rm_section() {
        assert_eq!(
            parse_checklist_line("- [x] RM.3 Traceability Matrix"),
            ChecklistItem::Section("rm3".to_string(), SectionStatus::Done)
        );
    }

    #[test]
    fn parse_gate_passed() {
        assert_eq!(
            parse_checklist_line("- [x] → **GATE 0 bestanden**"),
            ChecklistItem::Gate(0, GateStatus::Pass)
        );
    }

    #[test]
    fn parse_gate_pending() {
        assert_eq!(
            parse_checklist_line("- [ ] → **GATE 2 bestanden**"),
            ChecklistItem::Gate(2, GateStatus::Pending)
        );
    }

    #[test]
    fn parse_non_section_line() {
        assert_eq!(
            parse_checklist_line("- [x] Qualitaets-Check durchgefuehrt"),
            ChecklistItem::Unknown
        );
    }

    #[test]
    fn parse_full_checklist_block() {
        let text = r#"
- [x] P.1 Architecture Engagement Record
- [x] P.2 Architecture Principles
- [ ] P.3 Stakeholder Concerns
- [x] → **GATE 0 bestanden**
- [x] A.1 Vision Statement
- [ ] → **GATE 1 bestanden**
"#;
        let (sections, gates) = parse_checklist(text);
        assert_eq!(sections.len(), 4); // P.1, P.2, P.3, A.1
        assert_eq!(sections[0], ("p1".to_string(), SectionStatus::Done));
        assert_eq!(sections[2], ("p3".to_string(), SectionStatus::Pending));
        assert_eq!(sections[3], ("a1".to_string(), SectionStatus::Done));
        assert_eq!(gates.len(), 2);
        assert_eq!(gates[0], (0, GateStatus::Pass));
        assert_eq!(gates[1], (1, GateStatus::Pending));
    }
}
