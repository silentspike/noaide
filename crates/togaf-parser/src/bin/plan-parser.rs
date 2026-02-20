//! CLI entry point for plan-parser
//! Converts IMPL-PLAN.md -> plan.json
//!
//! Usage:
//!   plan-parser <input.md> [--output plan.json] [--watch] [--compact]

use std::fs;
use std::path::PathBuf;

use clap::Parser as ClapParser;

use togaf_parser::emitter;
use togaf_parser::parser;

#[derive(ClapParser)]
#[command(
    name = "plan-parser",
    about = "TOGAF IMPL-PLAN.md to plan.json converter"
)]
struct Cli {
    /// Input IMPL-PLAN.md file
    input: PathBuf,

    /// Output file (default: stdout)
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Compact JSON (no pretty-printing)
    #[arg(long, default_value_t = false)]
    compact: bool,

    /// Watch mode: re-parse on file changes (200ms debounce)
    #[cfg(feature = "watcher")]
    #[arg(short, long, default_value_t = false)]
    watch: bool,
}

fn main() {
    let cli = Cli::parse();

    // Initial parse
    if let Err(e) = run_parse(&cli) {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }

    // Watch mode
    #[cfg(feature = "watcher")]
    if cli.watch {
        if let Err(e) = run_watch(&cli) {
            eprintln!("Watch error: {}", e);
            std::process::exit(1);
        }
    }
}

fn run_parse(cli: &Cli) -> Result<(), Box<dyn std::error::Error>> {
    let markdown = fs::read_to_string(&cli.input)
        .map_err(|e| format!("Cannot read {}: {}", cli.input.display(), e))?;

    let doc = parser::parse(&markdown).map_err(|e| format!("Parse error: {}", e))?;

    let json = if cli.compact {
        emitter::to_json_compact(&doc)?
    } else {
        emitter::to_json(&doc)?
    };

    match &cli.output {
        Some(path) => {
            fs::write(path, &json)
                .map_err(|e| format!("Cannot write {}: {}", path.display(), e))?;
            eprintln!("Wrote {} ({} bytes)", path.display(), json.len());
        }
        None => {
            println!("{}", json);
        }
    }

    Ok(())
}

#[cfg(feature = "watcher")]
fn run_watch(cli: &Cli) -> Result<(), Box<dyn std::error::Error>> {
    use notify::{Event, EventKind, RecursiveMode, Watcher};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    eprintln!(
        "Watching {} for changes (200ms debounce)...",
        cli.input.display()
    );

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(&cli.input, RecursiveMode::NonRecursive)?;

    let debounce = Duration::from_millis(200);
    let mut last_parse = Instant::now() - debounce;

    loop {
        match rx.recv() {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    let now = Instant::now();
                    if now.duration_since(last_parse) >= debounce {
                        last_parse = now;
                        eprintln!("[{}] File changed, re-parsing...", chrono_now_simple());
                        if let Err(e) = run_parse(cli) {
                            eprintln!("Parse error: {}", e);
                        }
                    }
                }
            }
            Ok(Err(e)) => eprintln!("Watch error: {}", e),
            Err(e) => {
                eprintln!("Channel error: {}", e);
                break;
            }
        }
    }

    Ok(())
}

#[cfg(feature = "watcher")]
fn chrono_now_simple() -> String {
    use std::time::SystemTime;
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", secs)
}
