//! Локальные модели: каталог, где лежат, скачаны ли, сколько весят.
//!
//! Модели качаются ОДИН раз в `<data_dir>/models` и дальше используются
//! офлайн. Экран «Модели» в настройках показывает статус и позволяет скачать
//! модели заранее (а не посреди первой расшифровки) или удалить ненужные.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Модель распознавания Whisper (ggml, whisper.cpp).
pub struct WhisperModel {
    /// Идентификатор (он же размер в настройках): "large-v3-turbo-q8_0" и т.п.
    pub id: &'static str,
    /// Примерный размер файла, байт (для интерфейса).
    pub approx_bytes: u64,
}

/// Модель по умолчанию: large-v3-turbo (8-бит) — качество уровня large-v3 для
/// русского при скорости и размере меньше medium (~0.9 ГБ). Квантование q8_0
/// практически без потерь и быстрее на CPU.
pub const DEFAULT_WHISPER: &str = "large-v3-turbo-q8_0";

/// Каталог поддерживаемых моделей Whisper (порядок — для интерфейса).
pub const WHISPER_MODELS: &[WhisperModel] = &[
    WhisperModel { id: "large-v3-turbo-q8_0", approx_bytes: 874_000_000 },
    WhisperModel { id: "large-v3-turbo", approx_bytes: 1_620_000_000 },
    WhisperModel { id: "large-v3", approx_bytes: 3_100_000_000 },
    WhisperModel { id: "medium", approx_bytes: 1_530_000_000 },
    WhisperModel { id: "small", approx_bytes: 488_000_000 },
    WhisperModel { id: "base", approx_bytes: 148_000_000 },
];

/// Нормализует выбранную пользователем модель: пусто → модель по умолчанию.
pub fn whisper_id(size: Option<&str>) -> &str {
    match size {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => DEFAULT_WHISPER,
    }
}

/// Каталог моделей.
pub fn models_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

/// Путь к файлу модели Whisper.
pub fn whisper_path(data_dir: &Path, id: &str) -> PathBuf {
    models_dir(data_dir).join(format!("ggml-{id}.bin"))
}

/// URL модели Whisper (официальные файлы whisper.cpp).
pub fn whisper_url(id: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{id}.bin")
}

/// Скачана ли модель Whisper полностью (не оборванный `.part`).
pub fn whisper_present(data_dir: &Path, id: &str) -> bool {
    std::fs::metadata(whisper_path(data_dir, id))
        .map(|m| m.len() > 1_000_000)
        .unwrap_or(false)
}

/// Проверка id модели, чтобы не удалить/скачать произвольный путь.
fn validate_model_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || id.contains("..")
    {
        return Err(AppError::InvalidInput(format!("bad model id: {id}")));
    }
    Ok(())
}

/// Скачивает `url` в `dst` через временный `.part` (атомарно), зовёт
/// `report(0.0..=1.0)` по мере загрузки.
pub fn download_to(url: &str, dst: &Path, report: &dyn Fn(f32)) -> AppResult<()> {
    if let Some(dir) = dst.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let resp = ureq::get(url)
        .call()
        .map_err(|e| AppError::Http(format!("download model: {e}")))?;
    let total: u64 = resp
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let tmp = dst.with_extension("part");
    {
        let mut reader = resp.into_reader();
        let mut file = std::fs::File::create(&tmp)?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut got: u64 = 0;
        let mut last = -1.0f32;
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])?;
            got += n as u64;
            if total > 0 {
                let f = got as f32 / total as f32;
                // Не чаще раза на 0.2% — события не заваливают интерфейс.
                if f - last >= 0.002 {
                    last = f;
                    report(f);
                }
            }
        }
        file.flush()?;
    }
    if total > 0 {
        let got = std::fs::metadata(&tmp)?.len();
        if got < total {
            let _ = std::fs::remove_file(&tmp);
            return Err(AppError::Http(format!(
                "download model: оборвалось ({got} из {total} байт)"
            )));
        }
    }
    std::fs::rename(&tmp, dst)?;
    Ok(())
}

/// Гарантирует модель Whisper на диске: если её нет — скачивает (прогресс
/// зовётся только при реальной загрузке). Возвращает путь.
pub fn ensure_whisper(data_dir: &Path, id: &str, on_progress: &dyn Fn(f32)) -> AppResult<PathBuf> {
    validate_model_id(id)?;
    let path = whisper_path(data_dir, id);
    if whisper_present(data_dir, id) {
        return Ok(path);
    }
    download_to(&whisper_url(id), &path, on_progress)?;
    on_progress(1.0);
    Ok(path)
}

/// Удаляет файл модели Whisper (освободить место).
pub fn delete_whisper(data_dir: &Path, id: &str) -> AppResult<()> {
    validate_model_id(id)?;
    let path = whisper_path(data_dir, id);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Статус одной модели для экрана «Модели».
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ModelInfo {
    pub id: String,
    /// "whisper" | "diarize".
    pub kind: String,
    pub installed: bool,
    /// Размер на диске (если скачана) или примерный размер загрузки, байт.
    pub bytes: u64,
}

/// Статус всех моделей: каталог Whisper + модели диаризации.
pub fn status(data_dir: &Path) -> Vec<ModelInfo> {
    let mut out: Vec<ModelInfo> = WHISPER_MODELS
        .iter()
        .map(|m| {
            let path = whisper_path(data_dir, m.id);
            let installed = whisper_present(data_dir, m.id);
            let bytes = if installed {
                std::fs::metadata(&path).map(|x| x.len()).unwrap_or(m.approx_bytes)
            } else {
                m.approx_bytes
            };
            ModelInfo { id: m.id.into(), kind: "whisper".into(), installed, bytes }
        })
        .collect();
    let diar_installed = crate::diarize::models_present(data_dir);
    out.push(ModelInfo {
        id: "voices".into(),
        kind: "diarize".into(),
        installed: diar_installed,
        bytes: if diar_installed {
            crate::diarize::models_size(data_dir)
        } else {
            33_000_000
        },
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_and_blank_map_to_turbo() {
        assert_eq!(whisper_id(None), DEFAULT_WHISPER);
        assert_eq!(whisper_id(Some("  ")), DEFAULT_WHISPER);
        assert_eq!(whisper_id(Some("medium")), "medium");
        assert!(WHISPER_MODELS.iter().any(|m| m.id == DEFAULT_WHISPER));
    }

    #[test]
    fn status_reports_installed_whisper() {
        let dir = tempfile::tempdir().unwrap();
        let st = status(dir.path());
        assert!(st.iter().all(|m| !m.installed));
        std::fs::create_dir_all(models_dir(dir.path())).unwrap();
        std::fs::write(whisper_path(dir.path(), "base"), vec![0u8; 1_000_001]).unwrap();
        let st = status(dir.path());
        let base = st.iter().find(|m| m.id == "base").unwrap();
        assert!(base.installed);
        assert_eq!(base.bytes, 1_000_001);
        assert!(st.iter().any(|m| m.kind == "diarize" && !m.installed));
        delete_whisper(dir.path(), "base").unwrap();
        assert!(!whisper_present(dir.path(), "base"));
    }

    #[test]
    fn rejects_bad_model_ids() {
        let dir = tempfile::tempdir().unwrap();
        assert!(delete_whisper(dir.path(), "../x").is_err());
        assert!(delete_whisper(dir.path(), "a/b").is_err());
        assert!(ensure_whisper(dir.path(), "", &|_| {}).is_err());
    }
}
