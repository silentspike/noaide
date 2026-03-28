use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let ebpf_target = out_dir.join("noaide-ebpf");

    // Look for pre-built eBPF binary from xtask
    let workspace_root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_path_buf();

    let candidates = [
        workspace_root.join("target/bpfel-unknown-none/release/noaide-ebpf"),
        workspace_root.join("target/bpfel-unknown-none/debug/noaide-ebpf"),
    ];

    let mut found = false;
    for candidate in &candidates {
        if candidate.exists() {
            fs::copy(candidate, &ebpf_target).expect("failed to copy eBPF binary");
            eprintln!("note: using eBPF binary from {}", candidate.display());
            found = true;
            break;
        }
    }

    if !found {
        // Create empty placeholder so include_bytes! doesn't fail at compile time.
        // At runtime the watcher factory will fall back to fanotify/inotify.
        fs::write(&ebpf_target, b"").expect("failed to create eBPF placeholder");
    }

    println!("cargo:rerun-if-changed=build.rs");
    for candidate in &candidates {
        println!("cargo:rerun-if-changed={}", candidate.display());
    }
}
