mod auth;
mod database;
mod fit_parser;
mod models;
mod server;
mod state;
#[cfg(feature = "tauri-app")]
mod tauri_app;

use anyhow::Result;
use state::{AppState, StorageInfo};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

static LOG_GUARD: std::sync::OnceLock<tracing_appender::non_blocking::WorkerGuard> =
    std::sync::OnceLock::new();

fn resolve_data_dir() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("FIT_DASHBOARD_DATA_DIR") {
        return std::path::PathBuf::from(path);
    }

    let is_docker = std::env::var("FIT_DASHBOARD_DOCKER")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if is_docker {
        return std::path::PathBuf::from("/data");
    }

    // Keep runtime artifacts out of src-tauri to avoid dev-watch rebuild loops
    // when DuckDB WAL / log files are updated.
    if let Some(base) = dirs::data_local_dir() {
        return base.join("fit-dashboard");
    }

    if let Some(home) = dirs::home_dir() {
        return home.join(".fit-dashboard-data");
    }

    std::path::PathBuf::from(".fit-dashboard-data")
}

fn init_logging(data_dir: &std::path::Path) -> Result<()> {
    let is_docker = std::env::var("FIT_DASHBOARD_DOCKER")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        // Keep third-party libs quieter while allowing app-level debug logs.
        EnvFilter::new("info,fit_dashboard_core=debug,hyper=warn,h2=warn")
    });

    let stdout_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(!is_docker)
        .with_file(true)
        .with_line_number(true)
        .with_thread_ids(true)
        .with_target(true);

    if is_docker {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(stdout_layer)
            .init();
    } else {
        std::fs::create_dir_all(data_dir)?;
        let file_appender = tracing_appender::rolling::never(data_dir, "fit-dashboard.log");
        let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
        let _ = LOG_GUARD.set(guard);

        let file_layer = tracing_subscriber::fmt::layer()
            .with_writer(file_writer)
            .with_ansi(false)
            .with_file(true)
            .with_line_number(true)
            .with_thread_ids(true)
            .with_target(true);

        tracing_subscriber::registry()
            .with(env_filter)
            .with(stdout_layer)
            .with(file_layer)
            .init();
    }

    std::panic::set_hook(Box::new(|panic_info| {
        tracing::error!("panic captured: {panic_info}");
    }));

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let data_dir = resolve_data_dir();
    init_logging(&data_dir)?;
    std::fs::create_dir_all(&data_dir)?;
    let fit_files_dir = data_dir.join("fit-files");
    std::fs::create_dir_all(&fit_files_dir)?;

    let db_path = std::env::var("FIT_DASHBOARD_DB")
        .unwrap_or_else(|_| data_dir.join("fit-dashboard.duckdb").to_string_lossy().to_string());
    let storage = StorageInfo {
        data_dir: data_dir.to_string_lossy().to_string(),
        db_path: db_path.clone(),
        fit_files_dir: fit_files_dir.to_string_lossy().to_string(),
    };

    let state = AppState::new(database::Database::new(&db_path)?, storage);
    tracing::info!(
        data_dir = %state.storage.data_dir,
        db_path = %state.storage.db_path,
        fit_files_dir = %state.storage.fit_files_dir,
        "backend storage configured"
    );

    #[cfg(feature = "web")]
    {
        let app = server::app(state);
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
        tracing::info!("Server listening on http://0.0.0.0:8080");
        axum::serve(listener, app).await?;
        return Ok(());
    }

    #[cfg(feature = "tauri-app")]
    {
        let _ = state;
        // Tauri bootstrap can be wired here with #[tauri::command] wrappers.
        // This scaffold keeps logic in tauri_app.rs for direct integration.
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}
