use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::transcript::{Speaker, Transcript};

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
        .map(|s| {
            let who = match s.speaker {
                Speaker::Me => "Я",
                Speaker::Them => "Собеседник",
            };
            format!("{who}: {}", s.text)
        })
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

/// Краткая выжимка разговора.
pub fn summarize(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    let system = "Сделай краткую структурированную выжимку разговора: ключевые темы, решения, \
        задачи и договорённости. По-русски, по делу.";
    backend.chat(system, transcript_text)
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

    /// Мок-бэкенд: отдаёт заданный ответ и запоминает последний (system,user).
    struct MockChatBackend {
        response: String,
        last: Arc<Mutex<Option<(String, String)>>>,
    }
    impl MockChatBackend {
        fn new(response: &str) -> Self {
            Self {
                response: response.into(),
                last: Arc::new(Mutex::new(None)),
            }
        }
    }
    impl ChatBackend for MockChatBackend {
        fn chat(&self, system: &str, user: &str) -> AppResult<String> {
            *self.last.lock().unwrap() = Some((system.into(), user.into()));
            Ok(self.response.clone())
        }
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
