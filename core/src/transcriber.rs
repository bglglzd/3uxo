use crate::error::AppResult;
use crate::transcript::Segment;
use std::path::Path;

/// Превращает один WAV-файл в сегменты речи с таймкодами.
/// Реальная реализация на Whisper — в модуле `whisper` (за фичей `whisper`).
pub trait Transcriber: Send + Sync {
    fn transcribe(&self, wav_path: &Path) -> AppResult<Vec<Segment>>;
}

/// Мок: отдаёт заранее заданные сегменты в зависимости от имени файла
/// (`mic.wav` или иное → системные). Для тестов и сборок без Whisper.
pub struct MockTranscriber {
    mic_segments: Vec<Segment>,
    system_segments: Vec<Segment>,
}

impl MockTranscriber {
    pub fn new(mic_segments: Vec<Segment>, system_segments: Vec<Segment>) -> Self {
        Self { mic_segments, system_segments }
    }
}

impl Transcriber for MockTranscriber {
    fn transcribe(&self, wav_path: &Path) -> AppResult<Vec<Segment>> {
        let name = wav_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == "mic.wav" {
            Ok(self.mic_segments.clone())
        } else {
            Ok(self.system_segments.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(t: &str) -> Segment {
        Segment { start_secs: 0.0, end_secs: 1.0, text: t.into() }
    }

    #[test]
    fn returns_mic_vs_system_by_filename() {
        let m = MockTranscriber::new(vec![seg("я")], vec![seg("он")]);
        assert_eq!(m.transcribe(Path::new("/x/mic.wav")).unwrap()[0].text, "я");
        assert_eq!(m.transcribe(Path::new("/x/system.wav")).unwrap()[0].text, "он");
    }
}
