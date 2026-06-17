use serde::{Deserialize, Serialize};

/// Идентификатор говорящего в ленте. Для записанных встреч это `"me"`
/// (микрофон) и `"them"` (системный звук); для импортированных записей —
/// `"spk0"`, `"spk1"`, … после диаризации (или один `"spk0"` без неё).
/// Хранится строкой: модель расширяема на N говорящих, а старые
/// `transcript.json` (где `speaker` уже сериализовался в `"me"`/`"them"`)
/// читаются без изменений.
pub const ME: &str = "me";
pub const THEM: &str = "them";

/// Человеко-читаемая подпись говорящего по его id.
pub fn speaker_label(id: &str) -> String {
    match id {
        ME => "Я".to_string(),
        THEM => "Собеседник".to_string(),
        other => match other.strip_prefix("spk").and_then(|n| n.parse::<usize>().ok()) {
            Some(n) => format!("Спикер {}", n + 1),
            None => other.to_string(),
        },
    }
}

/// Сырой сегмент от транскрайбера (одна дорожка).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub start_secs: f64,
    pub end_secs: f64,
    pub text: String,
}

/// Сегмент итоговой ленты, с говорящим (id, см. [`speaker_label`]).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptSegment {
    pub speaker: String,
    pub start_secs: f64,
    pub end_secs: f64,
    pub text: String,
}

/// Полная расшифровка встречи.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Transcript {
    pub segments: Vec<TranscriptSegment>,
}

/// Объединяет сегменты микрофона («Я») и системного звука («Собеседник»)
/// в единую ленту, отсортированную по времени начала. Пустые тексты
/// пропускаются. Сортировка стабильна: при равном времени «Я» идёт раньше.
pub fn merge_tracks(mic: Vec<Segment>, system: Vec<Segment>) -> Transcript {
    let mut segments: Vec<TranscriptSegment> = Vec::new();
    for s in mic {
        if s.text.trim().is_empty() {
            continue;
        }
        segments.push(TranscriptSegment {
            speaker: ME.to_string(),
            start_secs: s.start_secs,
            end_secs: s.end_secs,
            text: s.text,
        });
    }
    for s in system {
        if s.text.trim().is_empty() {
            continue;
        }
        segments.push(TranscriptSegment {
            speaker: THEM.to_string(),
            start_secs: s.start_secs,
            end_secs: s.end_secs,
            text: s.text,
        });
    }
    segments.sort_by(|a, b| {
        a.start_secs
            .partial_cmp(&b.start_secs)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Transcript { segments }
}

/// Строит ленту из ОДНОЙ дорожки: всем сегментам присваивается один говорящий
/// `speaker`. Пустые тексты пропускаются. Для импортированных записей без
/// диаризации (один голос); диаризация на несколько говорящих появится в M3.
pub fn single_speaker(segments: Vec<Segment>, speaker: &str) -> Transcript {
    let segments = segments
        .into_iter()
        .filter(|s| !s.text.trim().is_empty())
        .map(|s| TranscriptSegment {
            speaker: speaker.to_string(),
            start_secs: s.start_secs,
            end_secs: s.end_secs,
            text: s.text,
        })
        .collect();
    Transcript { segments }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f64, text: &str) -> Segment {
        Segment { start_secs: start, end_secs: start + 1.0, text: text.into() }
    }

    #[test]
    fn merges_and_orders_by_start_time() {
        let mic = vec![seg(0.0, "привет"), seg(4.0, "как дела")];
        let system = vec![seg(2.0, "здравствуй")];
        let t = merge_tracks(mic, system);
        let order: Vec<(&str, &str)> =
            t.segments.iter().map(|s| (s.speaker.as_str(), s.text.as_str())).collect();
        assert_eq!(
            order,
            vec![
                ("me", "привет"),
                ("them", "здравствуй"),
                ("me", "как дела"),
            ]
        );
    }

    #[test]
    fn skips_empty_text() {
        let mic = vec![seg(0.0, "  "), seg(1.0, "ok")];
        let t = merge_tracks(mic, vec![]);
        assert_eq!(t.segments.len(), 1);
        assert_eq!(t.segments[0].text, "ok");
    }

    #[test]
    fn tie_breaks_me_before_them() {
        let mic = vec![seg(1.0, "я")];
        let system = vec![seg(1.0, "он")];
        let t = merge_tracks(mic, system);
        assert_eq!(t.segments[0].speaker, "me");
        assert_eq!(t.segments[1].speaker, "them");
    }

    #[test]
    fn single_speaker_assigns_one_and_skips_empty() {
        let segs = vec![seg(0.0, "первая"), seg(1.0, "  "), seg(2.0, "вторая")];
        let t = single_speaker(segs, "spk0");
        assert_eq!(t.segments.len(), 2);
        assert!(t.segments.iter().all(|s| s.speaker == "spk0"));
    }

    #[test]
    fn speaker_label_maps_known_and_spk() {
        assert_eq!(speaker_label("me"), "Я");
        assert_eq!(speaker_label("them"), "Собеседник");
        assert_eq!(speaker_label("spk0"), "Спикер 1");
        assert_eq!(speaker_label("spk2"), "Спикер 3");
        assert_eq!(speaker_label("custom"), "custom");
    }

    #[test]
    fn transcript_round_trips_json() {
        let t = merge_tracks(vec![seg(0.0, "hi")], vec![]);
        let json = serde_json::to_string(&t).unwrap();
        let back: Transcript = serde_json::from_str(&json).unwrap();
        assert_eq!(t, back);
    }
}
