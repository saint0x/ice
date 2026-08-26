use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct IcePaths {
    root: PathBuf,
    db_path: PathBuf,
}

impl IcePaths {
    pub fn from_app(app: &AppHandle) -> Result<Self> {
        let preferred_root = app
            .path()
            .app_data_dir()
            .context("failed to resolve Ice app data directory")?
            .join("storage");
        let legacy_root = dirs::home_dir().map(|home| home.join(".ice"));
        Self::resolve_storage_root(preferred_root, legacy_root)
    }

    pub fn resolve_storage_root(
        preferred_root: PathBuf,
        legacy_root: Option<PathBuf>,
    ) -> Result<Self> {
        if !preferred_root.exists() {
            if let Some(legacy_root) =
                legacy_root.filter(|candidate| has_persisted_state(candidate))
            {
                copy_storage_tree(&legacy_root, &preferred_root).with_context(|| {
                    format!(
                        "failed to migrate Ice storage from '{}' to '{}'",
                        legacy_root.display(),
                        preferred_root.display()
                    )
                })?;
            }
        }
        Ok(Self::from_root(preferred_root))
    }

    pub fn from_root(root: PathBuf) -> Self {
        let db_path = root.join("ice.db");
        Self { root, db_path }
    }

    pub fn ensure_layout(&self) -> Result<()> {
        std::fs::create_dir_all(&self.root)?;
        for concern in [
            "projects",
            "workspace",
            "browser",
            "terminal",
            "codex",
            "diagnostics",
        ] {
            std::fs::create_dir_all(self.concern_dir(concern))?;
        }
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn concern_dir(&self, concern: &str) -> PathBuf {
        self.root.join(concern)
    }
}

fn has_persisted_state(root: &Path) -> bool {
    root.join("ice.db").is_file()
        || [
            "projects",
            "workspace",
            "browser",
            "terminal",
            "codex",
            "diagnostics",
        ]
        .iter()
        .any(|concern| root.join(concern).exists())
}

fn copy_storage_tree(from: &Path, to: &Path) -> Result<()> {
    if !from.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let destination = to.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_storage_tree(&source, &destination)?;
        } else if file_type.is_file() {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&source, &destination)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::IcePaths;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn builds_expected_layout_from_root() {
        let paths = IcePaths::from_root(PathBuf::from("/tmp/ice-root"));
        assert_eq!(paths.root(), PathBuf::from("/tmp/ice-root"));
        assert_eq!(paths.db_path(), PathBuf::from("/tmp/ice-root/ice.db"));
        assert_eq!(
            paths.concern_dir("browser"),
            PathBuf::from("/tmp/ice-root/browser")
        );
    }

    #[test]
    fn ensures_layout_creates_canonical_concerns() {
        let temp = tempdir().expect("temp dir");
        let root = temp.path().join(".ice");
        let paths = IcePaths::from_root(root.clone());

        paths.ensure_layout().expect("ensure layout");

        assert!(root.is_dir());
        assert!(paths.db_path().ends_with("ice.db"));
        for concern in [
            "projects",
            "workspace",
            "browser",
            "terminal",
            "codex",
            "diagnostics",
        ] {
            assert!(
                paths.concern_dir(concern).is_dir(),
                "missing concern dir {concern}"
            );
        }
    }

    #[test]
    fn resolve_storage_root_migrates_legacy_state_once() {
        let temp = tempdir().expect("temp dir");
        let legacy_root = temp.path().join("legacy");
        let preferred_root = temp.path().join("preferred");
        std::fs::create_dir_all(legacy_root.join("codex/sessions")).expect("legacy codex dir");
        std::fs::write(legacy_root.join("ice.db"), b"db").expect("legacy db");
        std::fs::write(
            legacy_root.join("codex/sessions/history.jsonl"),
            b"thread history",
        )
        .expect("legacy history");

        let paths = IcePaths::resolve_storage_root(preferred_root.clone(), Some(legacy_root))
            .expect("resolved paths");

        assert_eq!(paths.root(), preferred_root.as_path());
        assert_eq!(
            std::fs::read(preferred_root.join("ice.db")).expect("copied db"),
            b"db"
        );
        assert_eq!(
            std::fs::read(preferred_root.join("codex/sessions/history.jsonl"))
                .expect("copied history"),
            b"thread history"
        );
    }

    #[test]
    fn resolve_storage_root_keeps_existing_preferred_state() {
        let temp = tempdir().expect("temp dir");
        let legacy_root = temp.path().join("legacy");
        let preferred_root = temp.path().join("preferred");
        std::fs::create_dir_all(&legacy_root).expect("legacy dir");
        std::fs::create_dir_all(&preferred_root).expect("preferred dir");
        std::fs::write(legacy_root.join("ice.db"), b"legacy").expect("legacy db");
        std::fs::write(preferred_root.join("ice.db"), b"preferred").expect("preferred db");

        IcePaths::resolve_storage_root(preferred_root.clone(), Some(legacy_root))
            .expect("resolved paths");

        assert_eq!(
            std::fs::read(preferred_root.join("ice.db")).expect("preferred db"),
            b"preferred"
        );
    }
}
