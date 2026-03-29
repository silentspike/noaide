use std::path::Path;

use git2::{BranchType, Repository, Signature, StatusOptions};

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
    #[error("not a git repository: {0}")]
    NotRepo(String),
    #[error("branch not found: {0}")]
    BranchNotFound(String),
    #[error("{0}")]
    Other(String),
}

pub fn status(repo_path: &Path) -> Result<Vec<FileStatus>, GitError> {
    let repo = Repository::open(repo_path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut files = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        let (status_str, staged) = if s.is_index_new() {
            ("added", true)
        } else if s.is_index_modified() {
            ("modified", true)
        } else if s.is_index_deleted() {
            ("deleted", true)
        } else if s.is_index_renamed() {
            ("renamed", true)
        } else if s.is_wt_new() {
            ("untracked", false)
        } else if s.is_wt_modified() {
            ("modified", false)
        } else if s.is_wt_deleted() {
            ("deleted", false)
        } else if s.is_wt_renamed() {
            ("renamed", false)
        } else if s.is_conflicted() {
            ("conflict", false)
        } else {
            continue;
        };

        files.push(FileStatus {
            path,
            status: status_str.to_string(),
            staged,
        });
    }

    Ok(files)
}

pub fn branches(repo_path: &Path) -> Result<Vec<BranchInfo>, GitError> {
    let repo = Repository::open(repo_path)?;
    let mut result = Vec::new();

    let head = repo.head().ok();
    let current_branch = head.as_ref().and_then(|h| h.shorthand().map(String::from));

    for branch_result in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = branch_result?;
        let name = branch.name()?.unwrap_or("").to_string();
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(String::from));

        result.push(BranchInfo {
            is_current: current_branch.as_deref() == Some(&name),
            name,
            is_remote: false,
            upstream,
        });
    }

    for branch_result in repo.branches(Some(BranchType::Remote))? {
        let (branch, _) = branch_result?;
        let name = branch.name()?.unwrap_or("").to_string();

        result.push(BranchInfo {
            name,
            is_current: false,
            is_remote: true,
            upstream: None,
        });
    }

    Ok(result)
}

pub fn checkout(repo_path: &Path, branch_name: &str) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;

    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .map_err(|_| GitError::BranchNotFound(branch_name.to_string()))?;

    let refname = branch
        .get()
        .name()
        .ok_or_else(|| GitError::BranchNotFound(branch_name.to_string()))?;

    let obj = repo.revparse_single(refname)?;
    repo.checkout_tree(&obj, None)?;
    repo.set_head(refname)?;

    Ok(())
}

/// Create a new branch from HEAD and check it out.
pub fn create_branch(repo_path: &Path, branch_name: &str) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;
    let head = repo.head()?.peel_to_commit()?;
    repo.branch(branch_name, &head, false)?;
    checkout(repo_path, branch_name)?;
    Ok(())
}

pub fn stage(repo_path: &Path, paths: &[&str]) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;
    let mut index = repo.index()?;

    for path in paths {
        index.add_path(Path::new(path))?;
    }

    index.write()?;
    Ok(())
}

pub fn unstage(repo_path: &Path, paths: &[&str]) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;
    let head = repo.head()?.peel_to_commit()?;
    let head_tree = head.tree()?;
    let mut index = repo.index()?;

    for path in paths {
        match head_tree.get_path(Path::new(path)) {
            Ok(entry) => {
                index.add(&git2::IndexEntry {
                    ctime: git2::IndexTime::new(0, 0),
                    mtime: git2::IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: entry.filemode() as u32,
                    uid: 0,
                    gid: 0,
                    file_size: 0,
                    id: entry.id(),
                    flags: 0,
                    flags_extended: 0,
                    path: path.as_bytes().to_vec(),
                })?;
            }
            Err(_) => {
                index.remove_path(Path::new(path))?;
            }
        }
    }

    index.write()?;
    Ok(())
}

