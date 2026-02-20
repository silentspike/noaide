//! TOGAF ADM Implementation Plan Parser
//!
//! Parses IMPL-PLAN.md files (TOGAF Standard, 10th Edition format)
//! into structured plan.json (PlanDocument).
//!
//! # Architecture
//! - `schema`: Serde structs matching plan.json / TypeScript types 1:1
//! - `sections`: TOGAF section ID mapping + tailoring matrix
//! - `parser`: Main parser (pulldown-cmark events -> PlanDocument)
//! - `extractors`: Specialized extractors (meta, checklist, gates, tables, etc.)
//! - `emitter`: PlanDocument -> JSON serialization

pub mod diff;
pub mod emitter;
pub mod extractors;
pub mod parser;
pub mod schema;
pub mod sections;
