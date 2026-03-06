use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::{info, warn};

/// Information about a single team member/agent.
///
/// Uses `deny_unknown_fields = false` (serde default) to tolerate extra fields
/// like `model`, `joinedAt`, `tmuxPaneId`, `cwd`, `prompt`, `color`, etc.
/// that Claude Code team configs include.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    #[serde(rename = "agentId")]
    pub agent_id: String,
    #[serde(rename = "agentType", default)]
    pub agent_type: Option<String>,
}

/// A team configuration as stored in ~/.claude/teams/.
///
/// Claude Code uses `name` (not `team_name`) and `createdAt` (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamConfig {
    /// Team name — Claude Code stores this as `name` in config.json.
    #[serde(alias = "team_name")]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub members: Vec<AgentInfo>,
    #[serde(alias = "created_at", rename = "createdAt", default)]
    pub created_at: Option<serde_json::Value>,
}

/// Discovered team with resolved paths
#[derive(Debug, Clone)]
pub struct DiscoveredTeam {
    pub config: TeamConfig,
    pub config_path: PathBuf,
    pub task_dir: Option<PathBuf>,
}

/// Event emitted when team state changes
#[derive(Debug, Clone)]
pub enum TeamEvent {
    TeamDiscovered(DiscoveredTeam),
    TeamUpdated(DiscoveredTeam),
    TeamRemoved(String),
}

/// A task file as stored in ~/.claude/tasks/{team}/N.json
///
/// Tolerates extra fields (metadata, etc.) that may be present.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFile {
    pub id: String,
    pub subject: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "activeForm", default)]
    pub active_form: Option<String>,
    pub status: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(rename = "blockedBy", default)]
    pub blocked_by: Vec<String>,
    /// File modification time (set by load_tasks, not from JSON)
    #[serde(skip_deserializing, default)]
    pub modified_at: Option<i64>,
}

/// Load all task JSON files from a task directory.
/// Skips non-JSON files (.lock, .highwatermark, etc.)
/// Returns tasks sorted by numeric ID.
pub async fn load_tasks(task_dir: &Path) -> Vec<TaskFile> {
    let mut tasks = Vec::new();

    let mut entries = match tokio::fs::read_dir(task_dir).await {
        Ok(e) => e,
        Err(e) => {
            warn!("failed to read task directory {:?}: {e}", task_dir);
            return tasks;
        }
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match tokio::fs::read_to_string(&path).await {
            Ok(c) => c,
            Err(e) => {
                warn!("failed to read task file {:?}: {e}", path);
                continue;
            }
        };

        let mut task: TaskFile = match serde_json::from_str(&content) {
            Ok(t) => t,
            Err(e) => {
                warn!("failed to parse task file {:?}: {e}", path);
                continue;
            }
        };

        // Set file mtime as modified_at timestamp
        if let Ok(metadata) = tokio::fs::metadata(&path).await
            && let Ok(modified) = metadata.modified()
            && let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH)
        {
            task.modified_at = Some(duration.as_secs() as i64);
        }

        tasks.push(task);
    }

    // Sort by numeric ID (fall back to string sort)
    tasks.sort_by(|a, b| {
        let a_num: Result<u64, _> = a.id.parse();
        let b_num: Result<u64, _> = b.id.parse();
        match (a_num, b_num) {
            (Ok(an), Ok(bn)) => an.cmp(&bn),
            _ => a.id.cmp(&b.id),
        }
    });

    tasks
}

/// Scans ~/.claude/teams/ for team configurations
pub struct TeamDiscovery {
    claude_dir: PathBuf,
    event_tx: broadcast::Sender<TeamEvent>,
}

impl TeamDiscovery {
    pub fn new(claude_dir: &Path) -> (Self, broadcast::Receiver<TeamEvent>) {
        let (tx, rx) = broadcast::channel(64);
        (
            Self {
                claude_dir: claude_dir.to_path_buf(),
                event_tx: tx,
            },
            rx,
        )
    }

    /// Scan for all team configurations
    pub async fn scan(&self) -> Vec<DiscoveredTeam> {
        let teams_dir = self.claude_dir.join("teams");
        let mut teams = Vec::new();

        if !teams_dir.exists() {
            info!("no teams directory found at {:?}", teams_dir);
            return teams;
        }

        let mut entries = match tokio::fs::read_dir(&teams_dir).await {
            Ok(e) => e,
            Err(e) => {
                warn!("failed to read teams directory: {e}");
                return teams;
            }
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let config_path = path.join("config.json");
            if !config_path.exists() {
                continue;
            }

            match self.load_team_config(&config_path).await {
                Ok(team) => {
                    let _ = self.event_tx.send(TeamEvent::TeamDiscovered(team.clone()));
                    teams.push(team);
                }
                Err(e) => {
                    warn!("failed to load team config {:?}: {e}", config_path);
                }
            }
        }

        info!("discovered {} teams", teams.len());
        teams
    }

