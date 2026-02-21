use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::{info, warn};

/// Information about a single team member/agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    #[serde(rename = "agentId")]
    pub agent_id: String,
    #[serde(rename = "agentType")]
    pub agent_type: Option<String>,
}

/// A team configuration as stored in ~/.claude/teams/
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamConfig {
    pub team_name: String,
    pub description: Option<String>,
    pub members: Vec<AgentInfo>,
    pub created_at: Option<String>,
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
        let task_dir = self.claude_dir.join("tasks").join(&config.team_name);
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
    async fn scan_discovers_team() {
        let tmp = TempDir::new().unwrap();
        let teams_dir = tmp.path().join("teams").join("my-project");
        std::fs::create_dir_all(&teams_dir).unwrap();

        let config = TeamConfig {
            team_name: "my-project".to_string(),
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
        assert_eq!(teams[0].config.team_name, "my-project");
        assert_eq!(teams[0].config.members.len(), 2);
        assert_eq!(teams[0].config.members[0].name, "lead");
    }
}
