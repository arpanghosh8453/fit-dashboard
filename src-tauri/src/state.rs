use std::sync::Arc;

use crate::database::Database;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct StorageInfo {
    pub data_dir: String,
    pub db_path: String,
    pub fit_files_dir: String,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub storage: Arc<StorageInfo>,
}

impl AppState {
    pub fn new(db: Database, storage: StorageInfo) -> Self {
        Self {
            db: Arc::new(db),
            storage: Arc::new(storage),
        }
    }
}
