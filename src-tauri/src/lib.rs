mod node;
mod outbox;
mod runner;
mod runs;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

static RUNNING: AtomicBool = AtomicBool::new(false);
static PENDING_RUN: Mutex<Option<runner::PendingRun<'static>>> = Mutex::new(None);

fn runs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app).map(|dir| dir.join("runs"))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> {
    let handle = tauri::async_runtime::spawn_blocking(job);
    async move { handle.await.map_err(|error| error.to_string())? }
}

#[tauri::command]
async fn detect_node(node_path: Option<String>) -> Result<node::NodeInfo, String> {
    blocking(move || node::detect(node_path.as_deref())).await
}

#[tauri::command]
async fn start_run(
    app: AppHandle,
    settings: runner::RunSettings,
    on_event: Channel<runner::RunEvent>,
) -> Result<runner::RunOutcome, String> {
    let guard = runner::RunGuard::acquire(&RUNNING).ok_or("A run is already in progress.")?;
    let bundled = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("scripts"))
        .map_err(|error| error.to_string())?;
    let runs_dir = runs_dir(&app)?;
    let (execution, guard) = blocking(move || {
        let plan = runner::build_plan(&settings, &bundled, &runs_dir)?;
        let execution = runner::execute_run(&plan, &settings, &|event| {
            let _ = on_event.send(event);
        })?;
        Ok((execution, guard))
    })
    .await?;
    match execution {
        runner::RunExecution::Completed { run_id } => {
            drop(guard);
            Ok(runner::RunOutcome::Completed { run_id })
        }
        runner::RunExecution::Pending(candidate) => {
            let outcome = candidate.outcome();
            let mut pending = match PENDING_RUN.lock() {
                Ok(pending) => pending,
                Err(_) => {
                    candidate.discard()?;
                    drop(guard);
                    return Err("The pending export state is unavailable.".into());
                }
            };
            if pending.is_some() {
                drop(pending);
                candidate.discard()?;
                drop(guard);
                return Err("A partial export is already awaiting a decision.".into());
            }
            *pending = Some(runner::PendingRun::new(candidate, guard));
            Ok(outcome)
        }
    }
}

#[tauri::command]
async fn save_partial_export(
    candidate_id: String,
    on_event: Channel<runner::RunEvent>,
) -> Result<String, String> {
    let pending = {
        let mut state = PENDING_RUN
            .lock()
            .map_err(|_| "The pending export state is unavailable.".to_string())?;
        runner::take_pending(&mut state, &candidate_id)?
    };
    blocking(move || {
        let (candidate, guard) = pending.into_parts();
        let result = candidate.save(&|event| {
            let _ = on_event.send(event);
        });
        drop(guard);
        result
    })
    .await
}

#[tauri::command]
async fn discard_partial_export(candidate_id: String) -> Result<(), String> {
    let pending = {
        let mut state = PENDING_RUN
            .lock()
            .map_err(|_| "The pending export state is unavailable.".to_string())?;
        runner::take_pending(&mut state, &candidate_id)?
    };
    blocking(move || {
        let (candidate, guard) = pending.into_parts();
        let result = candidate.discard();
        drop(guard);
        result
    })
    .await
}

#[tauri::command]
async fn push_run(
    app: AppHandle,
    id: String,
    revision: u64,
    settings: runner::PushSettings,
    on_event: Channel<runner::RunEvent>,
) -> Result<(), String> {
    let guard = runner::RunGuard::acquire(&RUNNING).ok_or("A run is already in progress.")?;
    let bundled = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("scripts"))
        .map_err(|error| error.to_string())?;
    let runs_dir = runs_dir(&app)?;
    let app_data = app_data_dir(&app)?;
    blocking(move || {
        let _guard = guard;
        let plan = runner::build_push_plan(&settings, &bundled, &runs_dir, &app_data)?;
        runner::execute_push(&plan, &id, revision, &settings.token, &|event| {
            let _ = on_event.send(event);
        })
    })
    .await
}

#[tauri::command]
fn list_runs(app: AppHandle) -> Result<Vec<runs::RunSummary>, String> {
    Ok(runs::list_runs_in(&runs_dir(&app)?))
}

#[tauri::command]
fn read_run(app: AppHandle, id: String) -> Result<runs::RunContent, String> {
    runs::read_run_in(&runs_dir(&app)?, &id)
}

