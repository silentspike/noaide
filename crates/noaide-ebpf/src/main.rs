#![no_std]
#![no_main]

use aya_ebpf::{
    helpers::{bpf_get_current_pid_tgid, bpf_ktime_get_ns, bpf_probe_read_user_str_bytes},
    macros::{map, tracepoint},
    maps::RingBuf,
    programs::TracePointContext,
};
use noaide_common::{BpfFileEvent, OP_CREATE, OP_DELETE, OP_MODIFY};

/// Ring buffer for sending file events to userspace.
/// 256KB capacity = ~1000 events (each ~264 bytes).
#[map]
static EVENTS: RingBuf = RingBuf::with_byte_size(256 * 1024, 0);

/// Tracepoint: sys_enter_openat
///
/// Detects file creation when O_CREAT flag is set.
/// Args layout (from /sys/kernel/tracing/events/syscalls/sys_enter_openat/format):
///   field: int dfd;         offset:16; size:8
///   field: const char * filename;  offset:24; size:8
///   field: int flags;       offset:32; size:8
///   field: umode_t mode;    offset:40; size:8
#[tracepoint]
pub fn trace_openat(ctx: TracePointContext) -> u32 {
    match try_trace_openat(&ctx) {
        Ok(0) => 0,
        Ok(_) => 0,
        Err(_) => 1,
    }
}

fn try_trace_openat(ctx: &TracePointContext) -> Result<u32, i64> {
    // Read flags (offset 32)
    let flags: i64 = unsafe { ctx.read_at(32)? };

    // O_CREAT = 0x40 on x86_64
    const O_CREAT: i64 = 0x40;
    if flags & O_CREAT == 0 {
        return Ok(0); // Not a create operation
    }

    // Read filename pointer (offset 24)
    let filename_ptr: u64 = unsafe { ctx.read_at(24)? };

    let pid = (bpf_get_current_pid_tgid() & 0xFFFF_FFFF) as u32;
    let ts = unsafe { bpf_ktime_get_ns() };

    if let Some(mut buf) = EVENTS.reserve::<BpfFileEvent>(0) {
        let event = unsafe { &mut *buf.as_mut_ptr() };
        event.pid = pid;
        event.op = OP_CREATE;
        event.timestamp_ns = ts;
        event._pad = [0; 1];

        // Read filename from userspace
        let path_result = unsafe {
            bpf_probe_read_user_str_bytes(filename_ptr as *const u8, &mut event.path)
        };
        match path_result {
            Ok(path) => event.path_len = path.len() as u16,
            Err(_) => {
                event.path_len = 0;
                event.path[0] = 0;
            }
        }

        buf.submit(0);
    }

    Ok(0)
}

/// Tracepoint: sys_exit_write
///
/// Detects file modifications (successful write syscalls).
/// We use sys_exit_write to only capture successful writes (ret > 0).
/// Args layout (from /sys/kernel/tracing/events/syscalls/sys_exit_write/format):
///   field: long ret;  offset:16; size:8
///
/// Note: sys_exit_write does not carry the filename. We track the fd→path
/// mapping in userspace via /proc/self/fd/. The eBPF program only emits
/// the PID and a signal that a write occurred. Path resolution happens
/// in the userspace loader.
#[tracepoint]
pub fn trace_write(ctx: TracePointContext) -> u32 {
    match try_trace_write(&ctx) {
        Ok(0) => 0,
        Ok(_) => 0,
        Err(_) => 1,
    }
}

fn try_trace_write(ctx: &TracePointContext) -> Result<u32, i64> {
    // Read return value (offset 16)
    let ret: i64 = unsafe { ctx.read_at(16)? };
    if ret <= 0 {
        return Ok(0); // Failed or zero-byte write
    }

    let pid = (bpf_get_current_pid_tgid() & 0xFFFF_FFFF) as u32;
    let ts = unsafe { bpf_ktime_get_ns() };

    if let Some(mut buf) = EVENTS.reserve::<BpfFileEvent>(0) {
        let event = unsafe { &mut *buf.as_mut_ptr() };
        event.pid = pid;
        event.op = OP_MODIFY;
        event.timestamp_ns = ts;
        event._pad = [0; 1];
        event.path_len = 0;
        event.path[0] = 0; // Path resolved in userspace

        buf.submit(0);
    }

    Ok(0)
}

/// Tracepoint: sys_enter_unlinkat
///
/// Detects file deletion.
/// Args layout (from /sys/kernel/tracing/events/syscalls/sys_enter_unlinkat/format):
///   field: int dfd;                offset:16; size:8
///   field: const char * pathname;  offset:24; size:8
///   field: int flag;               offset:32; size:8
#[tracepoint]
pub fn trace_unlinkat(ctx: TracePointContext) -> u32 {
    match try_trace_unlinkat(&ctx) {
        Ok(0) => 0,
        Ok(_) => 0,
        Err(_) => 1,
    }
}

fn try_trace_unlinkat(ctx: &TracePointContext) -> Result<u32, i64> {
    let pathname_ptr: u64 = unsafe { ctx.read_at(24)? };

    let pid = (bpf_get_current_pid_tgid() & 0xFFFF_FFFF) as u32;
    let ts = unsafe { bpf_ktime_get_ns() };

    if let Some(mut buf) = EVENTS.reserve::<BpfFileEvent>(0) {
        let event = unsafe { &mut *buf.as_mut_ptr() };
        event.pid = pid;
        event.op = OP_DELETE;
        event.timestamp_ns = ts;
        event._pad = [0; 1];

        let path_result = unsafe {
            bpf_probe_read_user_str_bytes(pathname_ptr as *const u8, &mut event.path)
        };
        match path_result {
            Ok(path) => event.path_len = path.len() as u16,
            Err(_) => {
                event.path_len = 0;
                event.path[0] = 0;
            }
        }

        buf.submit(0);
    }

    Ok(0)
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}
