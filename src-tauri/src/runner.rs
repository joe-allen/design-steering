use crate::node::{self, hide_window};
use crate::outbox::{self, ActionStatus, AppLock};
use crate::runs;
use crate::runs::PartialSummary;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

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
    pub staging_dir: PathBuf,
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

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunOutcome {
    Completed {
        run_id: String,
    },
    PartialCandidate {
        candidate_id: String,
        summary: PartialSummary,
    },
}

pub enum RunExecution {
    Completed { run_id: String },
    Pending(Box<StagedCandidate>),
}

pub struct StagedCandidate {
    candidate_id: String,
    stage_root: PathBuf,
    staged_run_dir: PathBuf,
    staged_id: String,
    plan: RunPlan,
    source: runs::RunSource,
    summary: PartialSummary,
    user: bool,
}

pub struct PendingRun<'a> {
    candidate: StagedCandidate,
    guard: RunGuard<'a>,
}

impl<'a> PendingRun<'a> {
    pub fn new(candidate: StagedCandidate, guard: RunGuard<'a>) -> Self {
        Self { candidate, guard }
    }

    pub fn into_parts(self) -> (StagedCandidate, RunGuard<'a>) {
        (self.candidate, self.guard)
    }
}

pub fn take_pending<'a>(
    state: &mut Option<PendingRun<'a>>,
    candidate_id: &str,
) -> Result<PendingRun<'a>, String> {
    if !state
        .as_ref()
        .is_some_and(|pending| pending.candidate.matches_id(candidate_id))
    {
        return Err("The partial export is no longer available.".into());
    }
    state
        .take()
        .ok_or("The partial export is no longer available.".into())
}

impl StagedCandidate {
    pub fn matches_id(&self, candidate_id: &str) -> bool {
        self.candidate_id == candidate_id
    }

    pub fn outcome(&self) -> RunOutcome {
        RunOutcome::PartialCandidate {
            candidate_id: self.candidate_id.clone(),
            summary: self.summary.clone(),
        }
    }

    pub fn save(self, emit: &(dyn Fn(RunEvent) + Send + Sync)) -> Result<String, String> {
        let result = publish_and_generate(
            &self.plan,
            &self.stage_root,
            &self.staged_run_dir,
            &self.staged_id,
            &self.source,
            self.user,
            emit,
        );
        match (result, cleanup_stage(&self.stage_root)) {
            (Ok(id), Ok(())) => Ok(id),
            (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
            (Err(error), Err(cleanup_error)) => Err(format!("{error}\n{cleanup_error}")),
        }
    }

    pub fn discard(self) -> Result<(), String> {
        cleanup_stage(&self.stage_root)
    }
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

static CANDIDATE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn candidate_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "partial-{timestamp}-{}",
        CANDIDATE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn cleanup_stage(stage_root: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(stage_root) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not clean up the staged candidate: {error}")),
    }
}

pub fn cleanup_abandoned_staging(app_data: &Path) -> Result<(), String> {
    let staging = app_data.join("partial-staging");
    match std::fs::remove_dir_all(staging) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove abandoned staged candidates: {error}"
        )),
    }
}

fn read_partial_report(run_dir: &Path) -> Result<Option<PartialSummary>, String> {
    let Some(report) = runs::read_partial_report(run_dir)? else {
        return Ok(None);
    };
    Ok(Some(PartialSummary {
        confirmed_threads: report.confirmed_threads,
        unreadable: report.unreadable,
        unexamined: report.unexamined,
    }))
}

fn reserve_run_dir(runs_dir: &Path, base: &str) -> Result<(String, PathBuf), String> {
    for suffix in 0u64.. {
        let id = if suffix == 0 {
            format!("{base}-design-critique")
        } else {
            format!("{base}-design-critique-{suffix}")
        };
        let dir = runs_dir.join(&id);
        match std::fs::create_dir(&dir) {
            Ok(()) => return Ok((id, dir)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(format!(
                    "Could not create run folder {}: {error}",
                    dir.display()
                ))
            }
        }
    }
    unreachable!("the u64 suffix space is finite")
}

