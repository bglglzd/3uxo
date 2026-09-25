//! Compatibility with installations made before the complete Auris rename.
//! Run before creating the WebView or opening the application database.
use std::{fs, io, path::Path};

fn copy_tree(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let destination = target.join(entry.file_name());
        if kind.is_symlink() {
            return Err(io::Error::other("legacy data contains a symbolic link"));
        } else if kind.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else {
            fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

/// Stage a complete copy before publishing it. Never merge or replace a current
/// installation. Originals remain available for rollback. Close the old app first.
pub fn migrate_directory(parent: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let old = parent.join("com.3uxo.app");
    let new = parent.join("com.auris.app");
    if new.exists() || !old.is_dir() {
        return Ok(());
    }
    // A fresh staging directory also makes a retry after interrupted copying safe.
    let stage = tempfile::Builder::new()
        .prefix("auris-migration-")
        .tempdir_in(parent)?;
    copy_tree(&old, stage.path())?;
    let db = stage.path().join("3uxo.db");
    if db.exists() {
        // SQLite reads any copied WAL/journal before renaming the database.
        let mut conn = rusqlite::Connection::open(&db)?;
        let transaction = conn.transaction()?;
        let updates = {
            let mut statement = transaction.prepare("SELECT id, folder FROM meetings")?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for (id, folder) in updates {
            if let Ok(relative) = Path::new(&folder).strip_prefix(&old) {
                transaction.execute(
                    "UPDATE meetings SET folder = ?1 WHERE id = ?2",
                    rusqlite::params![new.join(relative).to_string_lossy(), id],
                )?;
            }
        }
        transaction.commit()?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")?;
        conn.close().map_err(|(_, error)| error)?;
        fs::rename(db, stage.path().join("auris.db"))?;
    }
    let log = stage.path().join("3uxo.log");
    if log.exists() {
        fs::rename(log, stage.path().join("auris.log"))?;
    }
    fs::rename(stage.path(), &new)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_database_audio_and_webview_without_overwriting_or_removing_originals() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("com.3uxo.app");
        let new = root.path().join("com.auris.app");
        fs::create_dir_all(old.join("meetings/one")).unwrap();
        fs::create_dir_all(old.join("EBWebView/Default")).unwrap();
        fs::write(old.join("meetings/one/mic.wav"), b"audio").unwrap();
        fs::write(old.join("EBWebView/Default/preferences"), b"prefs").unwrap();
        fs::write(old.join("3uxo.log"), b"log").unwrap();
        let conn = rusqlite::Connection::open(old.join("3uxo.db")).unwrap();
        conn.execute_batch("CREATE TABLE meetings (id TEXT PRIMARY KEY, folder TEXT);")
            .unwrap();
        conn.execute(
            "INSERT INTO meetings VALUES ('one', ?1)",
            [old.join("meetings/one").to_string_lossy()],
        )
        .unwrap();
        drop(conn);
        migrate_directory(root.path()).unwrap();
        let conn = rusqlite::Connection::open(new.join("auris.db")).unwrap();
        let folder: String = conn
            .query_row("SELECT folder FROM meetings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(Path::new(&folder), new.join("meetings/one"));
        assert_eq!(
            fs::read(new.join("meetings/one/mic.wav")).unwrap(),
            b"audio"
        );
        assert!(new.join("EBWebView/Default/preferences").exists());
        assert!(new.join("auris.log").exists());
        assert!(old.join("3uxo.db").exists());
        fs::write(new.join("auris.log"), b"new log").unwrap();
        migrate_directory(root.path()).unwrap();
        assert_eq!(fs::read(new.join("auris.log")).unwrap(), b"new log");
    }

    #[test]
    fn fresh_install_does_not_create_data() {
        let root = tempfile::tempdir().unwrap();
        migrate_directory(root.path()).unwrap();
        assert!(!root.path().join("com.auris.app").exists());
    }
}
