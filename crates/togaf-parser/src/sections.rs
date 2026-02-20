//! TOGAF Section-ID Mapping + Tailoring Matrix
//!
//! Maps markdown headings like "## P.1 Architecture Engagement Record"
//! to section IDs like "p1", and defines which sections are required
//! at each tailoring level (S/M/L).

use regex::Regex;
use std::sync::LazyLock;

use crate::schema::TailoringLevel;

/// A TOGAF section definition
#[derive(Debug, Clone)]
pub struct SectionDef {
    pub id: &'static str,
    pub phase_code: &'static str,
    pub number: u8,
    pub name: &'static str,
    /// Gate after this section's phase (None if no gate)
    pub gate: Option<u8>,
    /// Tailoring: P = Pflicht, R = Recommended, - = Skip
    pub s: Tailoring,
    pub m: Tailoring,
    pub l: Tailoring,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tailoring {
    /// Pflicht (mandatory)
    P,
    /// Recommended (optional but suggested)
    R,
    /// Skip (not applicable at this level)
    Skip,
}

impl SectionDef {
    /// Should this section be included at the given tailoring level?
    pub fn should_show(&self, level: TailoringLevel) -> bool {
        let t = match level {
            TailoringLevel::S => self.s,
            TailoringLevel::M => self.m,
            TailoringLevel::L => self.l,
        };
        matches!(t, Tailoring::P | Tailoring::R)
    }

