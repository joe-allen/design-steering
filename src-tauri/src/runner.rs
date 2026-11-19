use crate::node::{self, hide_window};
use crate::runs;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

const FETCH_SCRIPT: &str = "_1-fetch-figma-comments.mjs";
const GENERATE_SCRIPT: &str = "_2-generate-design-critique.mjs";
const ERROR_TAIL_LINES: usize = 8;

/// Deliberately not `Debug`, so the token cannot end up in a log by accident.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct RunSettings {
    pub token: String,
    pub page_url: String,
    pub run_name: String,
    pub images: bool,
    pub user: bool,
    pub node_path: String,
}

impl Default for RunSettings {
    fn default() -> Self {
        Self {
            token: String::new(),
            page_url: String::new(),
            run_name: String::new(),
            images: true,
            user: false,
            node_path: String::new(),
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    Step { step: String },
    Log { line: String },
}

pub struct RunPlan {
    pub node: PathBuf,
    pub scripts_dir: PathBuf,
    pub runs_dir: PathBuf,
}

/// Allows one run at a time; releases on drop.
pub struct RunGuard<'a>(&'a AtomicBool);

impl<'a> RunGuard<'a> {
    pub fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Self(flag))
    }
}

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Runs `job` only while no run is in progress, and blocks a run from starting until it is done.
/// Deleting must not remove a folder that a run is still writing.
pub fn when_idle<T>(
    flag: &AtomicBool,
    job: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard =
        RunGuard::acquire(flag).ok_or("A run is in progress. Try again when it has finished.")?;
    job()
}

pub fn validate(settings: &RunSettings) -> Result<(), String> {
    if settings.token.trim().is_empty() {
        return Err("The Figma token is missing. Add it in Settings.".into());
    }
    if settings.page_url.trim().is_empty() {
        return Err("The Figma page URL is missing. Add it in Settings.".into());
    }
    Ok(())
}

pub fn redact(line: &str, token: &str) -> String {
    if token.is_empty() {
        line.to_string()
    } else {
        line.replace(token, "***")
    }
}

fn read_lines(reader: impl Read, mut on_line: impl FnMut(String)) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(_) => on_line(String::from_utf8_lossy(&buffer).trim_end().to_string()),
        }
    }
}

/// Runs one script to completion, streaming its output lines (redacted) as they arrive.
/// Returns the raw stdout lines. The token only ever travels in the child's environment.
fn run_script(
    node: &Path,
    args: &[String],
    token: Option<&str>,
    redact_token: &str,
    emit: &(dyn Fn(RunEvent) + Send + Sync),
) -> Result<Vec<String>, String> {
    let mut command = Command::new(node);
    command
        .args(args)
        .env_remove("FIGMA_TOKEN")
        .env_remove("FIGMA_PAGE_URL")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(token) = token {
        command.env("FIGMA_TOKEN", token);
    }
    hide_window(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Node ({}): {error}", node.display()))?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    let (stdout_lines, stderr_lines) = std::thread::scope(|scope| {
        let out = scope.spawn(|| {
            let mut lines = Vec::new();
            read_lines(stdout, |line| {
                emit(RunEvent::Log {
                    line: redact(&line, redact_token),
                });
                lines.push(line);
            });
            lines
        });
        let err = scope.spawn(|| {
            let mut lines = Vec::new();
            read_lines(stderr, |line| {
                let line = redact(&line, redact_token);
                emit(RunEvent::Log { line: line.clone() });
                lines.push(line);
            });
            lines
        });
        (
            out.join().unwrap_or_default(),
            err.join().unwrap_or_default(),
        )
    });

    let status = child
        .wait()
        .map_err(|error| format!("Could not wait for Node: {error}"))?;
    if status.success() {
        return Ok(stdout_lines);
    }

    let non_empty: Vec<&String> = stderr_lines
        .iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let tail: Vec<&str> = non_empty
        .iter()
        .skip(non_empty.len().saturating_sub(ERROR_TAIL_LINES))
        .map(|line| line.as_str())
        .collect();
    Err(if tail.is_empty() {
        format!("The script exited with {status}.")
    } else {
        tail.join("\n")
    })
}

