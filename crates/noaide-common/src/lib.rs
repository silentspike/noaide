#![no_std]

/// File operation types emitted by the eBPF program.
pub const OP_CREATE: u8 = 1;
pub const OP_MODIFY: u8 = 2;
pub const OP_DELETE: u8 = 3;

/// Maximum path length tracked by the eBPF program.
pub const MAX_PATH_LEN: usize = 256;

/// File event shared between kernel eBPF program and userspace loader.
///
/// This struct is `#[repr(C)]` to ensure consistent memory layout across
/// the BPF and native compilation targets.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct BpfFileEvent {
    /// PID of the process that triggered the file operation.
    pub pid: u32,
    /// File operation type (OP_CREATE, OP_MODIFY, OP_DELETE).
    pub op: u8,
    /// Padding for alignment.
    pub _pad: [u8; 1],
    /// Length of the path string in `path`.
    pub path_len: u16,
    /// Null-terminated path (up to MAX_PATH_LEN bytes).
    pub path: [u8; MAX_PATH_LEN],
    /// Kernel timestamp in nanoseconds (from bpf_ktime_get_ns).
    pub timestamp_ns: u64,
}

#[cfg(feature = "std")]
unsafe impl Send for BpfFileEvent {}
#[cfg(feature = "std")]
unsafe impl Sync for BpfFileEvent {}
