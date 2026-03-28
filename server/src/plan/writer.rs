//! Chirurgical Markdown editor for IMPL-PLAN.md.
//!
//! Instead of full roundtrip (JSON → MD), these functions do targeted
//! regex-based replacements in the original markdown to preserve formatting.

use regex::Regex;
use std::sync::LazyLock;

// ── WP Status ─────────────────────────────────────────────────

static WP_BLOCK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^###\s+WP-(\d+):").unwrap());

static KANBAN_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?im)^Kanban-Status:\s*(.+)$").unwrap());

/// Update the Kanban-Status line within a specific WP block.
/// Returns the modified markdown.
pub fn update_wp_status(md: &str, wp_id: &str, new_status: &str) -> String {
    let wp_num = wp_id.trim_start_matches("WP-");
    let target_heading = format!("### WP-{}:", wp_num);

    let mut result = String::with_capacity(md.len());
    let mut in_target_wp = false;
    let mut status_replaced = false;

    for line in md.lines() {
        // Detect WP heading
        if line.trim_start().starts_with("### WP-") {
            in_target_wp = line.contains(&target_heading);
        }

        if in_target_wp && !status_replaced && KANBAN_LINE_RE.is_match(line) {
            result.push_str(&format!("Kanban-Status: {}", new_status));
            result.push('\n');
            status_replaced = true;
            continue;
        }

        result.push_str(line);
        result.push('\n');
    }

    // Remove trailing extra newline if original didn't end with one
    if !md.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

// ── Section Status (Checklist) ────────────────────────────────

/// Toggle a checklist item in the MASTER-CHECKLISTE section.
/// `section_id` is like "p1", "a1", "e4" etc.
/// `checked` = true → `[x]`, false → `[ ]`
pub fn update_section_status(md: &str, section_id: &str, checked: bool) -> String {
    let search_id = section_id.to_uppercase().replace(".", "");
    // Match patterns like "- [x] P.1" or "- [ ] E.4"
    let pattern = format!(
        r"(?m)^(\s*-\s+)\[[ xX]\]\s+({}\.?\d*)",
        &search_id[..1] // First char (P, A, B, etc.)
    );

    let re = match Regex::new(&pattern) {
        Ok(r) => r,
        Err(_) => return md.to_string(),
    };

    let mark = if checked { "x" } else { " " };
    let mut result = md.to_string();
    let mut in_checklist = false;

    // Find the checklist section first
    let lines: Vec<&str> = md.lines().collect();
    let mut new_lines = Vec::with_capacity(lines.len());

    for line in &lines {
        if line.contains("MASTER-CHECKLISTE") || line.contains("CHECKLISTE") {
            in_checklist = true;
        }
        // End of checklist at next ## heading
        if in_checklist && line.starts_with("## ") && !line.contains("CHECKLISTE") {
            in_checklist = false;
        }

        if in_checklist {
            // Look for the specific section ID in checkbox lines
            let section_dot = format!("{}.{}", &search_id[..1], &search_id[1..]);
            if line.contains(&section_dot) || line.contains(&search_id) {
                if let Some(caps) = re.captures(line) {
                    let replaced = format!("{}[{}] {}", &caps[1], mark, &caps[2]);
                    new_lines.push(replaced);
                    continue;
                }
            }
        }

        new_lines.push(line.to_string());
    }

    new_lines.join("\n")
}

// ── Gate Status ───────────────────────────────────────────────

static GATE_PASS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?im)GATE\s+(\d)\s+(bestanden|nicht bestanden|ausstehend|pass|fail|pending)")
        .unwrap()
});

