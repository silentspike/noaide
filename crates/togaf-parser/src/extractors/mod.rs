//! Specialized extractors for different IMPL-PLAN.md sections
//!
//! Each extractor handles a specific data type:
//! - meta: P.1 header block -> PlanMeta
//! - checklist: Master-Checkliste [x]/[ ] -> section status
//! - gates: "GATE N bestanden" patterns -> gate status
//! - tables: Generic markdown table parser
//! - work_packages: E.4 WP extraction
//! - risks: E.2 risk table extraction
//! - adrs: E.3 ADR extraction

pub mod meta;
pub mod checklist;
pub mod gates;
pub mod tables;
pub mod work_packages;
pub mod risks;
pub mod adrs;
