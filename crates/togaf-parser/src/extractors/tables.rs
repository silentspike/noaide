//! Generic markdown table parser
//!
//! Parses markdown tables like:
//! ```text
//! | Header1 | Header2 | Header3 |
//! |---------|---------|---------|
//! | Cell1   | Cell2   | Cell3   |
//! ```
//!
//! Returns rows as Vec<HashMap<String, String>> where keys are header names.

use std::collections::HashMap;

/// A parsed markdown table: headers + rows of named cells
#[derive(Debug, Clone)]
pub struct MarkdownTable {
    pub headers: Vec<String>,
    pub rows: Vec<HashMap<String, String>>,
}

/// Parse a markdown table from text.
///
/// Expects the standard format:
/// - Header row with `|` separators
/// - Separator row with `---` patterns
/// - Data rows with `|` separators
pub fn parse_table(text: &str) -> Option<MarkdownTable> {
    let mut lines = text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty());

    // Find header row (first line with |)
    let header_line = lines.find(|l| l.contains('|'))?;
    let headers = parse_cells(header_line);

    if headers.is_empty() {
        return None;
    }

    // Skip separator row (---|---|...)
    let sep_line = lines.next()?;
    if !sep_line.contains('-') {
        return None;
    }

    // Parse data rows
    let mut rows = Vec::new();
    for line in lines {
        // Stop at empty lines or non-table lines
        if !line.contains('|') {
            break;
        }
        // Skip separator-like lines
        if line.chars().all(|c| c == '|' || c == '-' || c == ' ') {
            continue;
        }
        let cells = parse_cells(line);
        let mut row = HashMap::new();
        for (i, header) in headers.iter().enumerate() {
            let value = cells.get(i).cloned().unwrap_or_default();
            row.insert(header.clone(), value);
        }
        rows.push(row);
    }

    Some(MarkdownTable { headers, rows })
}

/// Parse cells from a pipe-delimited line.
/// `| Cell1 | Cell2 | Cell3 |` -> ["Cell1", "Cell2", "Cell3"]
fn parse_cells(line: &str) -> Vec<String> {
    let trimmed = line.trim().trim_matches('|');
    trimmed
        .split('|')
        .map(|cell| cell.trim().to_string())
        .filter(|cell| !cell.is_empty() || trimmed.contains('|'))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_table() {
        let input = r#"
| Name | Age | City |
|------|-----|------|
| Alice | 30 | Berlin |
| Bob | 25 | Hamburg |
"#;
        let table = parse_table(input).unwrap();
        assert_eq!(table.headers, vec!["Name", "Age", "City"]);
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.rows[0]["Name"], "Alice");
        assert_eq!(table.rows[0]["Age"], "30");
        assert_eq!(table.rows[1]["City"], "Hamburg");
    }

    #[test]
    fn parse_risk_table_format() {
        let input = r#"
| ID | Risiko | Schwere | Wahrscheinlichkeit | Impact | Mitigation | Owner |
|----|--------|---------|---------------------|--------|------------|-------|
| R-1 | Limbo-Instabilitaet | High | Medium | DB-Failures | Fallback auf rusqlite | Claude |
| R-2 | eBPF Support | Medium | Medium | Feature fehlt | Fallback auf fanotify | Claude |
"#;
        let table = parse_table(input).unwrap();
        assert_eq!(table.headers.len(), 7);
        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.rows[0]["ID"], "R-1");
        assert_eq!(table.rows[0]["Schwere"], "High");
        assert_eq!(table.rows[1]["Wahrscheinlichkeit"], "Medium");
    }

    #[test]
    fn parse_empty_returns_none() {
        assert!(parse_table("").is_none());
        assert!(parse_table("no table here").is_none());
    }

    #[test]
    fn parse_table_stops_at_non_table() {
        let input = r#"
| A | B |
|---|---|
| 1 | 2 |

Some text after the table.
| Not | Part |
"#;
        let table = parse_table(input).unwrap();
        assert_eq!(table.rows.len(), 1);
    }
}
