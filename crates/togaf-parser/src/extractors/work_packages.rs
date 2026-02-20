//! E.4 Work Package extraction from markdown
//!
//! Parses work packages from `### WP-N: Title` subsections:
//! ```text
//! ### WP-0: Prerequisites pruefen
//! Komplexitaet: Simple | Size: S | Scope: scope:full | Gate: Ja (User Approval)
//! Kanban-Status: Backlog
//!
//! **Abhaengigkeiten:** blocked by WP-1, WP-2
//!
//! **VERIFY:**
//! - [ ] Test: eBPF Kernel config
//! - [x] Test: Limbo FTS5
//! ```

use regex::Regex;
use std::sync::LazyLock;

use crate::schema::{VerifyCheck, WPComplexity, WPSize, WPStatus, WorkPackage};

static WP_HEADING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^###\s+WP-(\d+):\s+(.+)$").unwrap());

static METADATA_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Komplexitaet:\s*(\w+)\s*\|\s*Size:\s*(\w+)").unwrap());

static GATE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Gate:\s*(Ja|Nein|Yes|No)").unwrap());

static KANBAN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Kanban-Status:\s*(.+)$").unwrap());

static DEPS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\*\*Abhaengigkeiten:\*\*\s*(.+)$").unwrap());

static WP_REF_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"WP-(\d+)").unwrap());

static VERIFY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^-\s+\[([ xX])\]\s+(.+)$").unwrap());

/// Extract work packages from section content (E.4 Implementation Work Packages).
pub fn extract_work_packages(section_content: &str) -> Vec<WorkPackage> {
    let wp_chunks = split_on_wp_headings(section_content);

    wp_chunks
        .into_iter()
        .filter_map(|(heading, body)| {
            let caps = WP_HEADING_RE.captures(&heading)?;
            let num = caps[1].parse::<u8>().ok()?;
            let id = format!("WP-{}", num);
            let title = caps[2].trim().to_string();

            let complexity = extract_complexity(&body);
            let size = extract_size(&body);
            let gate_required = extract_gate_required(&body);
            let status = extract_kanban_status(&body);
            let dependencies = extract_dependencies(&body);
            let verify_checks = extract_verify_checks(&body);
            let scope_files = extract_scope_files(&body);

            Some(WorkPackage {
                id,
                title,
                status,
                size,
                sprint: 0,
                dependencies,
                assignee: String::new(),
                scope_files,
                gate_required,
                verify_checks,
                complexity,
            })
        })
        .collect()
}

/// Split section content into (heading, body) chunks at `### WP-N:` boundaries
fn split_on_wp_headings(text: &str) -> Vec<(String, String)> {
    let mut chunks = Vec::new();
    let mut current_heading = String::new();
    let mut current_body = String::new();
    let mut in_wp = false;

    for line in text.lines() {
        if WP_HEADING_RE.is_match(line.trim()) {
            if in_wp {
                chunks.push((current_heading.clone(), current_body.clone()));
            }
            current_heading = line.trim().to_string();
            current_body = String::new();
            in_wp = true;
        } else if in_wp {
            current_body.push_str(line);
            current_body.push('\n');
        }
    }
    if in_wp {
        chunks.push((current_heading, current_body));
    }

    chunks
}

fn extract_complexity(body: &str) -> WPComplexity {
    for line in body.lines() {
        if let Some(caps) = METADATA_RE.captures(line) {
            return match caps[1].to_lowercase().as_str() {
                "simple" | "einfach" => WPComplexity::Simple,
                "complex" | "komplex" => WPComplexity::Complex,
                _ => WPComplexity::Medium,
            };
        }
    }
    WPComplexity::Medium
}

fn extract_size(body: &str) -> WPSize {
    for line in body.lines() {
        if let Some(caps) = METADATA_RE.captures(line) {
            return match caps[2].to_uppercase().as_str() {
                "S" => WPSize::S,
                "L" => WPSize::L,
                _ => WPSize::M,
            };
        }
    }
    WPSize::M
}

fn extract_gate_required(body: &str) -> bool {
    for line in body.lines() {
        if let Some(caps) = GATE_RE.captures(line) {
            return matches!(caps[1].to_lowercase().as_str(), "ja" | "yes");
        }
    }
    false
}

fn extract_kanban_status(body: &str) -> WPStatus {
    for line in body.lines() {
        if let Some(caps) = KANBAN_RE.captures(line) {
            return parse_wp_status(caps[1].trim());
        }
    }
    WPStatus::Backlog
}

fn extract_dependencies(body: &str) -> Vec<String> {
    for line in body.lines() {
        if let Some(caps) = DEPS_RE.captures(line) {
            let deps_text = &caps[1];
            if deps_text.trim().to_lowercase() == "keine"
                || deps_text.trim().to_lowercase() == "none"
            {
                return Vec::new();
            }
            return WP_REF_RE
                .captures_iter(deps_text)
                .map(|c| format!("WP-{}", &c[1]))
                .collect();
        }
    }
    Vec::new()
}

fn extract_verify_checks(body: &str) -> Vec<VerifyCheck> {
    let mut in_verify = false;
    let mut checks = Vec::new();

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("**VERIFY:**") || trimmed == "**VERIFY:**" {
            in_verify = true;
            continue;
        }
        // Stop when we hit the next section
        if in_verify && trimmed.starts_with("---") {
            break;
        }
        if in_verify {
            if let Some(caps) = VERIFY_RE.captures(trimmed) {
                let passed = &caps[1] != " ";
                let description = caps[2].trim().to_string();
                checks.push(VerifyCheck {
                    description,
                    passed,
                    evidence: None,
                });
            }
        }
    }
    checks
}

