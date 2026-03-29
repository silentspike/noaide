pub mod discovery;
pub mod topology;

pub use discovery::{
    AgentInfo, DiscoveredTeam, InboxMessage, TaskFile, TeamConfig, TeamDiscovery, TeamEvent,
    load_inboxes, load_tasks,
};
pub use topology::{AgentNode, AgentStatus, MessageEdge, TeamTopology, TopologyBuilder};