#[tauri::command]
fn read_threads(app: AppHandle, id: String) -> Result<outbox::ThreadInfo, String> {
    outbox::read_thread_info(&runs_dir(&app)?, &id)
}

#[tauri::command]
fn read_outbox(app: AppHandle, id: String) -> Result<outbox::Outbox, String> {
    outbox::read(&runs_dir(&app)?, &id)
}

#[tauri::command]
fn queue_reply(
    app: AppHandle,
    id: String,
    revision: u64,
    root_id: String,
    text: String,
) -> Result<outbox::Outbox, String> {
    let runs_dir = runs_dir(&app)?;
    let app_data = app_data_dir(&app)?;
    runner::when_idle(&RUNNING, || {
        outbox::with_lock(&app_data, || {
            outbox::queue_reply(&runs_dir, &id, revision, &root_id, &text)
        })
    })
}

#[tauri::command]
fn queue_done(
    app: AppHandle,
    id: String,
    revision: u64,
    root_id: String,
) -> Result<outbox::Outbox, String> {
    let runs_dir = runs_dir(&app)?;
    let app_data = app_data_dir(&app)?;
    runner::when_idle(&RUNNING, || {
        outbox::with_lock(&app_data, || {
            outbox::queue_done(&runs_dir, &id, revision, &root_id)
        })
    })
}

#[tauri::command]
fn edit_reply(
    app: AppHandle,
    id: String,
    revision: u64,
    action_id: String,
    text: String,
) -> Result<outbox::Outbox, String> {
    let runs_dir = runs_dir(&app)?;
    let app_data = app_data_dir(&app)?;
    runner::when_idle(&RUNNING, || {
        outbox::with_lock(&app_data, || {
            outbox::edit_reply(&runs_dir, &id, revision, &action_id, &text)
        })
    })
}

#[tauri::command]
fn discard_action(
    app: AppHandle,
    id: String,
    revision: u64,
    action_id: String,
) -> Result<outbox::Outbox, String> {
    let runs_dir = runs_dir(&app)?;
    let app_data = app_data_dir(&app)?;
    runner::when_idle(&RUNNING, || {
        outbox::with_lock(&app_data, || {
            outbox::discard(&runs_dir, &id, revision, &action_id)
        })
    })
}

#[tauri::command]
fn retry_uncertain(
    app: AppHandle,
    id: String,
    revision: u64,
    action_id: String,
    verified: bool,
) -> Result<outbox::Outbox, String> {
    let runs_dir = runs_dir(&app)?;
    let app_data = app_data_dir(&app)?;
    runner::when_idle(&RUNNING, || {
        outbox::with_lock(&app_data, || {
            outbox::retry_uncertain(&runs_dir, &id, revision, &action_id, verified)
        })
    })
}

#[tauri::command]
fn copy_run(app: AppHandle, id: String, dest: String) -> Result<String, String> {
    runs::copy_run_to(&runs_dir(&app)?, &id, std::path::Path::new(&dest))
        .map(|path| path.display().to_string())
}

#[tauri::command]
fn delete_run(app: AppHandle, id: String) -> Result<(), String> {
    let runs_dir = runs_dir(&app)?;
    let app_data = app_data_dir(&app)?;
    runner::when_idle(&RUNNING, || {
        outbox::with_lock(&app_data, || runs::delete_run_in(&runs_dir, &id))
    })
}

#[tauri::command]
fn delete_all_runs(app: AppHandle) -> Result<(), String> {
    let runs_dir = runs_dir(&app)?;
    let app_data = app_data_dir(&app)?;
    runner::when_idle(&RUNNING, || {
        outbox::with_lock(&app_data, || runs::delete_all_runs_in(&runs_dir))
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<_> = std::env::args_os().collect();
    if args
        .get(1)
        .is_some_and(|arg| arg == "--design-steering-push-worker")
    {
        std::process::exit(runner::run_push_worker_from_args(&args[2..]));
    }

    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            runner::cleanup_abandoned_staging(&app_data).map_err(std::io::Error::other)?;
            Ok(())
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            detect_node,
            start_run,
            save_partial_export,
            discard_partial_export,
            push_run,
            list_runs,
            read_run,
            read_threads,
            read_outbox,
            queue_reply,
            queue_done,
            edit_reply,
            discard_action,
            retry_uncertain,
            copy_run,
            delete_run,
            delete_all_runs
        ])
        .run(tauri::generate_context!())
        .expect("error while running Design Steering");
}
