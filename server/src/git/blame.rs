use std::path::Path;

use git2::Repository;

#[derive(Debug, Clone, serde::Serialize)]
pub struct BlameLine {
    pub line_number: usize,
    pub author: String,
    pub email: String,
    pub commit_hash: String,
    pub date: i64,
    pub summary: String,
}

#[derive(Debug, thiserror::Error)]
pub enum BlameError {
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
    #[error("file not found in repository: {0}")]
    FileNotFound(String),
}

pub fn blame_file(repo_path: &Path, file_path: &str) -> Result<Vec<BlameLine>, BlameError> {
    let repo = Repository::open(repo_path)?;

    let blame = repo.blame_file(Path::new(file_path), None)?;
    let mut lines = Vec::new();

    for (i, hunk) in blame.iter().enumerate() {
        let sig = hunk.final_signature();
        let commit_id = hunk.final_commit_id();

        let author = sig.name().unwrap_or("Unknown").to_string();
        let email = sig.email().unwrap_or("").to_string();
        let hash = commit_id.to_string();
        let time = sig.when().seconds();

        let summary = match repo.find_commit(commit_id) {
            Ok(commit) => commit.summary().unwrap_or("").to_string(),
            Err(_) => String::new(),
        };

        let start_line = hunk.final_start_line();
        let num_lines = hunk.lines_in_hunk();

        for line_offset in 0..num_lines {
            let line_num = start_line + line_offset;
            if line_num > 0 {
                lines.push(BlameLine {
                    line_number: line_num,
                    author: author.clone(),
                    email: email.clone(),
                    commit_hash: hash.clone(),
                    date: time,
                    summary: summary.clone(),
                });
            }
        }

        let _ = i; // suppress unused warning
    }

    lines.sort_by_key(|l| l.line_number);
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        let file_path = dir.path().join("test.txt");
        std::fs::write(&file_path, "line 1\nline 2\nline 3\n").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("test.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();

        let sig = git2::Signature::now("Test Author", "test@example.com").unwrap();
        {
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }

        dir
    }

    #[test]
    fn blame_returns_lines_for_existing_file() {
        let dir = create_test_repo();
        let result = blame_file(dir.path(), "test.txt");
        assert!(result.is_ok(), "blame should succeed: {:?}", result.err());
        let lines = result.unwrap();
        assert_eq!(lines.len(), 3, "should have 3 blame lines");
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].author, "Test Author");
        assert!(!lines[0].commit_hash.is_empty());
    }

    #[test]
    fn blame_fails_for_nonexistent_file() {
        let dir = create_test_repo();
        let result = blame_file(dir.path(), "nonexistent.txt");
        assert!(result.is_err());
    }
}
