pub mod discovery;
pub mod topology;

pub use discovery::{
    AgentInfo, DiscoveredTeam, TaskFile, TeamConfig, TeamDiscovery, TeamEvent, load_tasks,
};
pub use topology::{AgentNode, AgentStatus, MessageEdge, TeamTopology, TopologyBuilder};
