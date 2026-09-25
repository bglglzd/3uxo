//! Сквозная проверка Parakeet на настоящей модели (~490 МБ) и записи pyannote
//! sample. `#[ignore]` — в CI запускается явно на Windows (`-- --ignored`).
//! PARAKEET_E2E_DIR — готовый каталог данных (models/…, sample.wav) без сети.
#![cfg(feature = "parakeet")]

use uxo_core::parakeet::ParakeetTranscriber;

const SAMPLE: &str =
    "https://raw.githubusercontent.com/pyannote/pyannote-audio/develop/tutorials/assets/sample.wav";

#[test]
#[ignore = "качает модель и аудио"]
fn transcribes_english_sample() {
    let tmp = tempfile::tempdir().unwrap();
    let root = std::env::var_os("PARAKEET_E2E_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| tmp.path().to_path_buf());
    let wav = root.join("sample.wav");
    if !wav.exists() {
        uxo_core::models::download_to(SAMPLE, &wav, &|_| {}).unwrap();
    }
    let asr = ParakeetTranscriber::managed(&root, &|_| {}).unwrap();
    let segs = asr.transcribe_windowed(&wav, 15, &|_, _| {}).unwrap();
    let text: String = segs.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
    assert!(text.contains("New Jersey"), "{text}");
    assert!(text.contains("Chicago"), "{text}");
    assert!(segs.windows(2).all(|w| w[0].start_secs <= w[1].start_secs));
    assert!(segs.last().unwrap().end_secs <= 30.5);
}