fn publish_and_generate(
    plan: &RunPlan,
    stage_root: &Path,
    staged_run_dir: &Path,
    staged_id: &str,
    source: &runs::RunSource,
    user: bool,
    emit: &(dyn Fn(RunEvent) + Send + Sync),
) -> Result<String, String> {
    let base = runs::parse_run_folder(staged_id)
        .ok_or("The fetch script reported an unexpected run folder.")?;
    let (id, run_dir) = reserve_run_dir(&plan.runs_dir, base)?;
    let suffix = id
        .strip_prefix(&format!("{base}-design-critique"))
        .expect("reserved run id uses the staged basename");
    let source_json = staged_run_dir.join(format!("{base}-figma-comments.json"));
    let target_json = staged_run_dir.join(format!("{base}-figma-comments{suffix}.json"));
    let result = (|| {
        if !source_json.is_file() {
            return Err("The fetch script did not create its comments snapshot.".into());
        }
        if source_json != target_json {
            std::fs::rename(&source_json, &target_json)
                .map_err(|error| format!("Could not name the comments snapshot: {error}"))?;
        }
        let stage_parent = dunce::canonicalize(stage_root).map_err(|error| error.to_string())?;
        let staged = dunce::canonicalize(staged_run_dir)
            .map_err(|error| format!("Could not resolve the staged run: {error}"))?;
        if staged.parent() != Some(stage_parent.as_path()) {
            return Err(
                "The fetch script reported a run folder outside its private staging area.".into(),
            );
        }
        for entry in std::fs::read_dir(&staged).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            std::fs::rename(entry.path(), run_dir.join(entry.file_name()))
                .map_err(|error| format!("Could not publish the staged run: {error}"))?;
        }
        runs::write_source(&run_dir, source)?;
        emit(RunEvent::Step {
            step: "generate".into(),
        });
        let generate_args = vec![
            plan.scripts_dir.join(GENERATE_SCRIPT).display().to_string(),
            run_dir.display().to_string(),
            format!("--user={user}"),
        ];
        run_script(&plan.node, &generate_args, None, "", emit)?;
        Ok(id.clone())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&run_dir);
    }
    result
}

