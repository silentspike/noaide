//! TOGAF Plan API — Read/Write endpoints for IMPL-PLAN.md management.
//!
//! The togaf-parser crate parses IMPL-PLAN.md into a PlanDocument.
//! This module provides HTTP endpoints to read and mutate the plan,
//! with write-back to the source markdown file.

pub mod writer;
