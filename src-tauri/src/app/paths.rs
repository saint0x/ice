use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct IcePaths {
    root: PathBuf,
    db_path: PathBuf,
}

impl IcePaths {
    pub fn from_home_dir() -> Result<Self> {
        let home = dirs::home_dir().context("failed to resolve home directory")?;
        Ok(Self::from_root(home.join(".ice")))
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
}
