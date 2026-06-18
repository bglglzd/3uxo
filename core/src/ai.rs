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
    #[serde(default, deserialize_with = "string_or_seq")]
    pub title: String,
    #[serde(default, deserialize_with = "string_or_seq")]
    pub participants: String,
    #[serde(default, deserialize_with = "string_or_seq")]
    pub topic: String,
}

/// Модель иногда возвращает поле массивом (напр. participants: ["A","B"]) или
/// числом вместо строки — приводим к строке (массив → через запятую). Иначе
/// serde падает «invalid type: sequence, expected a string».
fn string_or_seq<'de, D>(de: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(de)?;
    Ok(match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => String::new(),
        serde_json::Value::Array(a) => a
            .into_iter()
            .map(|x| match x {
                serde_json::Value::String(s) => s,
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(", "),
        other => other.to_string(),
    })
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

/// Краткое резюме (TL;DR) — несколько предложений (один проход).
pub fn brief_summary(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    let system = "Дай очень краткое резюме разговора: 2–4 предложения о том, о чём шла \
        речь и какой главный итог. Без списков и заголовков, по-русски, по делу.";
    backend.chat(system, transcript_text)
}

/// Краткое резюме для разговора любой длины: длинный сначала сворачиваем в
/// выжимку (map-reduce), затем сжимаем до 2–4 предложений.
pub fn brief_summary_long(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    if transcript_text.len() <= SUMMARY_CHUNK_CHARS {
        return brief_summary(backend, transcript_text);
    }
    let digest = summarize_long(backend, transcript_text)?;
    let system = "Сожми эту выжимку до очень краткого резюме в 2–4 предложения: главная \
        суть и итог. Без списков и заголовков, по-русски.";
    backend.chat(system, &digest)
}

/// Аналитический разбор разговора (один проход).
pub fn analyze(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    let system = "Сделай аналитический разбор разговора в формате Markdown: позиции и \
        интересы сторон, ключевые аргументы, тон/настроение, принятые решения и \
        договорённости, открытые вопросы и разногласия, риски, рекомендуемые следующие \
        шаги. Заголовки (##) и списки. Опирайся только на сказанное, ничего не выдумывай. \
        По-русски.";
    backend.chat(system, transcript_text)
}

/// ИИ-анализ для разговора любой длины (map-reduce, как выжимка).
pub fn analyze_long(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    if transcript_text.len() <= SUMMARY_CHUNK_CHARS {
        return analyze(backend, transcript_text);
    }
    let chunks = split_chunks(transcript_text, SUMMARY_CHUNK_CHARS);
    let total = chunks.len();
    let mut partials = Vec::with_capacity(total);
    for (i, chunk) in chunks.iter().enumerate() {
        let system = "Проанализируй ОДНУ ЧАСТЬ длинного разговора: позиции сторон, \
            ключевые моменты, решения, разногласия и риски именно этого фрагмента. \
            По-русски, без вступлений.";
        let user = format!("Часть {}/{} разговора:\n\n{}", i + 1, total, chunk);
        partials.push(backend.chat(system, &user)?);
    }
    let combined = partials.join("\n\n---\n\n");
    if combined.len() > SUMMARY_CHUNK_CHARS {
        return analyze_long(backend, &combined);
    }
    let system = "Объедини анализы частей разговора в единый аналитический разбор \
        (Markdown: ## и списки): позиции сторон, ключевые аргументы, решения, открытые \
        вопросы, риски, следующие шаги. Без повторов и дублей. По-русски.";
    backend.chat(system, &combined)
}

/// Переписывает расшифровку в связный литературный текст (один проход).
pub fn to_literary_text(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    let system = "Перепиши расшифровку разговора в связный, гладкий литературный текст. \
        Сохрани ВСЕ обсуждаемые факты, детали, имена, числа и смысл; ничего не \
        выдумывай и не добавляй того, чего не было. Убери оговорки, повторы, \
        слова-паразиты и обрывы фраз. Оформи абзацами, по-русски. Без заголовков \
        и без вступлений вроде «в этом разговоре» — сразу текст.";
    backend.chat(system, transcript_text)
}

/// Литературный текст для разговора любой длины. Короткий — один проход;
/// длинный — переписываем каждую часть и СКЛЕИВАЕМ (не сворачиваем, в отличие
/// от выжимки), чтобы сохранить полноту изложения.
pub fn to_literary_long(backend: &dyn ChatBackend, transcript_text: &str) -> AppResult<String> {
    if transcript_text.len() <= SUMMARY_CHUNK_CHARS {
        return to_literary_text(backend, transcript_text);
    }
    let chunks = split_chunks(transcript_text, SUMMARY_CHUNK_CHARS);
    let total = chunks.len();
    let mut parts = Vec::with_capacity(total);
    for (i, chunk) in chunks.iter().enumerate() {
        let system = "Перепиши ЭТУ ЧАСТЬ разговора в связный литературный текст, \
            сохраняя все детали, факты и смысл именно этого фрагмента. Убери оговорки, \
            повторы и слова-паразиты. Без вступлений и выводов — только переложение \
            этой части. Оформи абзацами, по-русски.";
        let user = format!("Часть {}/{} разговора:\n\n{}", i + 1, total, chunk);
        parts.push(backend.chat(system, &user)?);
    }
    Ok(parts.join("\n\n"))
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
    fn suggest_metadata_tolerates_array_field() {
        // Модель вернула participants массивом — раньше это роняло десериализацию.
        let b = MockChatBackend::new(
            r#"{"title":"Созвон","participants":["Иван","Пётр"],"topic":"Планы"}"#,
        );
        let s = suggest_metadata(&b, "t").unwrap();
        assert_eq!(s.title, "Созвон");
        assert_eq!(s.participants, "Иван, Пётр");
        assert_eq!(s.topic, "Планы");
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

    #[test]
    fn brief_and_analyze_short_are_single_pass() {
        let b = MockChatBackend::new("кратко");
        assert_eq!(brief_summary_long(&b, "короткий разговор").unwrap(), "кратко");
        assert_eq!(*b.calls.lock().unwrap(), 1);

        let a = MockChatBackend::new("анализ");
        assert_eq!(analyze_long(&a, "короткий разговор").unwrap(), "анализ");
        assert_eq!(*a.calls.lock().unwrap(), 1);
    }

    #[test]
    fn literary_short_is_single_pass() {
        let b = MockChatBackend::new("связный текст");
        let out = to_literary_long(&b, "Я: привет\nСобеседник: здравствуй").unwrap();
        assert_eq!(out, "связный текст");
        assert_eq!(*b.calls.lock().unwrap(), 1);
    }

    #[test]
    fn literary_long_rewrites_each_chunk_and_joins() {
        let line = "Я: довольно длинная строка разговора для проверки разбиения\n";
        let big = line.repeat((SUMMARY_CHUNK_CHARS / line.len()) * 2 + 10);
        let b = MockChatBackend::new("часть");
        let out = to_literary_long(&b, &big).unwrap();
        // Склейка (не сворачивание): несколько частей через пустую строку.
        assert!(out.contains("часть\n\nчасть"), "joined output: {out:?}");
        assert!(*b.calls.lock().unwrap() >= 2);
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
