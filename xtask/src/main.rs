use std::process::Command;

use clap::Parser;

#[derive(Parser)]
enum Cli {
    /// Build the eBPF programs using nightly Rust.
    BuildEbpf {
        /// Build in release mode.
        #[arg(long)]
        release: bool,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli {
        Cli::BuildEbpf { release } => build_ebpf(release),
    }
}

fn build_ebpf(release: bool) {
    let ebpf_dir = workspace_root().join("crates/noaide-ebpf");

    let mut cmd = Command::new("cargo");
    cmd.current_dir(&ebpf_dir)
        .args(["+nightly", "build"])
        .args(["--target", "bpfel-unknown-none"])
        .args(["-Z", "build-std=core"]);

    // Use workspace target dir so build.rs can find the binary
    let target_dir = workspace_root().join("target");
    cmd.arg("--target-dir").arg(&target_dir);

    if release {
        cmd.arg("--release");
    }

    let status = cmd.status().expect("failed to run cargo +nightly");
    if !status.success() {
        eprintln!("eBPF build failed with status: {status}");
        std::process::exit(1);
    }

    let profile = if release { "release" } else { "debug" };
    let output = target_dir
        .join("bpfel-unknown-none")
        .join(profile)
        .join("noaide-ebpf");

    if output.exists() {
        eprintln!("eBPF binary built: {}", output.display());
    } else {
        eprintln!("Warning: expected output not found at {}", output.display());
    }
}

fn workspace_root() -> std::path::PathBuf {
    let output = Command::new("cargo")
        .args(["metadata", "--no-deps", "--format-version", "1"])
        .output()
        .expect("failed to get cargo metadata");

    let metadata: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse cargo metadata");

    std::path::PathBuf::from(metadata["workspace_root"].as_str().unwrap())
}