/// Update a gate status in the markdown.
pub fn update_gate_status(md: &str, gate: u8, status: &str) -> String {
    let status_text = match status {
        "pass" => "bestanden",
        "fail" => "nicht bestanden",
        "pending" => "ausstehend",
        _ => status,
    };

    let mut result = String::with_capacity(md.len());
    let gate_str = gate.to_string();

    for line in md.lines() {
        if let Some(caps) = GATE_PASS_RE.captures(line) {
            if &caps[1] == gate_str {
                let replaced = line.replace(&caps[2], status_text);
                result.push_str(&replaced);
                result.push('\n');
                continue;
            }
        }
        result.push_str(line);
        result.push('\n');
    }

    if !md.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

// ── Verify Check Toggle ──────────────────────────────────────

/// Toggle a verify check within a WP block.
/// `check_index` is 0-based within the WP's VERIFY section.
pub fn toggle_verify_check(md: &str, wp_id: &str, check_index: usize, passed: bool) -> String {
    let wp_num = wp_id.trim_start_matches("WP-");
    let target_heading = format!("### WP-{}:", wp_num);

    let mut result = String::with_capacity(md.len());
    let mut in_target_wp = false;
    let mut in_verify = false;
    let mut check_count = 0;
    let mark = if passed { "x" } else { " " };

    for line in md.lines() {
        if line.trim_start().starts_with("### WP-") {
            in_target_wp = line.contains(&target_heading);
            in_verify = false;
            check_count = 0;
        }

        if in_target_wp && (line.contains("**VERIFY:**") || line.trim() == "**VERIFY:**") {
            in_verify = true;
            result.push_str(line);
            result.push('\n');
            continue;
        }

        if in_target_wp && in_verify && line.trim().starts_with("- [") {
            if check_count == check_index {
                // Replace [x] or [ ] with the new mark
                let replaced = line
                    .replacen("[ ]", &format!("[{}]", mark), 1)
                    .replacen("[x]", &format!("[{}]", mark), 1)
                    .replacen("[X]", &format!("[{}]", mark), 1);
                result.push_str(&replaced);
                result.push('\n');
                check_count += 1;
                continue;
            }
            check_count += 1;
        }

        // End verify section
        if in_verify
            && (line.starts_with("---") || (line.starts_with("**") && !line.contains("VERIFY")))
        {
            in_verify = false;
        }

        result.push_str(line);
        result.push('\n');
    }

    if !md.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"# Plan

## E.4 Work Packages

### WP-0: Prerequisites
Komplexitaet: Simple | Size: S
Kanban-Status: Backlog

**VERIFY:**
- [ ] Test: eBPF
- [x] Test: Limbo

---

### WP-1: Scaffolding
Komplexitaet: Simple | Size: S
Kanban-Status: Backlog

**VERIFY:**
- [ ] cargo check
"#;

    #[test]
    fn update_wp0_status() {
        let result = update_wp_status(SAMPLE, "WP-0", "In Progress");
        assert!(result.contains("Kanban-Status: In Progress"));
        // WP-1 should still be Backlog
        assert!(result.contains("### WP-1:"));
        let wp1_idx = result.find("### WP-1:").unwrap();
        let after_wp1 = &result[wp1_idx..];
        assert!(after_wp1.contains("Kanban-Status: Backlog"));
    }

    #[test]
    fn update_wp1_status() {
        let result = update_wp_status(SAMPLE, "WP-1", "Done");
        // WP-0 should still be Backlog
        let wp0_idx = result.find("### WP-0:").unwrap();
        let wp1_idx = result.find("### WP-1:").unwrap();
        let between = &result[wp0_idx..wp1_idx];
        assert!(between.contains("Kanban-Status: Backlog"));
        let after_wp1 = &result[wp1_idx..];
        assert!(after_wp1.contains("Kanban-Status: Done"));
    }

    #[test]
    fn toggle_verify_check_pass() {
        let result = toggle_verify_check(SAMPLE, "WP-0", 0, true);
        // First check should now be [x]
        assert!(result.contains("- [x] Test: eBPF"));
    }

    #[test]
    fn toggle_verify_check_unpass() {
        let result = toggle_verify_check(SAMPLE, "WP-0", 1, false);
        // Second check should now be [ ]
        assert!(result.contains("- [ ] Test: Limbo"));
    }
}
