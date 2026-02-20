//! plan.json SSOT Schema — Version 1.0
//!
//! These structs match the TypeScript interfaces in
//! `frontend/src/components/togaf/types/plan.ts` 1:1.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Root object: plan.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanDocument {
    #[serde(rename = "$schema", default = "default_schema")]
    pub schema: String,
    pub meta: PlanMeta,
    pub gates: HashMap<u8, GateStatus>,
    pub sections: HashMap<String, SectionData>,
    #[serde(default)]
    pub work_packages: Vec<WorkPackage>,
    #[serde(default)]
    pub risks: Vec<Risk>,
    #[serde(default)]
    pub adrs: Vec<Adr>,
    #[serde(default)]
    pub requirements: Vec<Requirement>,
    #[serde(default)]
    pub dependency_graph: DependencyGraph,
    #[serde(default)]
    pub sprints: Vec<Sprint>,
}

fn default_schema() -> String {
    "togaf-plan/1.0".to_string()
}

impl Default for PlanDocument {
    fn default() -> Self {
        Self {
            schema: default_schema(),
            meta: PlanMeta::default(),
            gates: HashMap::new(),
            sections: HashMap::new(),
            work_packages: Vec::new(),
            risks: Vec::new(),
            adrs: Vec::new(),
            requirements: Vec::new(),
            dependency_graph: DependencyGraph::default(),
            sprints: Vec::new(),
        }
    }
}

// --- Meta -----------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanMeta {
    #[serde(default)]
    pub title: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default = "default_tailoring")]
    pub tailoring: TailoringLevel,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub status: PlanStatus,
    #[serde(default)]
    pub confidence: u8,
    #[serde(default)]
    pub date: String,
    #[serde(default = "default_wip")]
    pub wip_limit: u8,
    #[serde(default)]
    pub critical_path: String,
    #[serde(default)]
    pub footer_stats: String,
    #[serde(default = "default_iteration")]
    pub adm_iteration: u8,
    #[serde(default)]
    pub last_updated: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_repo: Option<String>,
}

fn default_version() -> String {
    "v1.0".to_string()
}
fn default_tailoring() -> TailoringLevel {
    TailoringLevel::L
}
fn default_wip() -> u8 {
    3
}
fn default_iteration() -> u8 {
    1
}

impl Default for PlanMeta {
    fn default() -> Self {
        Self {
            title: String::new(),
            version: default_version(),
            tailoring: default_tailoring(),
            scope: String::new(),
            status: PlanStatus::Draft,
            confidence: 0,
            date: String::new(),
            wip_limit: default_wip(),
            critical_path: String::new(),
            footer_stats: String::new(),
            adm_iteration: default_iteration(),
            last_updated: String::new(),
            github_repo: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TailoringLevel {
    S,
    M,
    L,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanStatus {
    Draft,
    #[serde(rename = "In Progress")]
    InProgress,
    Review,
    Final,
}

impl Default for PlanStatus {
    fn default() -> Self {
        Self::Draft
    }
}

// --- Gates ----------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GateStatus {
    Pass,
    Pending,
    Fail,
}

// --- Sections -------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SectionStatus {
    Pending,
    #[serde(rename = "in_progress")]
    InProgress,
    Done,
    Skipped,
}

impl Default for SectionStatus {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Must,
    Should,
    Could,
    Wont,
}

impl Default for Priority {
    fn default() -> Self {
        Self::Should
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Criticality {
    Critical,
    High,
    Medium,
    Low,
}

impl Default for Criticality {
    fn default() -> Self {
        Self::Medium
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionData {
    #[serde(default)]
    pub status: SectionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default)]
    pub priority: Priority,
    #[serde(default)]
    pub criticality: Criticality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
}

impl Default for SectionData {
    fn default() -> Self {
        Self {
            status: SectionStatus::Pending,
            html: None,
            content: None,
            priority: Priority::Should,
            criticality: Criticality::Medium,
            last_updated: None,
        }
    }
}

// --- Work Packages --------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WPStatus {
    Backlog,
    Analysis,
    Ready,
    #[serde(rename = "in_progress")]
    InProgress,
    Review,
    Done,
}

impl Default for WPStatus {
    fn default() -> Self {
        Self::Backlog
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WPSize {
    S,
    M,
    L,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WPComplexity {
    Simple,
    Medium,
    Complex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkPackage {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub status: WPStatus,
    pub size: WPSize,
    #[serde(default)]
    pub sprint: u8,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub assignee: String,
    #[serde(default)]
    pub scope_files: Vec<String>,
    #[serde(default)]
    pub gate_required: bool,
    #[serde(default)]
    pub verify_checks: Vec<VerifyCheck>,
    #[serde(default)]
    pub complexity: WPComplexity,
}

impl Default for WPComplexity {
    fn default() -> Self {
        Self::Medium
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyCheck {
    pub description: String,
    #[serde(default)]
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
}

// --- Risks ----------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskStatus {
    Open,
    Mitigated,
    Accepted,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Risk {
    pub id: String,
    pub title: String,
    pub likelihood: RiskLevel,
    pub impact: RiskLevel,
    pub severity: RiskLevel,
    #[serde(default)]
    pub mitigation: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub status: RiskStatus,
}

impl Default for RiskStatus {
    fn default() -> Self {
        Self::Open
    }
}

// --- ADRs -----------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AdrStatus {
    Proposed,
    Accepted,
    Deprecated,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Adr {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub status: AdrStatus,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub decision: String,
    #[serde(default)]
    pub alternatives: String,
    #[serde(default)]
    pub consequences: String,
}

impl Default for AdrStatus {
    fn default() -> Self {
        Self::Proposed
    }
}

// --- Requirements ---------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReqType {
    Func,
    #[serde(rename = "Non-Func")]
    NonFunc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReqStatus {
    Draft,
    Accepted,
    Implemented,
    Verified,
}

impl Default for ReqStatus {
    fn default() -> Self {
        Self::Draft
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Requirement {
    pub id: String,
    pub description: String,
    pub req_type: ReqType,
    #[serde(default)]
    pub priority: Priority,
    #[serde(default)]
    pub status: ReqStatus,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub traces_to: Vec<String>,
    #[serde(default)]
    pub phase: String,
}

// --- Dependency Graph -----------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DependencyGraph {
    #[serde(default)]
    pub critical_path: Vec<String>,
    #[serde(default)]
    pub edges: Vec<DependencyEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyEdge {
    pub from: String,
    pub to: String,
}

// --- Sprints --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sprint {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub work_packages: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_plan_document_serializes() {
        let doc = PlanDocument::default();
        let json = serde_json::to_string_pretty(&doc).unwrap();
        assert!(json.contains("togaf-plan/1.0"));

        // Roundtrip
        let parsed: PlanDocument = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.schema, "togaf-plan/1.0");
        assert_eq!(parsed.meta.wip_limit, 3);
    }

    #[test]
    fn section_status_serde() {
        let data = SectionData {
            status: SectionStatus::InProgress,
            ..Default::default()
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("in_progress"));

        let parsed: SectionData = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.status, SectionStatus::InProgress);
    }

    #[test]
    fn gate_status_serde() {
        let json = r#""pass""#;
        let status: GateStatus = serde_json::from_str(json).unwrap();
        assert_eq!(status, GateStatus::Pass);
    }

    #[test]
    fn plan_status_serde() {
        let json = r#""In Progress""#;
        let status: PlanStatus = serde_json::from_str(json).unwrap();
        assert_eq!(status, PlanStatus::InProgress);
    }
}