/// Fetches the comments, then generates the markdown for the folder fetch reported.
/// Returns the run folder name. A failed fetch never starts generate.
pub fn execute_run(
    plan: &RunPlan,
    settings: &RunSettings,
    emit: &(dyn Fn(RunEvent) + Send + Sync),
) -> Result<String, String> {
    let script = |name: &str| plan.scripts_dir.join(name).display().to_string();
    let token = settings.token.trim();

    emit(RunEvent::Step {
        step: "fetch".into(),
    });
    let mut fetch_args = vec![
        script(FETCH_SCRIPT),
        settings.page_url.trim().to_string(),
        format!("--images={}", settings.images),
        format!("--out={}", plan.runs_dir.display()),
        "--print-run-dir".to_string(),
    ];
    if !settings.run_name.trim().is_empty() {
        fetch_args.push(format!("--name={}", settings.run_name.trim()));
    }
    let stdout = run_script(&plan.node, &fetch_args, Some(token), token, emit)?;

    let reported = stdout
        .iter()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| PathBuf::from(line.trim()))
        .ok_or("The fetch script did not report a run folder.")?;
    let id = reported
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or("The fetch script reported an unexpected run folder.")?;
    let run_dir = runs::resolve_run(&plan.runs_dir, &id).map_err(|_| {
        "The fetch script reported a run folder outside the runs folder.".to_string()
    })?;
    runs::write_source(
        &run_dir,
        &runs::RunSource {
            page_url: settings.page_url.trim().to_string(),
            run_name: settings.run_name.trim().to_string(),
        },
    )?;

    emit(RunEvent::Step {
        step: "generate".into(),
    });
    let generate_args = vec![
        script(GENERATE_SCRIPT),
        run_dir.display().to_string(),
        format!("--user={}", settings.user),
    ];
    run_script(&plan.node, &generate_args, None, token, emit)?;
    Ok(id)
}

pub fn scripts_dir(bundled: &Path) -> Result<PathBuf, String> {
    let bundled = dunce::simplified(bundled).to_path_buf();
    if bundled.join(FETCH_SCRIPT).is_file() {
        return Ok(bundled);
    }
    // `tauri dev` runs from the repo, where the scripts and their node_modules already exist.
    #[cfg(debug_assertions)]
    {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        if repo.join(FETCH_SCRIPT).is_file() {
            return dunce::canonicalize(repo).map_err(|error| error.to_string());
        }
    }
    Err("The bundled scripts were not found. Reinstall Design Steering.".into())
}

