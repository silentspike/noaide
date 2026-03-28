use std::path::{Path, PathBuf};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::WalkBuilder;
use serde::Serialize;

use super::FileError;

/// A single entry in a directory listing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    /// Path relative to the project root.
    pub path: String,
    pub is_dir: bool,
    /// Last modification time as epoch seconds.
    pub modified: i64,
    /// Creation (birth) time as epoch seconds. 0 if unavailable.
    pub created: i64,
    /// File size in bytes (0 for directories — see `total_size`).
    pub size: u64,
    /// For directories: total size of all files inside (recursive, .gitignore-aware).
    /// `None` for files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_size: Option<u64>,
    /// For directories: number of files inside (recursive, .gitignore-aware).
    /// `None` for files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_count: Option<u64>,
}

/// Hard-excluded directory prefixes — always skipped regardless of .gitignore.
const HARD_EXCLUDES: &[&str] = &[
    ".git/",
    "node_modules/",
    "target/",
    "__pycache__/",
    ".venv/",
    "venv/",
    ".playwright/",
    ".playwright-cli/",
];

/// Hard-excluded exact filenames.
const HARD_EXCLUDE_FILES: &[&str] = &[".env"];

/// Hard-excluded file extensions (prevent watcher feedback loops).
const HARD_EXCLUDE_EXTENSIONS: &[&str] = &["log"];

/// Maximum number of entries returned per listing to prevent OOM on huge dirs.
const MAX_ENTRIES: usize = 2000;

/// Validate that a path stays within the project root (prevent path traversal).
///
/// Canonicalizes both paths and checks that the resolved path starts with the root.
/// Reusable for both listing and content serving.
pub fn validate_path_within_root(path: &Path, root: &Path) -> Result<PathBuf, FileError> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| FileError::ProjectNotFound)?;
    let canonical_path = path.canonicalize().map_err(FileError::Io)?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err(FileError::PathTraversal);
    }

    Ok(canonical_path)
}

/// List directory contents with .gitignore support and hard excludes.
///
/// Returns entries sorted: directories first, then alphabetically.
/// Respects .gitignore rules via the `ignore` crate.
pub async fn list_directory(
    project_root: &Path,
    relative_subdir: Option<&str>,
) -> Result<Vec<FileEntry>, FileError> {
    let root = project_root
        .canonicalize()
        .map_err(|_| FileError::ProjectNotFound)?;

    let target_dir = if let Some(subdir) = relative_subdir {
        if subdir.is_empty() {
            root.clone()
        } else {
            let candidate = root.join(subdir);
            validate_path_within_root(&candidate, &root)?
        }
    } else {
        root.clone()
    };

    if !target_dir.is_dir() {
        return Err(FileError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "directory not found",
        )));
    }

    // Build gitignore matcher for this project
    let gitignore = build_gitignore(&root);

    let mut entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&target_dir).await.map_err(FileError::Io)?;

    while let Some(entry) = read_dir.next_entry().await.map_err(FileError::Io)? {
        if entries.len() >= MAX_ENTRIES {
            break;
        }

        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();
        let entry_path = entry.path();

        // Compute relative path from project root
        let relative = entry_path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());

        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue, // Skip unreadable entries
        };

        let is_dir = metadata.is_dir();

        // Hard excludes
        if is_dir {
            let dir_prefix = format!("{name}/");
            if HARD_EXCLUDES.iter().any(|e| *e == dir_prefix) {
                continue;
            }
        } else if HARD_EXCLUDE_FILES.contains(&name.as_str()) {
            continue;
        }

        // .gitignore check
        if let Some(ref gi) = gitignore {
            let match_result = gi.matched_path_or_any_parents(&entry_path, is_dir);
            if match_result.is_ignore() {
                continue;
            }
        }

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let created = metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let size = if is_dir { 0 } else { metadata.len() };

        let (total_size, file_count) = if is_dir {
            let (fc, ts) = compute_dir_stats(&entry_path, &root);
            (Some(ts), Some(fc))
        } else {
            (None, None)
        };

        entries.push(FileEntry {
            name,
            path: relative,
            is_dir,
            modified,
            created,
            size,
            total_size,
            file_count,
        });
    }

    // Sort: directories first, then alphabetically by name
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Maximum entries to walk when computing directory stats (prevent hanging on huge dirs).
const MAX_DIR_WALK: usize = 50_000;

