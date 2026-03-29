use std::path::Path;

use super::FileError;
use super::listing::validate_path_within_root;

/// Default maximum file size for content serving (10 MB).
const DEFAULT_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// Content of a successfully read file.
#[derive(Debug, Clone)]
pub struct FileContent {
    pub content: String,
    pub size: u64,
    pub content_type: String,
}

/// Read a file's content as UTF-8 text.
///
/// Validates the path stays within the project root, checks size limits,
/// and detects binary content by scanning for null bytes in the first 8KB.
pub async fn read_file_content(
    project_root: &Path,
    relative_path: &str,
    max_bytes: Option<u64>,
) -> Result<FileContent, FileError> {
    let max = max_bytes.unwrap_or(DEFAULT_MAX_BYTES);
    let full_path = project_root.join(relative_path);

    // Security: validate path stays within root
    let canonical = validate_path_within_root(&full_path, project_root)?;

    // Check file size before reading
    let metadata = tokio::fs::metadata(&canonical)
        .await
        .map_err(FileError::Io)?;
    if metadata.len() > max {
        return Err(FileError::FileTooLarge {
            size: metadata.len(),
            max,
        });
    }

    // Read raw bytes
    let bytes = tokio::fs::read(&canonical).await.map_err(FileError::Io)?;

    // Binary detection: scan first 8KB for null bytes
    let check_len = bytes.len().min(8192);
    if bytes[..check_len].contains(&0) {
        return Err(FileError::BinaryFile);
    }

    // Convert to UTF-8
    let content = String::from_utf8(bytes).map_err(|_| FileError::BinaryFile)?;
    let content_type = guess_content_type(relative_path);

    Ok(FileContent {
        size: metadata.len(),
        content,
        content_type,
    })
}

/// Write content to a file within the project root.
///
/// Validates the path stays within the project root and enforces size limits.
/// Creates parent directories if they don't exist.
pub async fn write_file_content(
    project_root: &Path,
    relative_path: &str,
    content: &str,
    max_bytes: Option<u64>,
) -> Result<u64, FileError> {
    let max = max_bytes.unwrap_or(DEFAULT_MAX_BYTES);
    let content_len = content.len() as u64;

    if content_len > max {
        return Err(FileError::FileTooLarge {
            size: content_len,
            max,
        });
    }

    let full_path = project_root.join(relative_path);

    // Security: validate path stays within root.
    // The file may not exist yet (new file), so we validate the parent directory.
    if let Some(parent) = full_path.parent() {
        if parent.exists() {
            validate_path_within_root(parent, project_root)?;
        } else {
            // Check the path components don't escape root
            let normalized = project_root.join(relative_path);
            // Reject obvious traversal attempts
            for component in std::path::Path::new(relative_path).components() {
                if matches!(component, std::path::Component::ParentDir) {
                    return Err(FileError::PathTraversal);
                }
            }
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(FileError::Io)?;
            // Re-validate after creation
            validate_path_within_root(&normalized, project_root)?;
        }
    }

    tokio::fs::write(&full_path, content.as_bytes())
        .await
        .map_err(FileError::Io)?;

    Ok(content_len)
}

/// Guess a simple content type from the file extension.
fn guess_content_type(path: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();

    match ext.as_str() {
        "rs" => "text/x-rust",
        "ts" | "tsx" => "text/typescript",
        "js" | "jsx" => "text/javascript",
        "json" => "application/json",
        "toml" => "text/x-toml",
        "yaml" | "yml" => "text/x-yaml",
        "md" => "text/markdown",
        "css" => "text/css",
        "html" | "htm" => "text/html",
        "py" => "text/x-python",
        "sh" | "bash" => "text/x-shellscript",
        "sql" => "text/x-sql",
        "xml" => "application/xml",
        "svg" => "image/svg+xml",
        "txt" | "log" => "text/plain",
        _ => "text/plain",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn read_file_content_utf8() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("hello.rs"), "fn main() { println!(\"hello\"); }").unwrap();

        let result = read_file_content(root, "hello.rs", None).await.unwrap();
        assert!(result.content.contains("fn main()"));
        assert_eq!(result.content_type, "text/x-rust");
        assert!(result.size > 0);
    }

    #[tokio::test]
    async fn read_file_content_too_large() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("big.txt"), "x".repeat(1000)).unwrap();

        let result = read_file_content(root, "big.txt", Some(100)).await;
        assert!(matches!(result, Err(FileError::FileTooLarge { .. })));
    }

    #[tokio::test]
    async fn read_file_binary_rejected() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let mut data = vec![0u8; 100];
        data[0] = b'E';
        data[1] = b'L';
        data[2] = b'F';
        data[3] = 0; // null byte
        fs::write(root.join("binary.bin"), &data).unwrap();

        let result = read_file_content(root, "binary.bin", None).await;
        assert!(matches!(result, Err(FileError::BinaryFile)));
    }

    #[tokio::test]
    async fn read_file_path_traversal() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let result = read_file_content(root, "../../../etc/passwd", None).await;
        assert!(matches!(
            result,
            Err(FileError::PathTraversal) | Err(FileError::Io(_))
        ));
    }

    #[tokio::test]
    async fn read_file_not_found() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let result = read_file_content(root, "nonexistent.rs", None).await;
        assert!(matches!(result, Err(FileError::Io(_))));
    }

    #[test]
    fn content_type_guessing() {
        assert_eq!(guess_content_type("main.rs"), "text/x-rust");
        assert_eq!(guess_content_type("app.tsx"), "text/typescript");
        assert_eq!(guess_content_type("config.json"), "application/json");
        assert_eq!(guess_content_type("Cargo.toml"), "text/x-toml");
        assert_eq!(guess_content_type("unknown.xyz"), "text/plain");
    }
}