pub fn build_plan(
    settings: &RunSettings,
    bundled_scripts: &Path,
    runs_dir: &Path,
) -> Result<RunPlan, String> {
    validate(settings)?;
    let node = node::detect(Some(settings.node_path.as_str()))?;
    std::fs::create_dir_all(runs_dir)
        .map_err(|error| format!("Could not create the runs folder: {error}"))?;
    Ok(RunPlan {
        node: PathBuf::from(node.path),
        scripts_dir: scripts_dir(bundled_scripts)?,
        runs_dir: dunce::canonicalize(runs_dir).map_err(|error| error.to_string())?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;

    const TOKEN: &str = "figd_super-secret-token";

    fn node_available() -> bool {
        Command::new("node")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ds-run-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Stand-ins for the real scripts: same contract (--out, --print-run-dir, run folder argument).
    const FETCH_STUB: &str = r#"
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv.find((a) => a.startsWith('--out=')).slice(6);
const dir = join(out, 'stub-design-critique');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'argv.json'), JSON.stringify(process.argv));
writeFileSync(join(dir, 'env-token.txt'), process.env.FIGMA_TOKEN ?? '');
if (process.argv[2].includes('blockrecord')) mkdirSync(join(dir, 'source.json'));
if (process.argv[2].includes('fail')) {
  console.error('Figma returned 403: the token is invalid, expired, or missing a required scope.');
  process.exit(1);
}
console.error('Page: "Stub" using ' + process.env.FIGMA_TOKEN);
console.log('Wrote ' + dir + ' (1 comments across 1 frames)');
console.log(dir);
"#;

    const GENERATE_STUB: &str = r#"
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const dir = process.argv[2];
writeFileSync(join(dir, basename(dir) + '.md'), '# Design critique ' + process.argv.slice(3).join(' '));
console.log('Wrote it');
"#;

    fn plan(label: &str) -> (RunPlan, PathBuf) {
        let root = temp_dir(label);
        let scripts = root.join("scripts");
        fs::create_dir_all(&scripts).unwrap();
        fs::write(scripts.join(FETCH_SCRIPT), FETCH_STUB).unwrap();
        fs::write(scripts.join(GENERATE_SCRIPT), GENERATE_STUB).unwrap();
        let runs_dir = root.join("runs");
        fs::create_dir_all(&runs_dir).unwrap();
        let plan = RunPlan {
            node: PathBuf::from("node"),
            scripts_dir: scripts,
            runs_dir: dunce::canonicalize(runs_dir).unwrap(),
        };
        (plan, root)
    }

    fn settings(url: &str) -> RunSettings {
        RunSettings {
            token: TOKEN.into(),
            page_url: url.into(),
            ..RunSettings::default()
        }
    }

    #[test]
    fn redacts_the_token_wherever_it_appears() {
        assert_eq!(
            redact(&format!("using {TOKEN} now"), TOKEN),
            "using *** now"
        );
        assert_eq!(redact("nothing here", TOKEN), "nothing here");
        assert_eq!(redact("keep", ""), "keep");
    }

    #[test]
    fn missing_token_or_url_blocks_the_run_with_a_pointer_to_settings() {
        let no_token = RunSettings {
            page_url: "https://x".into(),
            ..RunSettings::default()
        };
        let error = validate(&no_token).unwrap_err();
        assert!(
            error.contains("token is missing") && error.contains("Settings"),
            "{error}"
        );
        let no_url = RunSettings {
            token: TOKEN.into(),
            ..RunSettings::default()
        };
        assert!(validate(&no_url)
            .unwrap_err()
            .contains("page URL is missing"));
        assert!(validate(&settings("https://x")).is_ok());
    }

    #[test]
    fn only_one_run_at_a_time() {
        let flag = AtomicBool::new(false);
        let first = RunGuard::acquire(&flag).expect("first run starts");
        assert!(
            RunGuard::acquire(&flag).is_none(),
            "second run must be rejected"
        );
        drop(first);
        assert!(
            RunGuard::acquire(&flag).is_some(),
            "guard releases when the run ends"
        );
    }

    #[test]
    fn successful_run_streams_redacted_output_and_keeps_the_token_off_the_command_line() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("ok");
        let events = Mutex::new(Vec::new());
        let emit = |event: RunEvent| events.lock().unwrap().push(event);

        let id = execute_run(&plan, &settings("https://figma.test/ok"), &emit).unwrap();
        assert_eq!(id, "stub-design-critique");

        let run_dir = plan.runs_dir.join(&id);
        assert!(run_dir.join("stub-design-critique.md").is_file());
        assert_eq!(
            fs::read_to_string(run_dir.join("env-token.txt")).unwrap(),
            TOKEN
        );
        let argv = fs::read_to_string(run_dir.join("argv.json")).unwrap();
        assert!(!argv.contains(TOKEN), "token must not be in argv: {argv}");
        assert!(argv.contains("--print-run-dir") && argv.contains("--images=true"));
        let md = fs::read_to_string(run_dir.join("stub-design-critique.md")).unwrap();
        assert!(md.contains("--user=false"));

        let events = events.into_inner().unwrap();
        let text = serde_json::to_string(&events).unwrap();
        assert!(!text.contains(TOKEN), "token leaked into streamed events");
        assert!(text.contains("Page: \\\"Stub\\\" using ***"));
        assert_eq!(
            events
                .iter()
                .filter_map(|e| match e {
                    RunEvent::Step { step } => Some(step.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            ["fetch", "generate"]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_run_records_its_page_and_trimmed_name_but_never_the_token() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("record");
        let run_settings = RunSettings {
            run_name: "  checkout ".into(),
            ..settings("  https://figma.test/ok?node-id=1-1 ")
        };
        let id = execute_run(&plan, &run_settings, &|_| {}).unwrap();
        let record = fs::read_to_string(plan.runs_dir.join(&id).join(runs::SOURCE_FILE)).unwrap();
        assert!(!record.contains(TOKEN), "{record}");
        let content = runs::read_run_in(&plan.runs_dir, &id).unwrap();
        assert_eq!(
            content.source,
            Some(runs::RunSource {
                page_url: "https://figma.test/ok?node-id=1-1".into(),
                run_name: "checkout".into()
            })
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_run_without_a_name_records_an_empty_name() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("record-noname");
        let id = execute_run(&plan, &settings("https://figma.test/ok"), &|_| {}).unwrap();
        assert_eq!(
            runs::read_run_in(&plan.runs_dir, &id)
                .unwrap()
                .source
                .unwrap()
                .run_name,
            ""
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_record_that_cannot_be_written_fails_the_run_and_it_never_reaches_history() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("record-fail");
        let error =
            execute_run(&plan, &settings("https://figma.test/blockrecord"), &|_| {}).unwrap_err();
        assert!(error.contains("Could not record the page"), "{error}");
        assert!(!plan
            .runs_dir
            .join("stub-design-critique/stub-design-critique.md")
            .exists());
        assert!(runs::list_runs_in(&plan.runs_dir).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deleting_is_refused_while_a_run_is_in_progress() {
        let flag = AtomicBool::new(false);
        let mut ran = false;
        let held = RunGuard::acquire(&flag).unwrap();
        let refused = when_idle(&flag, || {
            ran = true;
            Ok(())
        });
        assert!(refused.unwrap_err().contains("in progress"));
        assert!(!ran, "the job must not run while a run is in progress");
        drop(held);
        assert!(when_idle(&flag, || Ok(5)).is_ok());
        assert!(
            RunGuard::acquire(&flag).is_some(),
            "the flag is released afterwards"
        );
    }

    #[test]
    fn failed_fetch_skips_generate_and_reports_the_script_message() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("fail");
        let error = execute_run(&plan, &settings("https://figma.test/fail"), &|_| {}).unwrap_err();
        assert!(error.contains("Figma returned 403"), "{error}");
        assert!(!plan
            .runs_dir
            .join("stub-design-critique/stub-design-critique.md")
            .exists());
        assert!(
            runs::list_runs_in(&plan.runs_dir).is_empty(),
            "failed run must not reach History"
        );
        let _ = fs::remove_dir_all(root);
    }
}
