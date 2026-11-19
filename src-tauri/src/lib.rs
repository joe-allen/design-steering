mod node;
mod runner;
mod runs;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

static RUNNING: AtomicBool = AtomicBool::new(false);

fn runs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("runs"))
        .map_err(|error| error.to_string())
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
) -> Result<String, String> {
    let guard = runner::RunGuard::acquire(&RUNNING).ok_or("A run is already in progress.")?;
    let bundled = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("scripts"))
        .map_err(|error| error.to_string())?;
    let runs_dir = runs_dir(&app)?;
    blocking(move || {
        let _guard = guard;
        let plan = runner::build_plan(&settings, &bundled, &runs_dir)?;
        runner::execute_run(&plan, &settings, &|event| {
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
fn copy_run(app: AppHandle, id: String, dest: String) -> Result<String, String> {
    runs::copy_run_to(&runs_dir(&app)?, &id, std::path::Path::new(&dest))
        .map(|path| path.display().to_string())
}

#[tauri::command]
fn delete_run(app: AppHandle, id: String) -> Result<(), String> {
    let runs_dir = runs_dir(&app)?;
    runner::when_idle(&RUNNING, || runs::delete_run_in(&runs_dir, &id))
}

#[tauri::command]
fn delete_all_runs(app: AppHandle) -> Result<(), String> {
    let runs_dir = runs_dir(&app)?;
    runner::when_idle(&RUNNING, || runs::delete_all_runs_in(&runs_dir))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            detect_node,
            start_run,
            list_runs,
            read_run,
            copy_run,
            delete_run,
            delete_all_runs
        ])
        .run(tauri::generate_context!())
        .expect("error while running Design Steering");
}
