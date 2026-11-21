use crate::node::{self, hide_window};
use crate::outbox::{self, ActionStatus, AppLock};
use crate::runs;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

const FETCH_SCRIPT: &str = "_1-fetch-figma-comments.mjs";
const GENERATE_SCRIPT: &str = "_2-generate-design-critique.mjs";
const PUSH_SCRIPT: &str = "_3-push-figma-comments.mjs";
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

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PushSettings {
    pub token: String,
    pub node_path: String,
}

pub struct PushPlan {
    pub node: PathBuf,
    pub scripts_dir: PathBuf,
    pub runs_dir: PathBuf,
    pub app_data: PathBuf,
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

fn select_scripts_dir(bundled: &Path, development: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(repo) = development {
        if [FETCH_SCRIPT, GENERATE_SCRIPT, PUSH_SCRIPT]
            .iter()
            .all(|script| repo.join(script).is_file())
        {
            return dunce::canonicalize(repo).map_err(|error| error.to_string());
        }
    }
    let bundled = dunce::simplified(bundled).to_path_buf();
    if bundled.join(FETCH_SCRIPT).is_file() {
        return Ok(bundled);
    }
    Err("The bundled scripts were not found. Reinstall Design Steering.".into())
}

pub fn scripts_dir(bundled: &Path) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        select_scripts_dir(bundled, Some(&repo))
    }
    #[cfg(not(debug_assertions))]
    {
        select_scripts_dir(bundled, None)
    }
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

pub fn build_push_plan(
    settings: &PushSettings,
    bundled_scripts: &Path,
    runs_dir: &Path,
    app_data: &Path,
) -> Result<PushPlan, String> {
    if settings.token.trim().is_empty() {
        return Err("The Figma token is missing. Add it in Settings.".into());
    }
    let node = node::detect(Some(settings.node_path.as_str()))?;
    Ok(PushPlan {
        node: PathBuf::from(node.path),
        scripts_dir: scripts_dir(bundled_scripts)?,
        runs_dir: runs_dir.to_path_buf(),
        app_data: app_data.to_path_buf(),
    })
}

fn redact_push(line: &str, token: &str, replies: &[String]) -> String {
    let mut result = redact(line, token);
    for reply in replies {
        for part in reply.lines().filter(|part| !part.is_empty()) {
            result = result.replace(part, "***");
        }
    }
    result
}