/// Compute recursive file count and total size for a directory.
///
/// Uses `ignore::WalkBuilder` to respect .gitignore + hard excludes.
/// Walks at most `MAX_DIR_WALK` entries to prevent hanging on huge directories.
fn compute_dir_stats(dir_path: &Path, project_root: &Path) -> (u64, u64) {
    let mut file_count: u64 = 0;
    let mut total_size: u64 = 0;
    let mut walked: usize = 0;

    let walker = WalkBuilder::new(dir_path)
        .hidden(false) // show dotfiles (except .gitignored)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .parents(true)
        .add_custom_ignore_filename(".gitignore")
        .build();

    for entry in walker {
        if walked >= MAX_DIR_WALK {
            break;
        }
        walked += 1;

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        // Skip the root dir itself
        if path == dir_path {
            continue;
        }

        // Hard excludes
        if should_ignore_path(path, project_root) {
            continue;
        }

        if let Some(ft) = entry.file_type() {
            if ft.is_file() {
                file_count += 1;
                if let Ok(meta) = entry.metadata() {
                    total_size += meta.len();
                }
            }
        }
    }

    (file_count, total_size)
}

/// Build a Gitignore matcher from .gitignore files in the project root.
fn build_gitignore(project_root: &Path) -> Option<Gitignore> {
    let gitignore_path = project_root.join(".gitignore");
    if !gitignore_path.exists() {
        return None;
    }

    let mut builder = GitignoreBuilder::new(project_root);
    builder.add(&gitignore_path);
    builder.build().ok()
}

/// Check if a path should be ignored based on hard excludes.
///
/// Used by the watcher to skip events for files we never want to track.
pub fn should_ignore_path(path: &Path, project_root: &Path) -> bool {
    let relative = match path.strip_prefix(project_root) {
        Ok(r) => r,
        Err(_) => return true,
    };
    let s = relative.to_string_lossy();

    // Check hard-exclude directories
    for exclude in HARD_EXCLUDES {
        if s.starts_with(exclude) || s.contains(&format!("/{exclude}")) {
            return true;
        }
    }

    // Check hard-exclude files
    if let Some(file_name) = path.file_name().and_then(|f| f.to_str()) {
        if HARD_EXCLUDE_FILES.contains(&file_name) {
            return true;
        }
    }

    // Check hard-exclude extensions (prevents watcher feedback loops with log files)
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if HARD_EXCLUDE_EXTENSIONS.contains(&ext) {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn validate_path_within_root_ok() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let sub = root.join("src");
        fs::create_dir(&sub).unwrap();

        let result = validate_path_within_root(&sub, root);
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_traversal_rejected() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let evil = root.join("..").join("etc").join("passwd");

        let result = validate_path_within_root(&evil, root);
        assert!(matches!(result, Err(FileError::PathTraversal) | Err(FileError::Io(_))));
    }

    #[test]
    fn should_ignore_git_dir() {
        let root = Path::new("/work/project");
        assert!(should_ignore_path(
            Path::new("/work/project/.git/config"),
            root
        ));
        assert!(should_ignore_path(
            Path::new("/work/project/node_modules/foo/bar.js"),
            root
        ));
        assert!(should_ignore_path(
            Path::new("/work/project/target/debug/binary"),
            root
        ));
        assert!(should_ignore_path(
            Path::new("/work/project/.env"),
            root
        ));
    }

    #[test]
    fn should_not_ignore_normal_files() {
        let root = Path::new("/work/project");
        assert!(!should_ignore_path(
            Path::new("/work/project/src/main.rs"),
            root
        ));
        assert!(!should_ignore_path(
            Path::new("/work/project/Cargo.toml"),
            root
        ));
    }

    #[tokio::test]
    async fn list_directory_basic() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Create some files and dirs
        fs::create_dir(root.join("src")).unwrap();
        fs::create_dir(root.join("tests")).unwrap();
        fs::write(root.join("Cargo.toml"), "[package]").unwrap();
        fs::write(root.join("README.md"), "# Hello").unwrap();
        // Create hard-excluded dirs
        fs::create_dir(root.join(".git")).unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join(".env"), "SECRET=x").unwrap();

        let entries = list_directory(root, None).await.unwrap();

        // Directories should come first
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"src"));
        assert!(names.contains(&"tests"));
        assert!(names.contains(&"Cargo.toml"));
        assert!(names.contains(&"README.md"));

        // Hard excludes should be filtered
        assert!(!names.contains(&".git"));
        assert!(!names.contains(&"node_modules"));
        assert!(!names.contains(&".env"));

        // Directories first
        let first_file_idx = entries.iter().position(|e| !e.is_dir).unwrap_or(entries.len());
        let last_dir_idx = entries.iter().rposition(|e| e.is_dir).unwrap_or(0);
        assert!(last_dir_idx < first_file_idx || entries.iter().all(|e| e.is_dir));
    }

    #[tokio::test]
    async fn list_subdirectory() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::create_dir_all(root.join("src/components")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(root.join("src/lib.rs"), "pub mod foo;").unwrap();

        let entries = list_directory(root, Some("src")).await.unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"components"));
        assert!(names.contains(&"main.rs"));
        assert!(names.contains(&"lib.rs"));
    }
}