pub fn commit(repo_path: &Path, message: &str) -> Result<String, GitError> {
    let repo = Repository::open(repo_path)?;
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;

    let sig = repo.signature().unwrap_or_else(|_| {
        Signature::now("noaide", "noaide@localhost").expect("default signature")
    });

    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit()?),
        Err(_) => None,
    };

    let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;

    Ok(oid.to_string())
}

pub fn log(repo_path: &Path, max_count: usize) -> Result<Vec<CommitInfo>, GitError> {
    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let mut commits = Vec::new();

    for oid_result in revwalk.take(max_count) {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        let hash = oid.to_string();
        let short_hash = hash[..7.min(hash.len())].to_string();

        commits.push(CommitInfo {
            hash,
            short_hash,
            message: commit.message().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            email: commit.author().email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
        });
    }

    Ok(commits)
}

/// A single diff hunk for a file.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiffLine {
    pub origin: char, // '+', '-', ' '
    pub content: String,
}

/// Get diff hunks for a single file (unstaged changes).
pub fn diff_hunks(repo_path: &Path, file_path: &str) -> Result<Vec<DiffHunk>, GitError> {
    let repo = Repository::open(repo_path)?;
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(file_path);

    let diff = repo.diff_index_to_workdir(None, Some(&mut diff_opts))?;
    let mut hunks = Vec::new();

    // Collect all diff data in a single pass using print callback
    diff.print(git2::DiffFormat::Patch, |_delta, maybe_hunk, line| {
        if let Some(hunk) = maybe_hunk {
            // Check if this is a new hunk (different header from last)
            let header = String::from_utf8_lossy(hunk.header()).trim().to_string();
            if hunks.last().is_none_or(|h: &DiffHunk| h.header != header) {
                hunks.push(DiffHunk {
                    header,
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    lines: Vec::new(),
                });
            }
        }
        match line.origin() {
            '+' | '-' | ' ' => {
                if let Some(last) = hunks.last_mut() {
                    last.lines.push(DiffLine {
                        origin: line.origin(),
                        content: String::from_utf8_lossy(line.content()).to_string(),
                    });
                }
            }
            _ => {}
        }
        true
    })?;

    Ok(hunks)
}

