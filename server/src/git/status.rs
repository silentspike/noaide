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

pub fn stage(repo_path: &Path, paths: &[&str]) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;
    let mut index = repo.index()?;

    for path in paths {
        index.add_path(Path::new(path))?;
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
        assert!(result.is_ok(), "checkout should succeed: {:?}", result.err());

        // Verify HEAD points to new branch
        let new_head = repo.head().unwrap();
        assert_eq!(new_head.shorthand().unwrap(), "test-branch");
    }

    #[test]
    fn checkout_fails_for_nonexistent_branch() {
        let dir = create_test_repo();
        let result = checkout(dir.path(), "nonexistent");
        assert!(result.is_err(), "checkout should fail for nonexistent branch");
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
