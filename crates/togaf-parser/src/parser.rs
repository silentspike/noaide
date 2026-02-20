//! Main parser: IMPL-PLAN.md -> PlanDocument
//!
//! Uses text-based section splitting for heading detection and delegates
//! to specialized extractors for structured data. pulldown-cmark is used
//! solely for converting section content to HTML.

use std::collections::HashMap;

use crate::schema::{
    PlanDocument, PlanMeta, SectionData, SectionStatus, GateStatus,
    Priority, Criticality,
};
use crate::sections::{heading_to_section_id, find_section};
use crate::extractors::{meta, checklist, gates, risks, adrs, work_packages};

/// Parse an IMPL-PLAN.md file into a PlanDocument
pub fn parse(markdown: &str) -> Result<PlanDocument, ParseError> {
    let mut doc = PlanDocument::default();

    // 1. Extract title from first line
    let title = extract_plan_title(markdown);

    // 2. Split into (heading, body) sections
    let sections = split_sections(markdown);

    // 3. Find and parse MASTER-CHECKLISTE for section statuses + gates
    let mut section_statuses: HashMap<String, SectionStatus> = HashMap::new();
    let mut gate_map: HashMap<u8, GateStatus> = HashMap::new();

    for (heading, body) in &sections {
        if heading.contains("MASTER-CHECKLISTE") || heading.contains("CHECKLISTE") {
            let (secs, gts) = checklist::parse_checklist(body);
            for (id, status) in secs {
                section_statuses.insert(id, status);
            }
            gate_map = gates::extract_gates_with_defaults(body);
            // Also parse gates from checklist results
            for (num, status) in gts {
                gate_map.insert(num, status);
            }
            break;
        }
    }

    // 4. Process each TOGAF section
    let mut plan_meta = PlanMeta::default();
    let mut risks_vec = Vec::new();
    let mut adrs_vec = Vec::new();
    let mut wps_vec = Vec::new();

    for (heading, body) in &sections {
        if let Some(section_id) = heading_to_section_id(heading) {
            // Special handling for P.1: extract meta from code block
            if section_id == "p1" {
                if let Some(code_block) = extract_code_block(body) {
                    plan_meta = meta::extract_meta(&code_block);
                }
                // Also try title from the plan heading
                if plan_meta.title.is_empty() {
                    if let Some(t) = &title {
                        plan_meta.title = t.clone();
                    }
                }
            }

            // Special handling for E.2: extract risks
            if section_id == "e2" {
                risks_vec = risks::extract_risks(body);
            }

            // Special handling for E.3: extract ADRs
            if section_id == "e3" {
                adrs_vec = adrs::extract_adrs(body);
            }

            // Special handling for E.4: extract work packages
            if section_id == "e4" {
                wps_vec = work_packages::extract_work_packages(body);
            }

            // Build SectionData for all sections
            let status = section_statuses
                .get(&section_id)
                .copied()
                .unwrap_or(SectionStatus::Pending);

            let html = markdown_to_html(body);

            // Determine priority and criticality from section definition
            let (priority, criticality) = section_priority_criticality(&section_id);

            doc.sections.insert(section_id, SectionData {
                status,
                html: Some(html),
                content: Some(body.to_string()),
                priority,
                criticality,
                last_updated: None,
            });
        }
    }

    // 5. Set title from heading if meta didn't have one
    if plan_meta.title.is_empty() {
        if let Some(t) = title {
            plan_meta.title = t;
        }
    }

    // 6. Add last_updated timestamp
    plan_meta.last_updated = chrono_now();

    // 7. Assemble PlanDocument
    doc.meta = plan_meta;
    doc.gates = gate_map;
    doc.risks = risks_vec;
    doc.adrs = adrs_vec;
    doc.work_packages = wps_vec;

    // 8. Build footer stats
    doc.meta.footer_stats = build_footer_stats(&doc);

    Ok(doc)
}

/// Extract the plan title from the first `# Plan: ...` heading
fn extract_plan_title(markdown: &str) -> Option<String> {
    for line in markdown.lines().take(5) {
        let trimmed = line.trim();
        if let Some(t) = meta::extract_title_from_heading(trimmed) {
            return Some(t);
        }
    }
    None
}