fn extract_scope_files(body: &str) -> Vec<String> {
    let mut in_scope = false;
    let mut files = Vec::new();

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("**In Scope:**") {
            in_scope = true;
            continue;
        }
        if in_scope {
            if trimmed.starts_with("**") || trimmed.starts_with("---") || trimmed.is_empty() {
                if !files.is_empty() {
                    break;
                }
                continue;
            }
            if trimmed.starts_with("- ") {
                let file = trimmed.trim_start_matches("- ").trim();
                // Extract just the path part (before any description)
                if let Some(path) = file.split_whitespace().next() {
                    let clean = path.trim_matches('`').trim_matches('(').trim_matches(')');
                    if clean.contains('/') || clean.contains('.') {
                        files.push(clean.to_string());
                    }
                }
            }
        }
    }
    files
}

fn parse_wp_status(s: &str) -> WPStatus {
    match s.to_lowercase().as_str() {
        "backlog" => WPStatus::Backlog,
        "analysis" | "analyse" => WPStatus::Analysis,
        "ready" | "bereit" => WPStatus::Ready,
        "in progress" | "in_progress" | "in arbeit" => WPStatus::InProgress,
        "review" => WPStatus::Review,
        "done" | "fertig" => WPStatus::Done,
        _ => WPStatus::Backlog,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_WP: &str = r#"
## E.4 Implementation Work Packages

### WP-0: Prerequisites pruefen
Komplexitaet: Simple | Size: S | Scope: scope:full | Gate: Ja (User Approval)
Kanban-Status: Backlog

**Kontext:** Alle Technologie-Voraussetzungen validieren.

**In Scope:**
- `certs/` (NEU) — Verzeichnis fuer lokale CA + Certs via mkcert
- `frontend/public/fonts/` (NEU) — Monaspace Neon + Inter als WOFF2

**Abhaengigkeiten:** Keine

**VERIFY:**
- [ ] Test: eBPF Kernel config
- [x] Test: Limbo FTS5
- [ ] Manuell: Verzeichnisstruktur korrekt

---

### WP-1: Rust Workspace + Cargo Scaffolding
Komplexitaet: Simple | Size: S | Scope: scope:full | Gate: Nein
Kanban-Status: Backlog

**Kontext:** Cargo Workspace mit allen Crates anlegen.

**Abhaengigkeiten:** blocked by WP-0

**VERIFY:**
- [ ] Test: cargo check compiles

---

### WP-2: ECS World + Limbo DB Setup
Komplexitaet: Medium | Size: M | Scope: scope:full | Gate: Nein
Kanban-Status: Backlog

**Abhaengigkeiten:** blocked by WP-1

**VERIFY:**
- [ ] Test: ECS World erstellt
"#;

    #[test]
    fn extract_all_work_packages() {
        let wps = extract_work_packages(SAMPLE_WP);
        assert_eq!(wps.len(), 3);
    }

    #[test]
    fn extract_wp_metadata() {
        let wps = extract_work_packages(SAMPLE_WP);

        assert_eq!(wps[0].id, "WP-0");
        assert_eq!(wps[0].title, "Prerequisites pruefen");
        assert_eq!(wps[0].complexity, WPComplexity::Simple);
        assert_eq!(wps[0].size, WPSize::S);
        assert!(wps[0].gate_required);
        assert_eq!(wps[0].status, WPStatus::Backlog);
    }

    #[test]
    fn extract_wp_dependencies() {
        let wps = extract_work_packages(SAMPLE_WP);

        assert!(wps[0].dependencies.is_empty()); // "Keine"
        assert_eq!(wps[1].dependencies, vec!["WP-0"]);
        assert_eq!(wps[2].dependencies, vec!["WP-1"]);
    }

    #[test]
    fn extract_wp_verify_checks() {
        let wps = extract_work_packages(SAMPLE_WP);

        assert_eq!(wps[0].verify_checks.len(), 3);
        assert!(!wps[0].verify_checks[0].passed); // [ ] Test: eBPF
        assert!(wps[0].verify_checks[1].passed); // [x] Test: Limbo
        assert_eq!(
            wps[0].verify_checks[0].description,
            "Test: eBPF Kernel config"
        );
    }

    #[test]
    fn extract_wp_scope_files() {
        let wps = extract_work_packages(SAMPLE_WP);
        assert_eq!(wps[0].scope_files, vec!["certs/", "frontend/public/fonts/"]);
    }

    #[test]
    fn extract_multiple_dependencies() {
        let text = r#"
### WP-5: PTY Session Manager
Komplexitaet: Complex | Size: M | Scope: scope:full | Gate: Nein
Kanban-Status: In Progress

**Abhaengigkeiten:** blocked by WP-2, WP-3, WP-4
"#;
        let wps = extract_work_packages(text);
        assert_eq!(wps[0].dependencies, vec!["WP-2", "WP-3", "WP-4"]);
        assert_eq!(wps[0].status, WPStatus::InProgress);
        assert_eq!(wps[0].complexity, WPComplexity::Complex);
    }
}