/// Stage a specific hunk by applying a patch via `git apply --cached`.
/// This uses git CLI because libgit2 doesn't support partial staging natively.
pub fn stage_hunk(repo_path: &Path, file_path: &str, hunk_index: usize) -> Result<(), GitError> {
    let hunks = diff_hunks(repo_path, file_path)?;
    let hunk = hunks.get(hunk_index).ok_or_else(|| {
        GitError::Other(format!(
            "hunk index {} out of range ({})",
            hunk_index,
            hunks.len()
        ))
    })?;

    // Build a unified diff patch for this single hunk
    let mut patch = format!("--- a/{file_path}\n+++ b/{file_path}\n{}\n", hunk.header);
    for line in &hunk.lines {
        patch.push(line.origin);
        patch.push_str(&line.content);
        if !line.content.ends_with('\n') {
            patch.push('\n');
        }
    }

    // Apply via git CLI (git apply --cached)
    let output = std::process::Command::new("git")
        .args(["apply", "--cached", "--unidiff-zero", "-"])
        .current_dir(repo_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(patch.as_bytes())?;
            child.wait_with_output()
        })
        .map_err(|e| GitError::Other(format!("git apply failed: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Other(format!("git apply failed: {stderr}")));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        let file_path = dir.path().join("test.txt");
        std::fs::write(&file_path, "line 1\nline 2\n").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new("test.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();

        let sig = Signature::now("Test Author", "test@example.com").unwrap();
        {
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }

        dir
    }

    #[test]
    fn status_returns_file_list() {
        let dir = create_test_repo();
        // Create an untracked file to ensure status has something
        std::fs::write(dir.path().join("new.txt"), "new file\n").unwrap();
        let result = status(dir.path());
        assert!(result.is_ok(), "status should succeed: {:?}", result.err());
        let files = result.unwrap();
        assert!(!files.is_empty(), "should have at least one file");
        assert!(
            files.iter().any(|f| f.path == "new.txt"),
            "should find new.txt"
        );
    }

    #[test]
    fn branches_lists_current() {
        let dir = create_test_repo();
        let result = branches(dir.path());
        assert!(
            result.is_ok(),
            "branches should succeed: {:?}",
            result.err()
        );
        let branch_list = result.unwrap();
        assert!(!branch_list.is_empty(), "should have branches");
        assert!(
            branch_list.iter().any(|b| b.is_current),
            "should have a current branch"
        );
    }

    #[test]
    fn log_returns_recent_commits() {
        let dir = create_test_repo();
        let result = log(dir.path(), 5);
        assert!(result.is_ok(), "log should succeed: {:?}", result.err());
        let commits = result.unwrap();
        assert_eq!(commits.len(), 1, "should have 1 commit");
        assert_eq!(commits[0].message, "Initial commit");
        assert_eq!(commits[0].author, "Test Author");
        assert_eq!(commits[0].short_hash.len(), 7);
    }

    #[test]
    fn checkout_switches_branch() {
        let dir = create_test_repo();
        let repo = Repository::open(dir.path()).unwrap();

        // Create a new branch from HEAD
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("test-branch", &head, false).unwrap();

        // Checkout the new branch
        let result = checkout(dir.path(), "test-branch");
        assert!(
            result.is_ok(),
            "checkout should succeed: {:?}",
            result.err()
        );

        // Verify HEAD points to new branch
        let new_head = repo.head().unwrap();
        assert_eq!(new_head.shorthand().unwrap(), "test-branch");
    }

    #[test]
    fn checkout_fails_for_nonexistent_branch() {
        let dir = create_test_repo();
        let result = checkout(dir.path(), "nonexistent");
        assert!(
            result.is_err(),
            "checkout should fail for nonexistent branch"
        );
    }

    #[test]
    fn stage_adds_files_to_index() {
        let dir = create_test_repo();

        // Create a new file
        std::fs::write(dir.path().join("staged.txt"), "staged content\n").unwrap();

        // Stage it
        let result = stage(dir.path(), &["staged.txt"]);
        assert!(result.is_ok(), "stage should succeed: {:?}", result.err());

        // Verify it appears as staged in status
        let files = status(dir.path()).unwrap();
        let staged_file = files.iter().find(|f| f.path == "staged.txt");
        assert!(staged_file.is_some(), "staged.txt should appear in status");
        assert!(staged_file.unwrap().staged, "staged.txt should be staged");
    }

    #[test]
    fn unstage_removes_files_from_index() {
        let dir = create_test_repo();
        std::fs::write(dir.path().join("staged.txt"), "content\n").unwrap();
        stage(dir.path(), &["staged.txt"]).unwrap();

        let files = status(dir.path()).unwrap();
        assert!(
            files.iter().any(|f| f.path == "staged.txt" && f.staged),
            "staged.txt should be staged"
        );

        unstage(dir.path(), &["staged.txt"]).unwrap();

        let files = status(dir.path()).unwrap();
        let f = files.iter().find(|f| f.path == "staged.txt").unwrap();
        assert!(!f.staged, "staged.txt should be unstaged after unstage()");
    }

    #[test]
    fn commit_creates_new_commit() {
        let dir = create_test_repo();

        // Create and stage a new file
        std::fs::write(dir.path().join("new.txt"), "new content\n").unwrap();
        stage(dir.path(), &["new.txt"]).unwrap();

        // Commit
        let result = commit(dir.path(), "Add new file");
        assert!(result.is_ok(), "commit should succeed: {:?}", result.err());

        let hash = result.unwrap();
        assert!(!hash.is_empty(), "commit hash should not be empty");
        assert_eq!(hash.len(), 40, "commit hash should be 40 hex chars");

        // Verify commit appears in log
        let commits = log(dir.path(), 5).unwrap();
        assert_eq!(commits.len(), 2, "should have 2 commits now");
        assert_eq!(commits[0].message, "Add new file");
    }
}