    async fn load_team_config(&self, config_path: &Path) -> anyhow::Result<DiscoveredTeam> {
        let content = tokio::fs::read_to_string(config_path).await?;
        let config: TeamConfig = serde_json::from_str(&content)?;

        // Check for corresponding task directory
        let task_dir = self.claude_dir.join("tasks").join(&config.name);
        let task_dir = if task_dir.exists() {
            Some(task_dir)
        } else {
            None
        };

        Ok(DiscoveredTeam {
            config,
            config_path: config_path.to_path_buf(),
            task_dir,
        })
    }

    /// Subscribe to team events
    pub fn subscribe(&self) -> broadcast::Receiver<TeamEvent> {
        self.event_tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn scan_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let (discovery, _rx) = TeamDiscovery::new(tmp.path());
        let teams = discovery.scan().await;
        assert!(teams.is_empty());
    }

    #[tokio::test]
    async fn load_tasks_reads_json_files() {
        let tmp = TempDir::new().unwrap();
        let task_dir = tmp.path().join("tasks");
        std::fs::create_dir_all(&task_dir).unwrap();

        // Create task files
        std::fs::write(
            task_dir.join("1.json"),
            r#"{"id":"1","subject":"First task","status":"completed","owner":"lead","blocks":[],"blockedBy":[]}"#,
        ).unwrap();
        std::fs::write(
            task_dir.join("2.json"),
            r#"{"id":"2","subject":"Second task","status":"in_progress","owner":"dev","activeForm":"Working on it","blocks":[],"blockedBy":["1"]}"#,
        ).unwrap();
        std::fs::write(
            task_dir.join("3.json"),
            r#"{"id":"3","subject":"Third task","status":"pending","blocks":["2"],"blockedBy":[]}"#,
        ).unwrap();
        // Non-JSON files should be skipped
        std::fs::write(task_dir.join(".lock"), "").unwrap();
        std::fs::write(task_dir.join(".highwatermark"), "3").unwrap();

        let tasks = super::load_tasks(&task_dir).await;
        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].id, "1");
        assert_eq!(tasks[0].subject, "First task");
        assert_eq!(tasks[0].status, "completed");
        assert_eq!(tasks[0].owner, Some("lead".to_string()));
        assert_eq!(tasks[1].id, "2");
        assert_eq!(tasks[1].active_form, Some("Working on it".to_string()));
        assert_eq!(tasks[1].blocked_by, vec!["1"]);
        assert_eq!(tasks[2].id, "3");
        assert_eq!(tasks[2].owner, None);
        assert_eq!(tasks[2].blocks, vec!["2"]);
        // All tasks should have modified_at set
        assert!(tasks.iter().all(|t| t.modified_at.is_some()));
    }

    #[tokio::test]
    async fn load_tasks_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let tasks = super::load_tasks(tmp.path()).await;
        assert!(tasks.is_empty());
    }

    #[tokio::test]
    async fn scan_discovers_team() {
        let tmp = TempDir::new().unwrap();
        let teams_dir = tmp.path().join("teams").join("my-project");
        std::fs::create_dir_all(&teams_dir).unwrap();

        let config = TeamConfig {
            name: "my-project".to_string(),
            description: Some("Test team".to_string()),
            members: vec![
                AgentInfo {
                    name: "lead".to_string(),
                    agent_id: "abc-123".to_string(),
                    agent_type: Some("general-purpose".to_string()),
                },
                AgentInfo {
                    name: "researcher".to_string(),
                    agent_id: "def-456".to_string(),
                    agent_type: Some("Explore".to_string()),
                },
            ],
            created_at: None,
        };
        let config_json = serde_json::to_string_pretty(&config).unwrap();
        std::fs::write(teams_dir.join("config.json"), config_json).unwrap();

        let (discovery, _rx) = TeamDiscovery::new(tmp.path());
        let teams = discovery.scan().await;

        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].config.name, "my-project");
        assert_eq!(teams[0].config.members.len(), 2);
        assert_eq!(teams[0].config.members[0].name, "lead");
    }
}
