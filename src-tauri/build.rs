fn main() {
    if std::env::var_os("CARGO_FEATURE_TAURI_APP").is_some() {
        tauri_build::build();
    }
}
