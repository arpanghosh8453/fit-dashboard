mod auth;
mod database;
mod fit_parser;
mod models;
mod server;
mod state;
#[cfg(feature = "tauri-app")]
mod tauri_app;

use anyhow::Result;
use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let db_path = std::env::var("FIT_DASHBOARD_DB").unwrap_or_else(|_| "fit-dashboard.duckdb".to_string());
    let state = AppState::new(database::Database::new(&db_path)?);

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