/// Fetches to private staging, then either returns a pending candidate or publishes a complete run.
pub fn execute_run(
    plan: &RunPlan,
    settings: &RunSettings,
    emit: &(dyn Fn(RunEvent) + Send + Sync),
) -> Result<RunExecution, String> {
    let script = |name: &str| plan.scripts_dir.join(name).display().to_string();
    let token = settings.token.trim();
    let candidate_id = candidate_id();
    let stage_root = plan.staging_dir.join(&candidate_id);
    std::fs::create_dir_all(&stage_root)
        .map_err(|error| format!("Could not create private staging: {error}"))?;

    emit(RunEvent::Step {
        step: "fetch".into(),
    });
    let mut fetch_args = vec![
        script(FETCH_SCRIPT),
        settings.page_url.trim().to_string(),
        format!("--images={}", settings.images),
        format!("--out={}", stage_root.display()),
        "--print-run-dir".to_string(),
        "--desktop-partial".to_string(),
    ];
    if !settings.run_name.trim().is_empty() {
        fetch_args.push(format!("--name={}", settings.run_name.trim()));
    }
    let stdout = match run_script(&plan.node, &fetch_args, Some(token), token, emit) {
        Ok(stdout) => stdout,
        Err(error) => {
            cleanup_stage(&stage_root)?;
            return Err(error);
        }
    };

    let resolved = (|| {
        let reported = stdout
            .iter()
            .rev()
            .find(|line| !line.trim().is_empty())
            .map(|line| PathBuf::from(line.trim()))
            .ok_or("The fetch script did not report a run folder.")?;
        let staged_id = reported
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .ok_or("The fetch script reported an unexpected run folder.")?;
        let stage_root_canonical =
            dunce::canonicalize(&stage_root).map_err(|error| error.to_string())?;
        let staged_run_dir = dunce::canonicalize(&reported).map_err(|error| {
            format!("The fetch script reported a run folder that does not exist: {error}")
        })?;
        if staged_run_dir.parent() != Some(stage_root_canonical.as_path())
            || runs::parse_run_folder(&staged_id).is_none()
        {
            return Err(
                "The fetch script reported a run folder outside its private staging area.".into(),
            );
        }
        Ok((staged_id, staged_run_dir))
    })();
    let (staged_id, staged_run_dir) = match resolved {
        Ok(resolved) => resolved,
        Err(error) => {
            return match cleanup_stage(&stage_root) {
                Ok(()) => Err(error),
                Err(cleanup_error) => Err(format!("{error}\n{cleanup_error}")),
            };
        }
    };
    let summary = match read_partial_report(&staged_run_dir) {
        Ok(summary) => summary,
        Err(error) => {
            cleanup_stage(&stage_root)?;
            return Err(error);
        }
    };
    if let Some(summary) = summary {
        return Ok(RunExecution::Pending(Box::new(StagedCandidate {
            candidate_id,
            stage_root,
            staged_run_dir,
            staged_id,
            plan: RunPlan {
                node: plan.node.clone(),
                scripts_dir: plan.scripts_dir.clone(),
                runs_dir: plan.runs_dir.clone(),
                staging_dir: plan.staging_dir.clone(),
            },
            source: runs::RunSource {
                page_url: settings.page_url.trim().to_string(),
                run_name: settings.run_name.trim().to_string(),
            },
            summary,
            user: settings.user,
        })));
    }
    let id = match publish_and_generate(
        plan,
        &stage_root,
        &staged_run_dir,
        &staged_id,
        &runs::RunSource {
            page_url: settings.page_url.trim().to_string(),
            run_name: settings.run_name.trim().to_string(),
        },
        settings.user,
        emit,
    ) {
        Ok(id) => id,
        Err(error) => {
            cleanup_stage(&stage_root)?;
            return Err(error);
        }
    };
    cleanup_stage(&stage_root)?;
    Ok(RunExecution::Completed { run_id: id })
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
    let staging_dir = runs_dir
        .parent()
        .unwrap_or(runs_dir)
        .join("partial-staging");
    std::fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("Could not create private staging: {error}"))?;
    Ok(RunPlan {
        node: PathBuf::from(node.path),
        scripts_dir: scripts_dir(bundled_scripts)?,
        runs_dir: dunce::canonicalize(runs_dir).map_err(|error| error.to_string())?,
        staging_dir: dunce::canonicalize(staging_dir).map_err(|error| error.to_string())?,
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
    emit(RunEvent::Step {
        step: "push".into(),
    });

    let mut command = Command::new(std::env::current_exe().map_err(|error| error.to_string())?);
    #[cfg(test)]
    command.args(["--exact", "runner::tests::push_lock_worker", "--nocapture"]);
    #[cfg(not(test))]
    command
        .arg("--design-steering-push-worker")
        .arg(&plan.app_data)
        .arg(&plan.runs_dir)
        .arg(&plan.scripts_dir)
        .arg(&plan.node)
        .arg(id)
        .arg(reviewed_revision.to_string());
    command
        .env_remove("FIGMA_PAGE_URL")
        .env_remove("NODE_OPTIONS")
        .env("FIGMA_TOKEN", token)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(test)]
    command
        .env("DESIGN_STEERING_TEST_PUSH_WORKER", "1")
        .env("DESIGN_STEERING_TEST_APP_DATA", &plan.app_data)
        .env("DESIGN_STEERING_TEST_RUNS_DIR", &plan.runs_dir)
        .env("DESIGN_STEERING_TEST_SCRIPTS_DIR", &plan.scripts_dir)
        .env("DESIGN_STEERING_TEST_NODE", &plan.node)
        .env("DESIGN_STEERING_TEST_RUN_ID", id)
        .env(
            "DESIGN_STEERING_TEST_REVISION",
            reviewed_revision.to_string(),
        );
    hide_window(&mut command);
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
                let line = redact_push(raw.trim_end(), token, &[]);
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

fn execute_push_worker(
    plan: &PushPlan,
    id: &str,
    reviewed_revision: u64,
    token: &str,
    emit: &(dyn Fn(RunEvent) + Send + Sync),
) -> Result<(), String> {
    let _lock = AppLock::acquire(&plan.app_data)?;
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
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the push worker: {error}"))?;
    let control = child.stdin.take().expect("stdin is piped");
    let mut parent = std::io::stdin();
    std::thread::spawn(move || {
        let _ = parent.read_to_end(&mut Vec::new());
        drop(control);
    });

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
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not read push progress: {error}. Check Figma before retrying an in-flight action."));
            }
        }
    }
    let status = child
        .wait()
        .map_err(|error| format!("Could not wait for the push worker: {error}"))?;
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