pub fn execute_push(
    plan: &PushPlan,
    id: &str,
    reviewed_revision: u64,
    token: &str,
    emit: &(dyn Fn(RunEvent) + Send + Sync),
) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("The Figma token is missing. Add it in Settings.".into());
    }
    let lock = AppLock::acquire(&plan.app_data)?;
    let outbox = outbox::read(&plan.runs_dir, id)?;
    outbox::check_revision(&outbox, reviewed_revision)?;
    if !outbox.actions.iter().any(|action| {
        matches!(
            action.status,
            ActionStatus::Pending | ActionStatus::Rejected
        )
    }) {
        return Err("There are no reviewed actions ready to push.".into());
    }
    let run_dir = outbox::resolve_writable_run(&plan.runs_dir, id)?;
    let script = plan.scripts_dir.join(PUSH_SCRIPT);
    if !script.is_file() {
        return Err("The bundled push script was not found. Reinstall Design Steering.".into());
    }
    let replies: Vec<String> = outbox
        .actions
        .iter()
        .filter_map(|action| action.text.clone())
        .collect();
    let mut command = Command::new(&plan.node);
    command
        .arg(&script)
        .arg(&run_dir)
        .arg(reviewed_revision.to_string())
        .env_remove("FIGMA_TOKEN")
        .env_remove("FIGMA_PAGE_URL")
        .env_remove("NODE_OPTIONS")
        .env("FIGMA_TOKEN", token)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(lock.child_handle()?))
        .stderr(Stdio::piped());
    hide_window(&mut command);
    emit(RunEvent::Step {
        step: "push".into(),
    });
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the push worker: {error}"))?;
    let control = child.stdin.take().expect("stdin is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let mut reader = BufReader::new(stderr);
    let mut buffer = Vec::new();
    let mut lines = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => break,
            Ok(_) => {
                let raw = String::from_utf8_lossy(&buffer);
                let line = redact_push(raw.trim_end(), token, &replies);
                emit(RunEvent::Log { line: line.clone() });
                lines.push(line);
            }
            Err(error) => {
                drop(control);
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not read push progress: {error}. Check Figma before retrying an in-flight action."));
            }
        }
    }
    let status = child
        .wait()
        .map_err(|error| format!("Could not wait for the push worker: {error}"))?;
    drop(control);
    if status.success() {
        return Ok(());
    }
    let non_empty: Vec<&String> = lines
        .iter()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let tail: Vec<&str> = non_empty
        .iter()
        .skip(non_empty.len().saturating_sub(ERROR_TAIL_LINES))
        .map(|line| line.as_str())
        .collect();
    Err(if tail.is_empty() {
        format!("The push worker exited with {status}. Check Figma before retrying an in-flight action.")
    } else {
        tail.join("\n")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

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
    fn development_uses_current_scripts_and_installed_apps_use_bundled_scripts() {
        let root = temp_dir("script-discovery");
        let dev = root.join("repo");
        let bundled = root.join("bundled");
        fs::create_dir_all(&dev).unwrap();
        fs::create_dir_all(&bundled).unwrap();
        for script in [FETCH_SCRIPT, GENERATE_SCRIPT, PUSH_SCRIPT] {
            fs::write(dev.join(script), "").unwrap();
            fs::write(bundled.join(script), "").unwrap();
        }
        assert_eq!(
            select_scripts_dir(&bundled, Some(&dev)).unwrap(),
            dunce::canonicalize(&dev).unwrap()
        );
        assert_eq!(select_scripts_dir(&bundled, None).unwrap(), bundled);
        fs::remove_file(dev.join(PUSH_SCRIPT)).unwrap();
        assert_eq!(select_scripts_dir(&bundled, Some(&dev)).unwrap(), bundled);
        fs::remove_file(bundled.join(FETCH_SCRIPT)).unwrap();
        assert!(select_scripts_dir(&bundled, None).is_err());
        let _ = fs::remove_dir_all(root);
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

    fn push_plan(label: &str) -> (PushPlan, PathBuf, String) {
        let root = temp_dir(label);
        let app_data = root.join("app-data");
        let runs_dir = app_data.join("runs");
        let id = "checkout-design-critique".to_string();
        let run_dir = runs_dir.join(&id);
        let scripts_dir = root.join("scripts");
        fs::create_dir_all(&run_dir).unwrap();
        fs::create_dir_all(&scripts_dir).unwrap();
        fs::write(run_dir.join(format!("{id}.md")), "# Critique").unwrap();
        runs::write_source(
            &run_dir,
            &runs::RunSource {
                page_url: "https://www.figma.com/design/FILE/branch/BRANCH/page?node-id=1-1".into(),
                run_name: "checkout".into(),
            },
        )
        .unwrap();
        fs::write(
            run_dir.join("checkout-figma-comments.json"),
            serde_json::to_vec(&json!([
                {"file_key":"BRANCH", "id":"root-1", "parent_id":null,
                 "has_done_reaction":false, "frame":"Home", "comment_thread":"1",
                 "message":"Feedback", "user":"ada"},
                {"file_key":"BRANCH", "id":"root-2", "parent_id":null,
                 "has_done_reaction":false, "frame":"Home", "comment_thread":"2",
                 "message":"More feedback", "user":"ada"}
            ]))
            .unwrap(),
        )
        .unwrap();
        outbox::queue_reply(&runs_dir, &id, 0, "root-1", "Private reply").unwrap();
        (
            PushPlan {
                node: PathBuf::from("node"),
                scripts_dir,
                runs_dir,
                app_data,
            },
            root,
            id,
        )
    }

    fn write_stubbed_worker(plan: &PushPlan, root: &Path, scenario: serde_json::Value) {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let stub = tauri::Url::from_file_path(repo.join("tests/stub-push-figma.mjs"))
            .unwrap()
            .to_string();
        let worker = tauri::Url::from_file_path(repo.join(PUSH_SCRIPT))
            .unwrap()
            .to_string();
        let scenario_path = root.join("scenario.json");
        let request_path = root.join("requests.jsonl");
        fs::write(&scenario_path, serde_json::to_vec(&scenario).unwrap()).unwrap();
        fs::write(&request_path, "").unwrap();
        let script = format!(
            "process.env.PUSH_STUB_SCENARIO = {};\n\
             process.env.PUSH_STUB_REQUESTS = {};\n\
             await import({});\n\
             await import({});\n",
            serde_json::to_string(&scenario_path.to_string_lossy()).unwrap(),
            serde_json::to_string(&request_path.to_string_lossy()).unwrap(),
            serde_json::to_string(&stub).unwrap(),
            serde_json::to_string(&worker).unwrap(),
        );
        fs::write(plan.scripts_dir.join(PUSH_SCRIPT), script).unwrap();
    }

    #[test]
    fn push_uses_environment_only_and_redacts_token_and_reply_output() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root, id) = push_plan("push-redaction");
        fs::write(
            plan.scripts_dir.join(PUSH_SCRIPT),
            r#"
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const reply = JSON.parse(readFileSync(join(process.argv[2], 'outbox.json'))).actions[0].text;
if (!process.env.FIGMA_TOKEN || process.argv.join(' ').includes(process.env.FIGMA_TOKEN)
    || process.argv.join(' ').includes(reply)) process.exit(2);
console.error('token=' + process.env.FIGMA_TOKEN);
console.error('reply=' + reply);
process.exit(1);
"#,
        )
        .unwrap();
        let events = Mutex::new(Vec::new());
        let error = execute_push(&plan, &id, 1, TOKEN, &|event| {
            events.lock().unwrap().push(event);
        })
        .unwrap_err();
        let logs = serde_json::to_string(&events.into_inner().unwrap()).unwrap();
        assert!(error.contains("***"));
        assert!(!error.contains(TOKEN) && !error.contains("Private reply"));
        assert!(!logs.contains(TOKEN) && !logs.contains("Private reply"));
        assert_eq!(fs::read(plan.app_data.join("outbox.lock")).unwrap(), b"");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn push_parent_process() {
        let Ok(root) = std::env::var("DESIGN_STEERING_TEST_PUSH_PARENT") else {
            return;
        };
        let root = PathBuf::from(root);
        let plan = PushPlan {
            node: PathBuf::from("node"),
            scripts_dir: root.join("scripts"),
            runs_dir: root.join("app-data/runs"),
            app_data: root.join("app-data"),
        };
        execute_push(&plan, "checkout-design-critique", 2, TOKEN, &|_| {}).unwrap();
    }

    #[test]
    fn competing_push_and_parent_exit_keep_the_inflight_reply_protected() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root, id) = push_plan("push-parent");
        outbox::queue_reply(&plan.runs_dir, &id, 1, "root-2", "Later reply").unwrap();
        write_stubbed_worker(
            &plan,
            &root,
            json!({
                "comments": [
                    {"id":"root-1", "parent_id":null, "reactions":[]},
                    {"id":"root-2", "parent_id":null, "reactions":[]}
                ],
                "posts": [{"hang":true, "abortDelayMs":1500}]
            }),
        );
        let mut parent = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "runner::tests::push_parent_process",
                "--nocapture",
            ])
            .env("DESIGN_STEERING_TEST_PUSH_PARENT", &root)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let requests = root.join("requests.jsonl");
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let recorded = fs::read_to_string(&requests).unwrap();
            if recorded.contains("\"method\":\"POST\"") {
                break;
            }
            assert!(
                parent.try_wait().unwrap().is_none(),
                "push parent exited early"
            );
            assert!(Instant::now() < deadline, "push did not dispatch");
            std::thread::sleep(Duration::from_millis(10));
        }
        let error = execute_push(&plan, &id, 2, TOKEN, &|_| {}).unwrap_err();
        assert!(error.contains("Another"), "{error}");
        parent.kill().unwrap();
        parent.wait().unwrap();
        assert!(
            AppLock::acquire(&plan.app_data).is_err(),
            "the worker must retain the lock after its parent exits"
        );
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Ok(lock) = AppLock::acquire(&plan.app_data) {
                drop(lock);
                break;
            }
            assert!(Instant::now() < deadline, "worker did not release its lock");
            std::thread::sleep(Duration::from_millis(20));
        }
        let saved = outbox::read(&plan.runs_dir, &id).unwrap();
        assert!(matches!(
            saved.actions[0].status,
            ActionStatus::InFlight | ActionStatus::Uncertain
        ));
        assert_eq!(saved.actions[1].status, ActionStatus::Pending);
        assert!(outbox::retry_uncertain(
            &plan.runs_dir,
            &id,
            saved.revision,
            &saved.actions[0].id,
            false
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(&requests)
                .unwrap()
                .matches("\"method\":\"POST\"")
                .count(),
            1
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stubbed_fetch_queue_push_sync_download_and_removal_stay_run_local() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let root = temp_dir("full-stub-flow");
        let app_data = root.join("app-data");
        let runs_dir = app_data.join("runs");
        let scripts_dir = root.join("scripts");
        fs::create_dir_all(&runs_dir).unwrap();
        fs::create_dir_all(&scripts_dir).unwrap();
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let url = |path: &Path| tauri::Url::from_file_path(path).unwrap().to_string();
        let fetch_stub = url(&repo.join("tests/stub-figma.mjs"));
        let fetch_script = url(&repo.join(FETCH_SCRIPT));
        let generate_script = url(&repo.join(GENERATE_SCRIPT));
        let fetch_log = root.join("fetch-requests.jsonl");
        let wrapper = format!(
            "import {{ appendFileSync }} from 'node:fs';\n\
             await import({});\n\
             const offlineFetch = globalThis.fetch;\n\
             globalThis.fetch = (input, options = {{}}) => {{\n\
               appendFileSync({}, JSON.stringify({{url: String(input), method: options.method ?? 'GET'}}) + '\\n');\n\
               return offlineFetch(input, options);\n\
             }};\n\
             await import({});\n",
            serde_json::to_string(&fetch_stub).unwrap(),
            serde_json::to_string(&fetch_log.to_string_lossy()).unwrap(),
            serde_json::to_string(&fetch_script).unwrap()
        );
        fs::write(scripts_dir.join(FETCH_SCRIPT), wrapper).unwrap();
        fs::write(
            scripts_dir.join(GENERATE_SCRIPT),
            format!(
                "await import({});\n",
                serde_json::to_string(&generate_script).unwrap()
            ),
        )
        .unwrap();
        let plan = RunPlan {
            node: PathBuf::from("node"),
            scripts_dir: scripts_dir.clone(),
            runs_dir: runs_dir.clone(),
        };
        let settings = RunSettings {
            token: TOKEN.into(),
            page_url: "https://www.figma.com/design/KEY/branch/BRANCH/file?node-id=1-1".into(),
            images: false,
            ..RunSettings::default()
        };
        let first = execute_run(&plan, &settings, &|_| {}).unwrap();
        assert_eq!(first, "checkout-design-critique");
        let original_markdown =
            fs::read(runs_dir.join(&first).join(format!("{first}.md"))).unwrap();
        let info = outbox::read_thread_info(&runs_dir, &first).unwrap();
        assert_eq!(info.file_key, "BRANCH");
        assert_eq!(info.threads[0].root_id, "c1");

        let queued = outbox::with_lock(&app_data, || {
            outbox::queue_reply(&runs_dir, &first, 0, "c1", "Private local reply")
        })
        .unwrap();
        let push_plan = PushPlan {
            node: PathBuf::from("node"),
            scripts_dir,
            runs_dir: runs_dir.clone(),
            app_data: app_data.clone(),
        };
        write_stubbed_worker(
            &push_plan,
            &root,
            json!({
                "comments": [{"id":"c1", "parent_id":null, "reactions":[]}],
                "posts": [{"status":201, "body":{"id":"posted-c1", "parent_id":"c1"}}]
            }),
        );
        execute_push(&push_plan, &first, queued.revision, TOKEN, &|_| {}).unwrap();
        assert_eq!(
            outbox::read(&runs_dir, &first).unwrap().actions[0].status,
            ActionStatus::Confirmed
        );
        assert_eq!(
            fs::read(runs_dir.join(&first).join(format!("{first}.md"))).unwrap(),
            original_markdown
        );

        let synced = execute_run(&plan, &settings, &|_| {}).unwrap();
        assert_eq!(synced, "checkout-design-critique-1");
        assert!(outbox::read(&runs_dir, &synced).unwrap().actions.is_empty());
        assert_eq!(
            outbox::read(&runs_dir, &first).unwrap().actions[0].status,
            ActionStatus::Confirmed
        );
        let fetch_requests = fs::read_to_string(&fetch_log).unwrap();
        assert!(fetch_requests.lines().all(|line| {
            let request: serde_json::Value = serde_json::from_str(line).unwrap();
            request["method"] == "GET"
                && request["url"]
                    .as_str()
                    .is_some_and(|url| url.starts_with("https://api.figma.com/"))
        }));
        let push_requests = fs::read_to_string(root.join("requests.jsonl")).unwrap();
        assert_eq!(push_requests.matches("\"method\":\"POST\"").count(), 1);
        assert!(push_requests.contains("/files/BRANCH/comments"));

        let downloads = root.join("downloads");
        fs::create_dir_all(&downloads).unwrap();
        let copy = runs::copy_run_to(&runs_dir, &first, &downloads).unwrap();
        assert!(copy.join("source.json").is_file());
        assert!(copy.join("title.txt").is_file());
        assert!(copy.join("checkout-figma-comments.json").is_file());
        assert_eq!(
            fs::read(copy.join(format!("{first}.md"))).unwrap(),
            original_markdown
        );
        assert!(!copy.join("outbox.json").exists());
        for entry in fs::read_dir(&copy).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_file() {
                let contents = fs::read_to_string(entry.path()).unwrap();
                assert!(!contents.contains(TOKEN));
                assert!(!contents.contains("Private local reply"));
            }
        }
        outbox::with_lock(&app_data, || runs::delete_run_in(&runs_dir, &first)).unwrap();
        assert!(!runs_dir.join(&first).exists());
        assert!(copy.is_dir());
        outbox::with_lock(&app_data, || runs::delete_all_runs_in(&runs_dir)).unwrap();
        assert!(!runs_dir.join(&synced).exists());
        let _ = fs::remove_dir_all(root);
    }
}
