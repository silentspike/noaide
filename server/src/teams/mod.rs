pub mod discovery;
pub mod topology;

pub use discovery::{AgentInfo, DiscoveredTeam, TeamConfig, TeamDiscovery, TeamEvent};
pub use topology::{AgentNode, AgentStatus, MessageEdge, TeamTopology, TopologyBuilder};