pub fn run_push_worker_from_args(args: &[OsString]) -> i32 {
    if args.len() != 6 {
        eprintln!("The internal push worker arguments are invalid.");
        return 2;
    }
    let id = args[4].to_string_lossy();
    let Ok(reviewed_revision) = args[5].to_string_lossy().parse::<u64>() else {
        eprintln!("The reviewed outbox revision is invalid.");
        return 2;
    };
    let plan = PushPlan {
        app_data: PathBuf::from(&args[0]),
        runs_dir: PathBuf::from(&args[1]),
        scripts_dir: PathBuf::from(&args[2]),
        node: PathBuf::from(&args[3]),
    };
    let token = std::env::var("FIGMA_TOKEN").unwrap_or_default();
    match execute_push_worker(&plan, &id, reviewed_revision, &token, &|event| {
        if let RunEvent::Log { line } = event {
            eprintln!("{line}");
        }
    }) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    const TOKEN: &str = "figd_super-secret-token";

    #[test]
    fn push_lock_worker() {
        if std::env::var("DESIGN_STEERING_TEST_PUSH_WORKER").as_deref() != Ok("1") {
            return;
        }
        let variables = [
            "DESIGN_STEERING_TEST_APP_DATA",
            "DESIGN_STEERING_TEST_RUNS_DIR",
            "DESIGN_STEERING_TEST_SCRIPTS_DIR",
            "DESIGN_STEERING_TEST_NODE",
            "DESIGN_STEERING_TEST_RUN_ID",
            "DESIGN_STEERING_TEST_REVISION",
        ];
        let args: Vec<OsString> = variables
            .iter()
            .map(|name| std::env::var_os(name).expect("push worker argument is set"))
            .collect();
        std::process::exit(run_push_worker_from_args(&args));
    }

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
writeFileSync(join(dir, 'stub-figma-comments.json'), '[]');
    if (process.argv[2].includes('partial')) {
      writeFileSync(join(dir, 'partial-report.json'), JSON.stringify({
        version: 1,
        confirmed_threads: 2,
        recovery_requests: 4,
        unreadable: [{ id: 'node-bad', path: [{ id: 'node-bad', name: 'Unreadable layer' }] }],
        unexamined: []
      }));
    }
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
        let staging_dir = root.join("partial-staging");
        fs::create_dir_all(&staging_dir).unwrap();
        let plan = RunPlan {
            node: PathBuf::from("node"),
            scripts_dir: scripts,
            runs_dir: dunce::canonicalize(runs_dir).unwrap(),
            staging_dir,
        };
        (plan, root)
    }

    fn run_completed(plan: &RunPlan, settings: &RunSettings) -> String {
        match execute_run(plan, settings, &|_| {}).unwrap() {
            RunExecution::Completed { run_id } => run_id,
            RunExecution::Pending(_) => panic!("expected a complete run"),
        }
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
    fn run_outcomes_use_the_frontend_camel_case_contract() {
        assert_eq!(
            serde_json::to_value(RunOutcome::Completed {
                run_id: "home-design-critique".into(),
            })
            .unwrap(),
            json!({"kind": "completed", "runId": "home-design-critique"})
        );
        assert_eq!(
            serde_json::to_value(RunOutcome::PartialCandidate {
                candidate_id: "candidate-1".into(),
                summary: PartialSummary {
                    confirmed_threads: 2,
                    unreadable: vec![],
                    unexamined: vec![],
                },
            })
            .unwrap(),
            json!({
                "kind": "partialCandidate",
                "candidateId": "candidate-1",
                "summary": {
                    "confirmedThreads": 2,
                    "unreadable": [],
                    "unexamined": [],
                },
            })
        );
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

        let id = match execute_run(&plan, &settings("https://figma.test/ok"), &emit).unwrap() {
            RunExecution::Completed { run_id } => run_id,
            RunExecution::Pending(_) => panic!("expected a complete run"),
        };
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
        assert!(argv.contains("--desktop-partial"));
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
    fn pending_partial_candidate_is_hidden_until_saved_and_generates_without_refetching() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("partial-pending");
        let events = Mutex::new(Vec::new());
        let emit = |event: RunEvent| events.lock().unwrap().push(event);
        let candidate =
            match execute_run(&plan, &settings("https://figma.test/partial"), &emit).unwrap() {
                RunExecution::Pending(candidate) => candidate,
                RunExecution::Completed { .. } => panic!("expected a pending partial candidate"),
            };
        let outcome = candidate.outcome();
        let RunOutcome::PartialCandidate {
            candidate_id,
            summary,
        } = outcome
        else {
            panic!("expected partial outcome");
        };
        assert_eq!(summary.confirmed_threads, 2);
        assert_eq!(summary.unreadable[0].id, "node-bad");
        assert!(runs::list_runs_in(&plan.runs_dir).is_empty());
        assert!(candidate
            .staged_run_dir
            .join("partial-report.json")
            .is_file());
        assert!(!candidate.staged_run_dir.join(runs::SOURCE_FILE).exists());

        let id = candidate.save(&emit).unwrap();
        assert_eq!(id, "stub-design-critique");
        assert_eq!(runs::list_runs_in(&plan.runs_dir).len(), 1);
        let run_dir = plan.runs_dir.join(&id);
        assert!(run_dir.join(format!("{id}.md")).is_file());
        assert!(run_dir.join("stub-figma-comments.json").is_file());
        let source = runs::read_run_in(&plan.runs_dir, &id)
            .unwrap()
            .source
            .unwrap();
        assert_eq!(source.page_url, "https://figma.test/partial");
        assert!(!candidate_id.is_empty());
        assert!(!plan.staging_dir.join(candidate_id).exists());

        let event_list = events.into_inner().unwrap();
        let steps: Vec<&str> = event_list
            .iter()
            .filter_map(|event| match event {
                RunEvent::Step { step } => Some(step.as_str()),
                RunEvent::Log { .. } => None,
            })
            .collect();
        assert_eq!(steps, ["fetch", "generate"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pending_decisions_reject_invalid_and_repeated_ids_while_holding_the_run_guard() {
        let flag = AtomicBool::new(false);
        let guard = RunGuard::acquire(&flag).unwrap();
        let plan = RunPlan {
            node: PathBuf::from("node"),
            scripts_dir: PathBuf::new(),
            runs_dir: PathBuf::new(),
            staging_dir: PathBuf::new(),
        };
        let candidate = StagedCandidate {
            candidate_id: "partial-test-id".into(),
            stage_root: PathBuf::new(),
            staged_run_dir: PathBuf::new(),
            staged_id: "stub-design-critique".into(),
            plan,
            source: runs::RunSource {
                page_url: "https://figma.test/page".into(),
                run_name: String::new(),
            },
            summary: PartialSummary {
                confirmed_threads: 1,
                unreadable: Vec::new(),
                unexamined: vec![],
            },
            user: false,
        };
        let mut state = Some(PendingRun::new(candidate, guard));

        assert!(take_pending(&mut state, "invalid-id").is_err());
        assert!(
            state.is_some(),
            "an invalid decision must not consume the candidate"
        );
        let pending = take_pending(&mut state, "partial-test-id").unwrap();
        assert!(state.is_none());
        assert!(RunGuard::acquire(&flag).is_none());
        assert!(
            take_pending(&mut state, "partial-test-id").is_err(),
            "a stale repeated decision must fail"
        );
        drop(pending);
        assert!(RunGuard::acquire(&flag).is_some());
    }

    #[test]
    fn discarding_a_candidate_keeps_existing_runs_and_outboxes_untouched() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("partial-discard");
        let existing = plan.runs_dir.join("older-design-critique");
        fs::create_dir_all(&existing).unwrap();
        fs::write(existing.join("older-design-critique.md"), "# Older").unwrap();
        fs::write(existing.join("outbox.json"), "{\"private\":true}").unwrap();
        let candidate =
            match execute_run(&plan, &settings("https://figma.test/partial"), &|_| {}).unwrap() {
                RunExecution::Pending(candidate) => candidate,
                RunExecution::Completed { .. } => panic!("expected a pending candidate"),
            };
        let stage_root = candidate.stage_root.clone();
        candidate.discard().unwrap();
        assert!(!stage_root.exists());
        assert_eq!(runs::list_runs_in(&plan.runs_dir).len(), 1);
        assert_eq!(
            fs::read_to_string(existing.join("outbox.json")).unwrap(),
            "{\"private\":true}"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn abandoned_staging_cleanup_does_not_touch_published_runs() {
        let root = temp_dir("abandoned-staging");
        let app_data = root.join("app-data");
        let staging = app_data.join("partial-staging/candidate-abandoned");
        let runs_dir = app_data.join("runs/older-design-critique");
        fs::create_dir_all(&staging).unwrap();
        fs::create_dir_all(&runs_dir).unwrap();
        fs::write(staging.join("snapshot.json"), "private").unwrap();
        fs::write(runs_dir.join("outbox.json"), "private outbox").unwrap();
        fs::write(runs_dir.join("older-design-critique.md"), "# Older").unwrap();

        cleanup_abandoned_staging(&app_data).unwrap();
        assert!(!app_data.join("partial-staging").exists());
        assert_eq!(
            fs::read_to_string(runs_dir.join("outbox.json")).unwrap(),
            "private outbox"
        );
        assert!(runs_dir.join("older-design-critique.md").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn saving_uses_a_free_folder_suffix_and_preserves_the_older_run_and_outbox() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("partial-collision");
        let older = plan.runs_dir.join("stub-design-critique");
        fs::create_dir_all(&older).unwrap();
        fs::write(older.join("stub-design-critique.md"), "# Older").unwrap();
        fs::write(older.join("stub-figma-comments.json"), "older comments").unwrap();
        fs::write(older.join("outbox.json"), "older outbox").unwrap();
        let candidate =
            match execute_run(&plan, &settings("https://figma.test/partial"), &|_| {}).unwrap() {
                RunExecution::Pending(candidate) => candidate,
                RunExecution::Completed { .. } => panic!("expected a pending candidate"),
            };

        let id = candidate.save(&|_| {}).unwrap();
        assert_eq!(id, "stub-design-critique-1");
        assert!(plan.runs_dir.join(&id).join(format!("{id}.md")).is_file());
        assert!(plan
            .runs_dir
            .join(&id)
            .join("stub-figma-comments-1.json")
            .is_file());
        assert_eq!(
            fs::read_to_string(older.join("stub-design-critique.md")).unwrap(),
            "# Older"
        );
        assert_eq!(
            fs::read_to_string(older.join("outbox.json")).unwrap(),
            "older outbox"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn generation_failure_cleans_the_candidate_without_altering_an_older_run() {
        if !node_available() {
            eprintln!("skipped: node is not installed");
            return;
        }
        let (plan, root) = plan("partial-generation-failure");
        let older = plan.runs_dir.join("older-design-critique");
        fs::create_dir_all(&older).unwrap();
        fs::write(older.join("older-design-critique.md"), "# Older").unwrap();
        fs::write(older.join("outbox.json"), "older outbox").unwrap();
        fs::write(
            plan.scripts_dir.join(GENERATE_SCRIPT),
            "console.error('generation failed'); process.exit(1);",
        )
        .unwrap();
        let candidate =
            match execute_run(&plan, &settings("https://figma.test/partial"), &|_| {}).unwrap() {
                RunExecution::Pending(candidate) => candidate,
                RunExecution::Completed { .. } => panic!("expected a pending candidate"),
            };
        let stage_root = candidate.stage_root.clone();
        let error = candidate
            .save(&|_| {})
            .expect_err("generation failure should fail saving");
        assert!(error.contains("generation failed"), "{error}");
        assert!(!stage_root.exists());
        assert_eq!(runs::list_runs_in(&plan.runs_dir).len(), 1);
        assert_eq!(
            fs::read_to_string(older.join("outbox.json")).unwrap(),
            "older outbox"
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
        let id = run_completed(&plan, &run_settings);
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
        let id = run_completed(&plan, &settings("https://figma.test/ok"));
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
        let error = match execute_run(&plan, &settings("https://figma.test/blockrecord"), &|_| {}) {
            Err(error) => error,
            Ok(_) => panic!("record failure should fail the run"),
        };
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
        let error = match execute_run(&plan, &settings("https://figma.test/fail"), &|_| {}) {
            Err(error) => error,
            Ok(_) => panic!("fetch failure should fail the run"),
        };
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
        let repair_flag = root.join("partial-layer-repaired");
        let wrapper = format!(
            "import {{ appendFileSync, existsSync }} from 'node:fs';\n\
             await import({});\n\
             const offlineFetch = globalThis.fetch;\n\
             globalThis.fetch = (input, options = {{}}) => {{\n\
               let target = input;\n\
               if (existsSync({})) {{\n\
                 const parsed = new URL(input);\n\
                 parsed.pathname = parsed.pathname.replace('/files/PARTIAL/', '/files/KEY/');\n\
                 target = parsed;\n\
               }}\n\
               appendFileSync({}, JSON.stringify({{url: String(target), method: options.method ?? 'GET'}}) + '\\n');\n\
               return offlineFetch(target, options);\n\
             }};\n\
             await import({});\n",
            serde_json::to_string(&fetch_stub).unwrap(),
            serde_json::to_string(&repair_flag.to_string_lossy()).unwrap(),
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
            staging_dir: app_data.join("partial-staging"),
        };
        let settings = RunSettings {
            token: TOKEN.into(),
            page_url: "https://www.figma.com/design/KEY/branch/BRANCH/file?node-id=1-1".into(),
            images: false,
            ..RunSettings::default()
        };
        let first = run_completed(&plan, &settings);
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

        let synced = run_completed(&plan, &settings);
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

        let partial_settings = RunSettings {
            page_url: "https://www.figma.com/design/PARTIAL/checkout?node-id=1-1".into(),
            run_name: "partial-export".into(),
            images: false,
            ..settings.clone()
        };
        let discarded = match execute_run(&plan, &partial_settings, &|_| {}).unwrap() {
            RunExecution::Pending(candidate) => candidate,
            RunExecution::Completed { .. } => panic!("expected a partial candidate to discard"),
        };
        let discarded_stage = discarded.stage_root.clone();
        discarded.discard().unwrap();
        assert!(!discarded_stage.exists());
        assert!(runs::list_runs_in(&runs_dir).is_empty());

        let accepted = match execute_run(&plan, &partial_settings, &|_| {}).unwrap() {
            RunExecution::Pending(candidate) => candidate,
            RunExecution::Completed { .. } => panic!("expected a partial candidate to save"),
        };
        let partial_id = accepted.save(&|_| {}).unwrap();
        assert_eq!(partial_id, "partial-export-design-critique");
        let reopened = runs::read_run_in(&runs_dir, &partial_id).unwrap();
        assert!(reopened.partial);
        assert!(reopened.markdown.contains("## Partial export"));
        assert!(reopened.markdown.contains("Unreadable branches"));
        assert!(runs::list_runs_in(&runs_dir)[0].partial);

        let partial_outbox = runs_dir.join(&partial_id).join("outbox.json");
        fs::write(&partial_outbox, "{\"private\":true}").unwrap();
        let partial_copy = runs::copy_run_to(&runs_dir, &partial_id, &downloads).unwrap();
        assert!(partial_copy.join("partial-report.json").is_file());
        assert!(
            fs::read_to_string(partial_copy.join(format!("{partial_id}.md")))
                .unwrap()
                .contains("## Partial export")
        );
        assert!(!partial_copy.join("outbox.json").exists());
        assert!(!partial_copy.join("partial-staging").exists());

        fs::write(&repair_flag, "repaired").unwrap();
        let repaired_id = run_completed(&plan, &partial_settings);
        assert_eq!(repaired_id, "partial-export-design-critique-1");
        let repaired = runs::read_run_in(&runs_dir, &repaired_id).unwrap();
        assert!(!repaired.partial);
        assert!(!repaired.markdown.contains("## Partial export"));
        let summaries = runs::list_runs_in(&runs_dir);
        assert_eq!(summaries.len(), 2);
        assert_eq!(
            summaries
                .iter()
                .map(|run| (run.id.as_str(), run.partial))
                .collect::<Vec<_>>(),
            [
                ("partial-export-design-critique-1", false),
                ("partial-export-design-critique", true),
            ]
        );
        assert!(runs::read_run_in(&runs_dir, &partial_id)
            .unwrap()
            .markdown
            .contains("## Partial export"));
        let push_requests = fs::read_to_string(root.join("requests.jsonl")).unwrap();
        assert_eq!(push_requests.matches("\"method\":\"POST\"").count(), 1);
        let fetch_requests = fs::read_to_string(&fetch_log).unwrap();
        assert!(fetch_requests.lines().all(|line| {
            let request: serde_json::Value = serde_json::from_str(line).unwrap();
            request["method"] == "GET"
                && request["url"]
                    .as_str()
                    .is_some_and(|url| url.starts_with("https://api.figma.com/"))
        }));
        let _ = fs::remove_dir_all(root);
    }
}
