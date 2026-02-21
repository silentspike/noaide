use std::collections::HashMap;

use serde::Serialize;

use super::discovery::AgentInfo;

/// A node in the agent topology graph
#[derive(Debug, Clone, Serialize)]
pub struct AgentNode {
    pub name: String,
    pub agent_id: String,
    pub agent_type: Option<String>,
    pub is_leader: bool,
    pub children: Vec<String>,
    pub message_count: u64,
    pub status: AgentStatus,
}

/// Agent activity status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Active,
    Idle,
    Shutdown,
    Unknown,
}

/// A message edge between two agents
#[derive(Debug, Clone, Serialize)]
pub struct MessageEdge {
    pub from: String,
    pub to: String,
    pub message_type: String,
    pub timestamp: u64,
    pub summary: Option<String>,
}

/// The complete team topology
#[derive(Debug, Clone, Serialize)]
pub struct TeamTopology {
    pub team_name: String,
    pub nodes: Vec<AgentNode>,
    pub edges: Vec<MessageEdge>,
}

/// Builds an agent topology from team members and their interactions
pub struct TopologyBuilder {
    nodes: HashMap<String, AgentNode>,
    edges: Vec<MessageEdge>,
    team_name: String,
}

impl TopologyBuilder {
    pub fn new(team_name: &str) -> Self {
        Self {
            nodes: HashMap::new(),
            edges: Vec::new(),
            team_name: team_name.to_string(),
        }
    }

    /// Add agents from a team config
    pub fn add_members(&mut self, members: &[AgentInfo]) {
        for (i, member) in members.iter().enumerate() {
            let node = AgentNode {
                name: member.name.clone(),
                agent_id: member.agent_id.clone(),
                agent_type: member.agent_type.clone(),
                is_leader: i == 0, // First member is typically the leader
                children: Vec::new(),
                message_count: 0,
                status: AgentStatus::Unknown,
            };
            self.nodes.insert(member.name.clone(), node);
        }

        // First member is leader, others are children
        if members.len() > 1 {
            let leader_name = members[0].name.clone();
            let child_names: Vec<String> = members[1..].iter().map(|m| m.name.clone()).collect();
            if let Some(leader) = self.nodes.get_mut(&leader_name) {
                leader.children = child_names;
            }
        }
    }

    /// Record a message between agents
    pub fn add_message(&mut self, from: &str, to: &str, msg_type: &str, summary: Option<String>) {
        // Increment message counts
        if let Some(node) = self.nodes.get_mut(from) {
            node.message_count += 1;
        }
        if let Some(node) = self.nodes.get_mut(to) {
            node.message_count += 1;
        }

        self.edges.push(MessageEdge {
            from: from.to_string(),
            to: to.to_string(),
            message_type: msg_type.to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            summary,
        });
    }

    /// Update an agent's status
    pub fn set_status(&mut self, agent_name: &str, status: AgentStatus) {
        if let Some(node) = self.nodes.get_mut(agent_name) {
            node.status = status;
        }
    }

    /// Build the final topology
    pub fn build(self) -> TeamTopology {
        let mut nodes: Vec<AgentNode> = self.nodes.into_values().collect();
        // Sort: leader first, then alphabetical
        nodes.sort_by(|a, b| b.is_leader.cmp(&a.is_leader).then(a.name.cmp(&b.name)));

        TeamTopology {
            team_name: self.team_name,
            nodes,
            edges: self.edges,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_topology_from_members() {
        let mut builder = TopologyBuilder::new("test-team");
        builder.add_members(&[
            AgentInfo {
                name: "lead".to_string(),
                agent_id: "id1".to_string(),
                agent_type: Some("general-purpose".to_string()),
            },
            AgentInfo {
                name: "worker-a".to_string(),
                agent_id: "id2".to_string(),
                agent_type: Some("Bash".to_string()),
            },
            AgentInfo {
                name: "worker-b".to_string(),
                agent_id: "id3".to_string(),
                agent_type: Some("Explore".to_string()),
            },
        ]);

        builder.add_message("lead", "worker-a", "message", Some("start task".into()));
        builder.set_status("lead", AgentStatus::Active);
        builder.set_status("worker-a", AgentStatus::Active);

        let topology = builder.build();
        assert_eq!(topology.team_name, "test-team");
        assert_eq!(topology.nodes.len(), 3);
        assert!(topology.nodes[0].is_leader);
        assert_eq!(topology.nodes[0].name, "lead");
        assert_eq!(topology.nodes[0].children.len(), 2);
        assert_eq!(topology.edges.len(), 1);
    }
}