/// Split markdown into (heading, body) chunks at `## ` boundaries.
///
/// The heading includes the full `## ...` line, the body is everything
/// until the next `## ` heading or EOF.
fn split_sections(markdown: &str) -> Vec<(String, String)> {
    let mut sections = Vec::new();
    let mut current_heading = String::new();
    let mut current_body = String::new();
    let mut in_section = false;
    let mut in_code_block = false;

    for line in markdown.lines() {
        // Track code blocks to avoid splitting on ## inside them
        if line.trim().starts_with("```") {
            in_code_block = !in_code_block;
        }

        if !in_code_block && line.starts_with("## ") {
            // Save previous section
            if in_section {
                sections.push((current_heading.clone(), current_body.clone()));
            }
            current_heading = line.trim().to_string();
            current_body = String::new();
            in_section = true;
        } else if in_section {
            current_body.push_str(line);
            current_body.push('\n');
        }
    }

    // Don't forget the last section
    if in_section {
        sections.push((current_heading, current_body));
    }

    sections
}

/// Extract content from a fenced code block (between ``` markers)
fn extract_code_block(text: &str) -> Option<String> {
    let mut in_block = false;
    let mut content = String::new();

    for line in text.lines() {
        if line.trim().starts_with("```") {
            if in_block {
                return Some(content);
            }
            in_block = true;
            continue;
        }
        if in_block {
            content.push_str(line);
            content.push('\n');
        }
    }

    if content.is_empty() {
        None
    } else {
        Some(content)
    }
}

/// Convert markdown to HTML using pulldown-cmark
fn markdown_to_html(markdown: &str) -> String {
    let parser = pulldown_cmark::Parser::new(markdown);
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, parser);
    html
}

/// Get a basic timestamp string (without chrono dependency)
fn chrono_now() -> String {
    // We don't want to add chrono as a dependency just for this.
    // Return empty string — the CLI can set it via system time.
    String::new()
}

/// Determine priority and criticality based on section definition
fn section_priority_criticality(section_id: &str) -> (Priority, Criticality) {
    if let Some(def) = find_section(section_id) {
        // Mandatory at L = Must priority, Critical/High criticality
        let priority = if def.is_mandatory(crate::schema::TailoringLevel::S) {
            Priority::Must
        } else if def.is_mandatory(crate::schema::TailoringLevel::M) {
            Priority::Should
        } else if def.is_mandatory(crate::schema::TailoringLevel::L) {
            Priority::Should
        } else {
            Priority::Could
        };

        let criticality = if def.gate.is_some() {
            Criticality::High
        } else {
            Criticality::Medium
        };

        (priority, criticality)
    } else {
        (Priority::Should, Criticality::Medium)
    }
}