    /// Is this section mandatory at the given level?
    pub fn is_mandatory(&self, level: TailoringLevel) -> bool {
        let t = match level {
            TailoringLevel::S => self.s,
            TailoringLevel::M => self.m,
            TailoringLevel::L => self.l,
        };
        matches!(t, Tailoring::P)
    }
}

/// All 47 TOGAF sections in order
pub static TOGAF_SECTIONS: &[SectionDef] = &[
    // Preliminary
    SectionDef { id: "p1", phase_code: "P", number: 1, name: "Architecture Engagement Record", gate: Some(0), s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "p2", phase_code: "P", number: 2, name: "Architecture Principles", gate: Some(0), s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "p3", phase_code: "P", number: 3, name: "Stakeholder Concerns", gate: Some(0), s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "p4", phase_code: "P", number: 4, name: "Prerequisites", gate: Some(0), s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "p5", phase_code: "P", number: 5, name: "Glossar", gate: Some(0), s: Tailoring::Skip, m: Tailoring::Skip, l: Tailoring::R },
    // Phase A
    SectionDef { id: "a1", phase_code: "A", number: 1, name: "Vision Statement", gate: Some(1), s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "a2", phase_code: "A", number: 2, name: "Business Context", gate: Some(1), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "a3", phase_code: "A", number: 3, name: "Stakeholder Map", gate: Some(1), s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "a4", phase_code: "A", number: 4, name: "Architecture Scope", gate: Some(1), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "a5", phase_code: "A", number: 5, name: "Key Requirements", gate: Some(1), s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "a6", phase_code: "A", number: 6, name: "Building Blocks", gate: Some(1), s: Tailoring::Skip, m: Tailoring::Skip, l: Tailoring::P },
    // Phase B
    SectionDef { id: "b1", phase_code: "B", number: 1, name: "Business Capabilities", gate: None, s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "b2", phase_code: "B", number: 2, name: "Business Process Flow", gate: None, s: Tailoring::Skip, m: Tailoring::Skip, l: Tailoring::P },
    SectionDef { id: "b3", phase_code: "B", number: 3, name: "Acceptance Criteria", gate: None, s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    // Phase C
    SectionDef { id: "c1", phase_code: "C", number: 1, name: "Data Architecture", gate: None, s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "c2", phase_code: "C", number: 2, name: "Application Architecture", gate: None, s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "c3", phase_code: "C", number: 3, name: "Error Handling Strategy", gate: None, s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "c4", phase_code: "C", number: 4, name: "Security Architecture", gate: None, s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    // Phase D
    SectionDef { id: "d1", phase_code: "D", number: 1, name: "Technology Stack", gate: Some(2), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "d2", phase_code: "D", number: 2, name: "Environment Architecture", gate: Some(2), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "d3", phase_code: "D", number: 3, name: "Feature Flags", gate: Some(2), s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "d4", phase_code: "D", number: 4, name: "Observability Architecture", gate: Some(2), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "d5", phase_code: "D", number: 5, name: "Infrastructure", gate: Some(2), s: Tailoring::Skip, m: Tailoring::Skip, l: Tailoring::P },
    // Phase E
    SectionDef { id: "e1", phase_code: "E", number: 1, name: "Gap Analysis", gate: None, s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "e2", phase_code: "E", number: 2, name: "Risk Assessment", gate: None, s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "e3", phase_code: "E", number: 3, name: "Architecture Decision Records", gate: None, s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "e4", phase_code: "E", number: 4, name: "Work Packages", gate: None, s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "e5", phase_code: "E", number: 5, name: "Dependency Graph", gate: None, s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "e6", phase_code: "E", number: 6, name: "Git & SCM Strategy", gate: None, s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    // Phase F
    SectionDef { id: "f1", phase_code: "F", number: 1, name: "Test-Strategie", gate: Some(3), s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "f2", phase_code: "F", number: 2, name: "Real-World Testing", gate: Some(3), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "f3", phase_code: "F", number: 3, name: "Release & Deployment Plan", gate: Some(3), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "f4", phase_code: "F", number: 4, name: "Rollback Architecture", gate: Some(3), s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "f5", phase_code: "F", number: 5, name: "Kanban Board Setup", gate: Some(3), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    // Phase G
    SectionDef { id: "g1", phase_code: "G", number: 1, name: "Architecture Compliance Review", gate: Some(4), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "g2", phase_code: "G", number: 2, name: "Definition of Done", gate: Some(4), s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "g3", phase_code: "G", number: 3, name: "Success Metrics", gate: Some(4), s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "g4", phase_code: "G", number: 4, name: "Post-Implementation Cleanup", gate: Some(4), s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "g5", phase_code: "G", number: 5, name: "Documentation Updates", gate: Some(4), s: Tailoring::Skip, m: Tailoring::P, l: Tailoring::P },
    // Phase H
    SectionDef { id: "h1", phase_code: "H", number: 1, name: "Architecture Change Log", gate: None, s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "h2", phase_code: "H", number: 2, name: "Lessons Learned", gate: None, s: Tailoring::P, m: Tailoring::P, l: Tailoring::P },
    SectionDef { id: "h3", phase_code: "H", number: 3, name: "Architecture Repository Updates", gate: None, s: Tailoring::Skip, m: Tailoring::Skip, l: Tailoring::P },
    SectionDef { id: "h4", phase_code: "H", number: 4, name: "Plan-Qualitaet Retrospektive", gate: None, s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "h5", phase_code: "H", number: 5, name: "Next Steps & Change Requests", gate: None, s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    // Requirements Management
    SectionDef { id: "rm1", phase_code: "RM", number: 1, name: "Requirements Register", gate: None, s: Tailoring::Skip, m: Tailoring::R, l: Tailoring::P },
    SectionDef { id: "rm2", phase_code: "RM", number: 2, name: "Change Request Log", gate: None, s: Tailoring::Skip, m: Tailoring::Skip, l: Tailoring::P },
    SectionDef { id: "rm3", phase_code: "RM", number: 3, name: "Traceability Matrix", gate: None, s: Tailoring::Skip, m: Tailoring::Skip, l: Tailoring::P },
];

static HEADING_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^##\s+(P|A|B|C|D|E|F|G|H|RM)\.(\d+)\s+").unwrap()
});

/// Parse a markdown heading into a section ID.
///
/// ```
/// use togaf_parser::sections::heading_to_section_id;
/// assert_eq!(heading_to_section_id("## P.1 Architecture Engagement Record"), Some("p1".to_string()));
/// assert_eq!(heading_to_section_id("## RM.3 Traceability Matrix"), Some("rm3".to_string()));
/// assert_eq!(heading_to_section_id("# Not a section"), None);
/// ```
pub fn heading_to_section_id(heading: &str) -> Option<String> {
    HEADING_RE.captures(heading).map(|caps| {
        let phase = caps[1].to_lowercase();
        let num = &caps[2];
        format!("{}{}", phase, num)
    })
}

/// Find a section definition by its ID
pub fn find_section(id: &str) -> Option<&'static SectionDef> {
    TOGAF_SECTIONS.iter().find(|s| s.id == id)
}

/// Get all unique gate numbers in order
pub fn gate_numbers() -> Vec<u8> {
    let mut gates: Vec<u8> = TOGAF_SECTIONS
        .iter()
        .filter_map(|s| s.gate)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    gates.sort();
    gates
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_parsing() {
        assert_eq!(heading_to_section_id("## P.1 Architecture Engagement Record"), Some("p1".to_string()));
        assert_eq!(heading_to_section_id("## A.6 Building Blocks (ABBs/SBBs)"), Some("a6".to_string()));
        assert_eq!(heading_to_section_id("## E.4 Implementation Work Packages"), Some("e4".to_string()));
        assert_eq!(heading_to_section_id("## RM.1 Requirements Register"), Some("rm1".to_string()));
        assert_eq!(heading_to_section_id("## RM.3 Traceability Matrix"), Some("rm3".to_string()));
        assert_eq!(heading_to_section_id("# Not a section heading"), None);
        assert_eq!(heading_to_section_id("### Too deep"), None);
    }

    #[test]
    fn total_section_count() {
        assert_eq!(TOGAF_SECTIONS.len(), 47);
    }

    #[test]
    fn gate_numbers_correct() {
        assert_eq!(gate_numbers(), vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn tailoring_level_s() {
        let mandatory_at_s: Vec<&str> = TOGAF_SECTIONS
            .iter()
            .filter(|s| s.is_mandatory(TailoringLevel::S))
            .map(|s| s.id)
            .collect();
        // At level S: p1, p3, a1, c3, e2, e4, e6, f1, g2, h2
        assert!(mandatory_at_s.contains(&"p1"));
        assert!(mandatory_at_s.contains(&"e2"));
        assert!(mandatory_at_s.contains(&"h2"));
        assert!(!mandatory_at_s.contains(&"b1")); // Not mandatory at S
    }

    #[test]
    fn find_section_works() {
        let sec = find_section("e4").unwrap();
        assert_eq!(sec.name, "Work Packages");
        assert_eq!(sec.phase_code, "E");
        assert!(find_section("z99").is_none());
    }
}
