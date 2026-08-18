use crate::error::{AppError, AppResult};
use crate::model::Meeting;
use rusqlite::{params, Connection};

/// Хранилище встреч поверх SQLite.
pub struct Repo {
    conn: Connection,
}

impl Repo {
    /// Открывает БД по пути к файлу и создаёт схему при необходимости.
    pub fn open(db_path: &std::path::Path) -> AppResult<Self> {
        let conn = Connection::open(db_path)?;
        Self::init(conn)
    }

    /// БД в памяти — для тестов.
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                title TEXT NOT NULL,
                participants TEXT NOT NULL,
                topic TEXT NOT NULL,
                duration_secs INTEGER NOT NULL,
                folder TEXT NOT NULL,
                status TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'recorded'
            )",
            [],
        )?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    /// Идемпотентные миграции для БД, созданных прежними версиями.
    fn migrate(conn: &Connection) -> AppResult<()> {
        if !Self::column_exists(conn, "source")? {
            conn.execute(
                "ALTER TABLE meetings ADD COLUMN source TEXT NOT NULL DEFAULT 'recorded'",
                [],
            )?;
        }
        Ok(())
    }

    /// Есть ли столбец `column` в таблице meetings (через PRAGMA table_info).
    fn column_exists(conn: &Connection, column: &str) -> AppResult<bool> {
        let mut stmt = conn.prepare("PRAGMA table_info(meetings)")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn insert(&self, m: &Meeting) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO meetings
                (id, created_at, title, participants, topic, duration_secs, folder, status, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                m.id,
                m.created_at,
                m.title,
                m.participants,
                m.topic,
                m.duration_secs,
                m.folder,
                m.status,
                m.source
            ],
        )?;
        Ok(())
    }

    /// Все встречи, новейшие сверху.
    pub fn list(&self) -> AppResult<Vec<Meeting>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, created_at, title, participants, topic, duration_secs, folder, status, source
             FROM meetings ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], Self::row_to_meeting)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> AppResult<Meeting> {
        let mut stmt = self.conn.prepare(
            "SELECT id, created_at, title, participants, topic, duration_secs, folder, status, source
             FROM meetings WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_meeting)?;
        match rows.next() {
            Some(r) => Ok(r?),
            None => Err(AppError::NotFound(id.to_string())),
        }
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let n = self
            .conn
            .execute("DELETE FROM meetings WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Меняет статус встречи (например, на "transcribed").
    pub fn update_status(&self, id: &str, status: &str) -> AppResult<()> {
        let n = self.conn.execute(
            "UPDATE meetings SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Обновляет длительность встречи (после правки аудио — вырезания
    /// фрагментов или возврата к оригиналу).
    pub fn update_duration(&self, id: &str, duration_secs: u64) -> AppResult<()> {
        let n = self.conn.execute(
            "UPDATE meetings SET duration_secs = ?1 WHERE id = ?2",
            params![duration_secs, id],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// Обновляет заголовок/участников/тему встречи.
    pub fn update_meta(
        &self,
        id: &str,
        title: &str,
        participants: &str,
        topic: &str,
    ) -> AppResult<()> {
        let n = self.conn.execute(
            "UPDATE meetings SET title = ?1, participants = ?2, topic = ?3 WHERE id = ?4",
            params![title, participants, topic, id],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        Ok(())
    }

    fn row_to_meeting(row: &rusqlite::Row) -> rusqlite::Result<Meeting> {
        Ok(Meeting {
            id: row.get(0)?,
            created_at: row.get(1)?,
            title: row.get(2)?,
            participants: row.get(3)?,
            topic: row.get(4)?,
            duration_secs: u64::try_from(row.get::<_, i64>(5)?).unwrap_or(0),
            folder: row.get(6)?,
            status: row.get(7)?,
            source: row.get(8)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, created_at: &str) -> Meeting {
        Meeting {
            id: id.into(),
            created_at: created_at.into(),
            title: "t".into(),
            participants: "p".into(),
            topic: "x".into(),
            duration_secs: 10,
            folder: id.into(),
            status: "recorded".into(),
            source: "recorded".into(),
        }
    }

    #[test]
    fn insert_then_get_returns_same() {
        let repo = Repo::open_in_memory().unwrap();
        let m = sample("a", "2026-06-04T10:00:00Z");
        repo.insert(&m).unwrap();
        assert_eq!(repo.get("a").unwrap(), m);
    }

    #[test]
    fn list_orders_newest_first() {
        let repo = Repo::open_in_memory().unwrap();
        repo.insert(&sample("old", "2026-06-01T10:00:00Z")).unwrap();
        repo.insert(&sample("new", "2026-06-04T10:00:00Z")).unwrap();
        let ids: Vec<String> = repo.list().unwrap().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["new", "old"]);
    }

    #[test]
    fn get_missing_is_not_found() {
        let repo = Repo::open_in_memory().unwrap();
        assert!(matches!(repo.get("nope"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn delete_removes_row() {
        let repo = Repo::open_in_memory().unwrap();
        repo.insert(&sample("a", "2026-06-04T10:00:00Z")).unwrap();
        repo.delete("a").unwrap();
        assert!(repo.list().unwrap().is_empty());
    }

    #[test]
    fn update_status_changes_status() {
        let repo = Repo::open_in_memory().unwrap();
        repo.insert(&sample("a", "2026-06-04T10:00:00Z")).unwrap();
        repo.update_status("a", "transcribed").unwrap();
        assert_eq!(repo.get("a").unwrap().status, "transcribed");
    }

    #[test]
    fn update_status_missing_is_not_found() {
        let repo = Repo::open_in_memory().unwrap();
        assert!(matches!(repo.update_status("x", "t"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn update_duration_changes_duration() {
        let repo = Repo::open_in_memory().unwrap();
        repo.insert(&sample("a", "2026-06-04T10:00:00Z")).unwrap();
        repo.update_duration("a", 7).unwrap();
        assert_eq!(repo.get("a").unwrap().duration_secs, 7);
        assert!(matches!(
            repo.update_duration("nope", 1),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn update_meta_changes_fields() {
        let repo = Repo::open_in_memory().unwrap();
        repo.insert(&sample("a", "2026-06-04T10:00:00Z")).unwrap();
        repo.update_meta("a", "Заголовок", "Иван", "Тема").unwrap();
        let m = repo.get("a").unwrap();
        assert_eq!((m.title, m.participants, m.topic), ("Заголовок".into(), "Иван".into(), "Тема".into()));
    }

    #[test]
    fn migrates_old_schema_without_source_column() {
        // Эмулируем БД прежней версии: таблица без столбца `source`.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE meetings (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, title TEXT NOT NULL,
                participants TEXT NOT NULL, topic TEXT NOT NULL, duration_secs INTEGER NOT NULL,
                folder TEXT NOT NULL, status TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO meetings VALUES ('a','2026-06-04T10:00:00Z','t','p','x',10,'a','recorded')",
            [],
        )
        .unwrap();

        // init() должен добавить столбец и не потерять данные.
        let repo = Repo::init(conn).unwrap();
        let m = repo.get("a").unwrap();
        assert_eq!(m.source, "recorded");
        assert_eq!(m.title, "t");
    }
}