/// Build footer stats string
fn build_footer_stats(doc: &PlanDocument) -> String {
    let total = doc.sections.len();
    let done = doc.sections.values()
        .filter(|s| matches!(s.status, SectionStatus::Done))
        .count();
    let gates_passed = doc.gates.values()
        .filter(|g| matches!(g, GateStatus::Pass))
        .count();
    let total_gates = doc.gates.len();

    format!(
        "{}/{} Sections done | {}/{} Gates passed | {} WPs | {} Risks | {} ADRs",
        done, total, gates_passed, total_gates,
        doc.work_packages.len(), doc.risks.len(), doc.adrs.len()
    )
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("no sections found in markdown")]
    NoSections,
    #[error("invalid section heading: {0}")]
    InvalidHeading(String),
    #[error("missing required section: {0}")]
    MissingSection(String),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_sections_basic() {
        let md = "# Title\n\n## A.1 Vision\nContent A\n\n## B.1 Business\nContent B\n";
        let sections = split_sections(md);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].0, "## A.1 Vision");
        assert!(sections[0].1.contains("Content A"));
        assert_eq!(sections[1].0, "## B.1 Business");
    }

    #[test]
    fn split_sections_ignores_code_blocks() {
        let md = "## A.1 Vision\n```\n## Not a heading\n```\nReal content\n";
        let sections = split_sections(md);
        assert_eq!(sections.len(), 1);
        assert!(sections[0].1.contains("## Not a heading"));
    }

    #[test]
    fn extract_code_block_basic() {
        let text = "Some text\n```\ncode line 1\ncode line 2\n```\nMore text";
        let code = extract_code_block(text).unwrap();
        assert!(code.contains("code line 1"));
        assert!(code.contains("code line 2"));
    }

    #[test]
    fn extract_plan_title_basic() {
        let md = "# Plan: My Cool Project\n\n---\n## MASTER-CHECKLISTE";
        assert_eq!(extract_plan_title(md), Some("My Cool Project".to_string()));
    }

    #[test]
    fn markdown_to_html_basic() {
        let html = markdown_to_html("**bold** and *italic*");
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<em>italic</em>"));
    }

    #[test]
    fn parse_minimal_plan() {
        let md = r#"# Plan: Test Plan

---

## MASTER-CHECKLISTE (TOGAF ADM)

### Preliminary Phase
- [x] P.1 Architecture Engagement Record
- [ ] P.2 Architecture Principles
- [x] → **GATE 0 bestanden**

---

## P.1 Architecture Engagement Record

```
# Plan: Test Plan
TOGAF Tailoring Level: S
Scope: scope:quick
ADM-Iteration: 1
Status: Draft
Version: v1.0 | Erstellt: 2026-02-20
Confidence: 50%
Kanban WIP-Limit: 2
```

Some content for P.1.

## E.2 Risk Assessment

| ID | Risiko | Schwere | Wahrscheinlichkeit | Impact | Mitigation | Owner |
|----|--------|---------|---------------------|--------|------------|-------|
| R-1 | Test Risk | High | Low | Something | Do stuff | Claude |

## E.3 Architecture Decision Records

| ID | Entscheidung | Status | Kontext | Begruendung | Alternativen | Konsequenzen |
|----|-------------|--------|---------|-------------|-------------|-------------|
| ADR-1 | Use Rust | Accepted | Need speed | Fast | Go | Compile times |

## E.4 Implementation Work Packages

### WP-0: Setup
Komplexitaet: Simple | Size: S | Scope: scope:quick | Gate: Nein
Kanban-Status: Done

**Abhaengigkeiten:** Keine

**VERIFY:**
- [x] Test: cargo check
"#;
        let doc = parse(md).unwrap();

        // Meta
        assert_eq!(doc.meta.title, "Test Plan");
        assert_eq!(doc.meta.tailoring, crate::schema::TailoringLevel::S);
        assert_eq!(doc.meta.scope, "scope:quick");
        assert_eq!(doc.meta.confidence, 50);
        assert_eq!(doc.meta.wip_limit, 2);

        // Gates
        assert_eq!(doc.gates[&0], GateStatus::Pass);
        assert_eq!(doc.gates[&1], GateStatus::Pending); // default

        // Section statuses from checklist
        assert_eq!(doc.sections["p1"].status, SectionStatus::Done);

        // Risks
        assert_eq!(doc.risks.len(), 1);
        assert_eq!(doc.risks[0].id, "R-1");

        // ADRs
        assert_eq!(doc.adrs.len(), 1);
        assert_eq!(doc.adrs[0].id, "ADR-1");
        assert_eq!(doc.adrs[0].title, "Use Rust");

        // Work Packages
        assert_eq!(doc.work_packages.len(), 1);
        assert_eq!(doc.work_packages[0].id, "WP-0");
        assert_eq!(doc.work_packages[0].status, crate::schema::WPStatus::Done);

        // HTML content present
        assert!(doc.sections["p1"].html.as_ref().unwrap().contains("<code>"));
    }

    #[test]
    fn footer_stats_format() {
        let doc = PlanDocument::default();
        let stats = build_footer_stats(&doc);
        assert!(stats.contains("Sections done"));
        assert!(stats.contains("Gates passed"));
    }
}
