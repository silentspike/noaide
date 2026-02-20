//! Integration tests using the real noaide IMPL-PLAN.md (1906 lines)
//!
//! These tests verify that the parser handles a production-quality
//! TOGAF ADM plan correctly, extracting all entities.

use togaf_parser::parser;
use togaf_parser::schema::*;

const FIXTURE: &str = include_str!("fixtures/noaide-impl-plan.md");

#[test]
fn parses_without_error() {
    let doc = parser::parse(FIXTURE).expect("parse should succeed");
    assert_eq!(doc.schema, "togaf-plan/1.0");
}

#[test]
fn extracts_meta_correctly() {
    let doc = parser::parse(FIXTURE).unwrap();

    assert_eq!(
        doc.meta.title,
        "noaide - Browser-basierte Real-time IDE fuer Claude Code"
    );
    assert_eq!(doc.meta.tailoring, TailoringLevel::L);
    assert_eq!(doc.meta.scope, "scope:full");
    assert_eq!(doc.meta.adm_iteration, 1);
    assert_eq!(doc.meta.status, PlanStatus::InProgress);
    assert_eq!(doc.meta.version, "v2.2");
    assert_eq!(doc.meta.date, "2026-02-20");
    assert_eq!(doc.meta.confidence, 88);
    assert_eq!(doc.meta.wip_limit, 3);
    assert_eq!(doc.meta.github_repo, Some("silentspike/noaide".to_string()));
}

#[test]
fn extracts_all_47_sections() {
    let doc = parser::parse(FIXTURE).unwrap();

    // Should have at least 47 TOGAF sections
    assert!(
        doc.sections.len() >= 47,
        "Expected >= 47 sections, got {}",
        doc.sections.len()
    );

    // Spot-check key sections exist
    assert!(doc.sections.contains_key("p1"), "Missing P.1");
    assert!(doc.sections.contains_key("a1"), "Missing A.1");
    assert!(doc.sections.contains_key("e4"), "Missing E.4");
    assert!(doc.sections.contains_key("rm3"), "Missing RM.3");
    assert!(doc.sections.contains_key("h5"), "Missing H.5");
}

#[test]
fn all_sections_have_done_status() {
    let doc = parser::parse(FIXTURE).unwrap();

    // In the noaide plan, all sections are checked [x]
    for (id, data) in &doc.sections {
        assert_eq!(
            data.status,
            SectionStatus::Done,
            "Section {} should be Done (all checked in noaide plan)",
            id
        );
    }
}

#[test]
fn extracts_all_5_gates() {
    let doc = parser::parse(FIXTURE).unwrap();

    assert_eq!(doc.gates.len(), 5, "Should have 5 gates (0-4)");

    // All gates passed in noaide plan
    for gate_num in 0..=4 {
        assert_eq!(
            doc.gates[&gate_num],
            GateStatus::Pass,
            "Gate {} should be Pass",
            gate_num
        );
    }
}

#[test]
fn extracts_13_risks() {
    let doc = parser::parse(FIXTURE).unwrap();

    assert_eq!(
        doc.risks.len(),
        13,
        "Should have 13 risks, got {}",
        doc.risks.len()
    );

    // Spot-check first and last risk
    assert_eq!(doc.risks[0].id, "R-1");
    assert!(doc.risks[0].title.contains("Limbo"));
    assert_eq!(doc.risks[0].severity, RiskLevel::High);

    assert_eq!(doc.risks[12].id, "R-13");
    assert!(
        doc.risks[12].title.contains("COOP") || doc.risks[12].title.contains("SharedArrayBuffer")
    );
}

#[test]
fn extracts_11_adrs() {
    let doc = parser::parse(FIXTURE).unwrap();

    assert_eq!(
        doc.adrs.len(),
        11,
        "Should have 11 ADRs, got {}",
        doc.adrs.len()
    );

    // All ADRs should be Accepted in this plan
    for adr in &doc.adrs {
        assert_eq!(
            adr.status,
            AdrStatus::Accepted,
            "ADR {} should be Accepted",
            adr.id
        );
    }

    // Spot-check specific ADRs
    assert_eq!(doc.adrs[0].id, "ADR-1");
    assert_eq!(doc.adrs[0].title, "Rust Backend");

    assert_eq!(doc.adrs[1].id, "ADR-2");
    assert_eq!(doc.adrs[1].title, "SolidJS Frontend");
}

#[test]
fn extracts_20_work_packages() {
    let doc = parser::parse(FIXTURE).unwrap();

    assert_eq!(
        doc.work_packages.len(),
        20,
        "Should have 20 work packages, got {}",
        doc.work_packages.len()
    );

    // Check WP-0
    let wp0 = &doc.work_packages[0];
    assert_eq!(wp0.id, "WP-0");
    assert!(wp0.title.contains("Prerequisites"));
    assert_eq!(wp0.size, WPSize::S);
    assert_eq!(wp0.complexity, WPComplexity::Simple);
    assert!(wp0.gate_required);

    // Check WP-19 exists (last one)
    let wp19 = doc.work_packages.iter().find(|wp| wp.id == "WP-19");
    assert!(wp19.is_some(), "WP-19 should exist");
}

#[test]
fn sections_have_html_content() {
    let doc = parser::parse(FIXTURE).unwrap();

    // All sections should have HTML content
    for (id, data) in &doc.sections {
        assert!(
            data.html.is_some(),
            "Section {} should have HTML content",
            id
        );
        let html = data.html.as_ref().unwrap();
        assert!(!html.is_empty(), "Section {} HTML should not be empty", id);
    }
}

#[test]
fn footer_stats_present() {
    let doc = parser::parse(FIXTURE).unwrap();

    assert!(
        !doc.meta.footer_stats.is_empty(),
        "Footer stats should be present"
    );
    assert!(doc.meta.footer_stats.contains("Sections done"));
    assert!(doc.meta.footer_stats.contains("Gates passed"));
    assert!(doc.meta.footer_stats.contains("WPs"));
    assert!(doc.meta.footer_stats.contains("Risks"));
    assert!(doc.meta.footer_stats.contains("ADRs"));
}

#[test]
fn json_roundtrip() {
    let doc = parser::parse(FIXTURE).unwrap();

    // Serialize to JSON
    let json = togaf_parser::emitter::to_json(&doc).unwrap();

    // Should be valid JSON
    let parsed: PlanDocument = serde_json::from_str(&json).unwrap();

    // Verify key fields survive roundtrip
    assert_eq!(parsed.meta.title, doc.meta.title);
    assert_eq!(parsed.risks.len(), doc.risks.len());
    assert_eq!(parsed.adrs.len(), doc.adrs.len());
    assert_eq!(parsed.work_packages.len(), doc.work_packages.len());
    assert_eq!(parsed.gates.len(), doc.gates.len());
    assert_eq!(parsed.sections.len(), doc.sections.len());
}

#[test]
fn json_size_reasonable() {
    let doc = parser::parse(FIXTURE).unwrap();
    let json = togaf_parser::emitter::to_json(&doc).unwrap();

    // plan.json should be reasonably sized (not empty, not gigantic)
    assert!(
        json.len() > 10_000,
        "JSON should be > 10KB, got {} bytes",
        json.len()
    );
    assert!(
        json.len() < 5_000_000,
        "JSON should be < 5MB, got {} bytes",
        json.len()
    );
}
