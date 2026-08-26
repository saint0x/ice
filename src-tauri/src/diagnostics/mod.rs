use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use chrono::Utc;
use once_cell::sync::OnceCell;
use serde_json::json;

static FRONTEND_LOG_PATH: OnceCell<PathBuf> = OnceCell::new();
static FRONTEND_LOG_MUTEX: OnceCell<Mutex<()>> = OnceCell::new();
const MAX_FRONTEND_LOG_BYTES: u64 = 8 * 1024 * 1024;
const ROTATED_FRONTEND_LOG_SUFFIX: &str = "frontend.log.1";

pub fn init_tracing(log_dir: &Path) {
    let _ = std::fs::create_dir_all(log_dir);
    let backend_log_path = log_dir.join("backend.log");
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(backend_log_path)
        .ok()
        .map(|file| Arc::new(Mutex::new(file)));
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_writer(move || BackendLogWriter {
            file: file.clone(),
            stdout: std::io::stdout(),
        });

    let _ = subscriber.try_init();
    let _ = FRONTEND_LOG_PATH.set(log_dir.join("frontend.log"));
    let _ = FRONTEND_LOG_MUTEX.set(Mutex::new(()));
}

struct BackendLogWriter {
    file: Option<Arc<Mutex<std::fs::File>>>,
    stdout: std::io::Stdout,
}

impl std::io::Write for BackendLogWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let written = self.stdout.write(buf)?;
        if let Some(file) = &self.file {
            let mut guard = file.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "log mutex poisoned")
            })?;
            guard.write_all(buf)?;
        }
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.stdout.flush()?;
        if let Some(file) = &self.file {
            let mut guard = file.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "log mutex poisoned")
            })?;
            guard.flush()?;
        }
        Ok(())
    }
}

pub fn append_frontend_log(
    level: &str,
    scope: &str,
    message: &str,
    context: Option<serde_json::Value>,
) -> Result<()> {
    let path = FRONTEND_LOG_PATH
        .get()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("frontend log path not initialized"))?;
    let log_mutex = FRONTEND_LOG_MUTEX
        .get()
        .ok_or_else(|| anyhow::anyhow!("frontend log mutex not initialized"))?;
    let _guard = log_mutex
        .lock()
        .map_err(|_| anyhow::anyhow!("frontend log mutex poisoned"))?;
    rotate_frontend_log_if_needed(&path)?;
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    let line = json!({
        "ts": Utc::now().to_rfc3339(),
        "level": level,
        "scope": scope,
        "message": message,
        "context": context
    });
    writeln!(file, "{line}")?;
    Ok(())
}

fn rotate_frontend_log_if_needed(path: &Path) -> Result<()> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    if metadata.len() < MAX_FRONTEND_LOG_BYTES {
        return Ok(());
    }

    let rotated = path.with_file_name(ROTATED_FRONTEND_LOG_SUFFIX);
    let _ = std::fs::remove_file(&rotated);
    std::fs::rename(path, rotated)?;
    Ok(())
}
