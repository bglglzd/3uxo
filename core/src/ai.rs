use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::transcript::{speaker_label, Transcript};

/// Настройки доступа к OpenAI-совместимому ИИ.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

/// Предложение метаданных встречи от ИИ.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MetadataSuggestion {
    pub title: String,
    pub participants: String,
    pub topic: String,
}

/// Абстракция «спросить чат-модель»: даёт system+user, получает текст ответа.
pub trait ChatBackend: Send + Sync {
    fn chat(&self, system: &str, user: &str) -> AppResult<String>;
}

/// Реальный бэкенд: HTTP к {base_url}/chat/completions (OpenAI-совместимый).
pub struct HttpChatBackend {
    config: AiConfig,
}

impl HttpChatBackend {
    pub fn new(config: AiConfig) -> Self {
        Self { config }
    }
}

impl ChatBackend for HttpChatBackend {
    fn chat(&self, system: &str, user: &str) -> AppResult<String> {
        let url = format!(
            "{}/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );
        let body = serde_json::json!({
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        });
        let resp = ureq::post(&url)
            .set("Authorization", &format!("Bearer {}", self.config.api_key))
            .set("Content-Type", "application/json")
            .send_json(body)
            .map_err(|e| AppError::Http(e.to_string()))?;
        let value: serde_json::Value =
            resp.into_json().map_err(|e| AppError::Http(e.to_string()))?;
        let content = value
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .ok_or_else(|| AppError::Http("unexpected response shape".into()))?;
        Ok(content.to_string())
    }
}

/// Превращает расшифровку в простой текст для подачи модели.
pub fn transcript_to_text(transcript: &Transcript) -> String {
    transcript
        .segments
        .iter()
        .map(|s| format!("{}: {}", speaker_label(&s.speaker), s.text))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Вытаскивает первый JSON-объект из текста (модель может добавить пояснения
/// или обернуть в ```-блок).
fn extract_json(s: &str) -> &str {
    match (s.find('{'), s.rfind('}')) {
        (Some(a), Some(b)) if b >= a => &s[a..=b],
        _ => s,
    }
}

/// Просит модель предложить заголовок/участников/тему по расшифровке.
pub fn suggest_metadata(
    backend: &dyn ChatBackend,
    transcript_text: &str,
) -> AppResult<MetadataSuggestion> {
    let system = "Ты анализируешь расшифровку разговора и возвращаешь СТРОГО JSON с полями \
        title (короткий заголовок встречи), participants (участники через запятую), \
        topic (тема одним предложением). Только JSON, без пояснений.";
    let content = backend.chat(system, transcript_text)?;
    let json = extract_json(&content);
    let suggestion: MetadataSuggestion = serde_json::from_str(json)?;
    Ok(suggestion)
}

/// Краткая выжимка короткого разговора (один проход).
pub fn summarize(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    let system = "Сделай структурированную выжимку разговора в формате Markdown: \
        заголовки (##), маркированные списки, выделение важного. Разделы: краткое \
        резюме, ключевые темы, решения, задачи и договорённости. По-русски, по делу.";
    backend.chat(system, transcript_text)
}

/// Порог длины (в символах) одного фрагмента для длинной выжимки.
/// Подобрано консервативно под модели с контекстом ~130k токенов.
pub const SUMMARY_CHUNK_CHARS: usize = 60_000;

/// Разбивает текст на части не длиннее `max` символов по границам строк.
fn split_chunks(text: &str, max: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut cur = String::new();
    for line in text.lines() {
        if !cur.is_empty() && cur.len() + line.len() + 1 > max {
            chunks.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push('\n');
        }
        cur.push_str(line);
        if cur.len() >= max {
            chunks.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        chunks.push(cur);
    }
    chunks
}

/// Выжимка разговора любой длины. Короткий — один проход; длинный (не влезает
/// в контекст модели) — map-reduce: суммируем каждый фрагмент, затем объединяем
/// конспекты (рекурсивно, если их сумма всё ещё велика).
pub fn summarize_long(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    if transcript_text.len() <= SUMMARY_CHUNK_CHARS {
        return summarize(backend, transcript_text);
    }

    let chunks = split_chunks(transcript_text, SUMMARY_CHUNK_CHARS);
    let total = chunks.len();
    let mut partials = Vec::with_capacity(total);
    for (i, chunk) in chunks.iter().enumerate() {
        let system = "Ты конспектируешь ОДНУ ЧАСТЬ длинного разговора. Кратко и по делу \
            изложи ключевые моменты, решения и задачи именно из этого фрагмента. \
            По-русски. Без вступлений.";
        let user = format!("Часть {}/{} разговора:\n\n{}", i + 1, total, chunk);
        partials.push(backend.chat(system, &user)?);
    }

    let combined = partials.join("\n\n---\n\n");
    // Если конспектов всё ещё слишком много — сворачиваем ещё раз.
    if combined.len() > SUMMARY_CHUNK_CHARS {
        return summarize_long(backend, &combined);
    }

    let system = "Объедини конспекты частей одного разговора в единую связную итоговую \
        выжимку в формате Markdown: заголовки (##), списки, выделение важного. \
        Разделы: краткое резюме, ключевые темы, решения, задачи и договорённости. \
        Не повторяйся, убери дубли. По-русски.";
    backend.chat(system, &combined)
}

/// Ответ на вопрос пользователя по расшифровке.
pub fn answer_question(
    backend: &dyn ChatBackend,
    transcript_text: &str,
    question: &str,
) -> AppResult<String> {
    let system = "Отвечай на вопрос пользователя, опираясь на расшифровку разговора. \
        Если ответа в разговоре нет — так и скажи.";
    let user = format!("Расшифровка:\n{transcript_text}\n\nВопрос: {question}");
    backend.chat(system, &user)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::{merge_tracks, Segment};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// Мок-бэкенд: отдаёт заданный ответ, запоминает последний (system,user)
    /// и считает число вызовов.
    struct MockChatBackend {
        response: String,
        last: Arc<Mutex<Option<(String, String)>>>,
        calls: Arc<Mutex<usize>>,
    }
    impl MockChatBackend {
        fn new(response: &str) -> Self {
            Self {
                response: response.into(),
                last: Arc::new(Mutex::new(None)),
                calls: Arc::new(Mutex::new(0)),
            }
        }
    }
    impl ChatBackend for MockChatBackend {
        fn chat(&self, system: &str, user: &str) -> AppResult<String> {
            *self.last.lock().unwrap() = Some((system.into(), user.into()));
            *self.calls.lock().unwrap() += 1;
            Ok(self.response.clone())
        }
    }

    #[test]
    fn summarize_long_short_input_is_single_pass() {
        let b = MockChatBackend::new("итог");
        let out = summarize_long(&b, "короткий разговор").unwrap();
        assert_eq!(out, "итог");
        assert_eq!(*b.calls.lock().unwrap(), 1);
    }

    #[test]
    fn summarize_long_chunks_then_reduces() {
        // Текст заметно длиннее порога → несколько частей + финальное объединение.
        let line = "Я: довольно длинная строка разговора для проверки разбиения\n";
        let big = line.repeat((SUMMARY_CHUNK_CHARS / line.len()) * 3 + 10);
        let b = MockChatBackend::new("короткий конспект");
        let out = summarize_long(&b, &big).unwrap();
        assert_eq!(out, "короткий конспект");
        // как минимум 3 части + 1 объединение = 4 вызова
        assert!(*b.calls.lock().unwrap() >= 4, "calls={}", *b.calls.lock().unwrap());
    }

    #[test]
    fn transcript_to_text_formats_speakers() {
        let t = merge_tracks(
            vec![Segment { start_secs: 0.0, end_secs: 1.0, text: "привет".into() }],
            vec![Segment { start_secs: 1.0, end_secs: 2.0, text: "хай".into() }],
        );
        assert_eq!(transcript_to_text(&t), "Я: привет\nСобеседник: хай");
    }

    #[test]
    fn suggest_metadata_parses_plain_json() {
        let b = MockChatBackend::new(
            r#"{"title":"Созвон","participants":"Иван, Пётр","topic":"Планы"}"#,
        );
        let s = suggest_metadata(&b, "Я: ...").unwrap();
        assert_eq!(s.title, "Созвон");
        assert_eq!(s.participants, "Иван, Пётр");
        assert_eq!(s.topic, "Планы");
    }

    #[test]
    fn suggest_metadata_parses_json_in_fenced_block_with_extra_text() {
        let b = MockChatBackend::new(
            "Вот результат:\n```json\n{\"title\":\"X\",\"participants\":\"A\",\"topic\":\"Y\"}\n```\nГотово.",
        );
        let s = suggest_metadata(&b, "t").unwrap();
        assert_eq!(s.title, "X");
        assert_eq!(s.topic, "Y");
    }

    #[test]
    fn summarize_and_answer_pass_through_backend() {
        let b = MockChatBackend::new("краткая выжимка");
        assert_eq!(summarize(&b, "текст").unwrap(), "краткая выжимка");
        let last = b.last.lock().unwrap().clone().unwrap();
        assert!(last.1.contains("текст")); // user content carries transcript

        let b2 = MockChatBackend::new("ответ");
        assert_eq!(answer_question(&b2, "разговор", "вопрос?").unwrap(), "ответ");
        let last2 = b2.last.lock().unwrap().clone().unwrap();
        assert!(last2.1.contains("разговор") && last2.1.contains("вопрос?"));
    }

    /// Поднимает локальный HTTP-сервер, отвечающий OpenAI-подобным JSON.
    fn spawn_mock_server(content: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = format!(
            r#"{{"choices":[{{"message":{{"content":{}}}}}]}}"#,
            serde_json::to_string(content).unwrap()
        );
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    #[test]
    fn http_backend_sends_request_and_parses_response() {
        let base = spawn_mock_server("Привет из мок-сервера");
        let backend = HttpChatBackend::new(AiConfig {
            base_url: base,
            api_key: "k".into(),
            model: "m".into(),
        });
        let out = backend.chat("sys", "user").unwrap();
        assert_eq!(out, "Привет из мок-сервера");
    }
}
