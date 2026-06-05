use serde::{Deserialize, Serialize};

/// Кто говорит: «Я» (микрофон) или «Собеседник» (системный звук).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Speaker {
    Me,
    Them,
}

/// Сырой сегмент от транскрайбера (одна дорожка).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub start_secs: f64,
    pub end_secs: f64,
    pub text: String,
}

/// Сегмент итоговой ленты, с говорящим.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptSegment {
    pub speaker: Speaker,
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
            speaker: Speaker::Me,
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
            speaker: Speaker::Them,
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
        let order: Vec<(&Speaker, &str)> =
            t.segments.iter().map(|s| (&s.speaker, s.text.as_str())).collect();
        assert_eq!(
            order,
            vec![
                (&Speaker::Me, "привет"),
                (&Speaker::Them, "здравствуй"),
                (&Speaker::Me, "как дела"),
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
        assert_eq!(t.segments[0].speaker, Speaker::Me);
        assert_eq!(t.segments[1].speaker, Speaker::Them);
    }

    #[test]
    fn transcript_round_trips_json() {
        let t = merge_tracks(vec![seg(0.0, "hi")], vec![]);
        let json = serde_json::to_string(&t).unwrap();
        let back: Transcript = serde_json::from_str(&json).unwrap();
        assert_eq!(t, back);
    }
}
