//! Сквозная проверка диаризации на настоящих моделях (ONNX Runtime) и
//! эталонной записи pyannote (2 голоса, разметка RTTM). Качает ~40 МБ, поэтому
//! `#[ignore]`: в CI запускается явно (`-- --ignored`), в т.ч. на Windows —
//! это проверяет и статическую линковку ONNX Runtime, и точность.
#![cfg(feature = "diarize")]

use uxo_core::cluster::{cluster_windows, count_speakers};
use uxo_core::diarize::OnnxDiarizer;

const SAMPLE: &str =
    "https://raw.githubusercontent.com/pyannote/pyannote-audio/develop/tutorials/assets/sample.wav";

/// Эталон pyannote sample.rttm: (начало, длительность, говорящий).
const RTTM: &[(f64, f64, &str)] = &[
    (6.690, 0.430, "A"),
    (7.550, 0.800, "B"),
    (8.320, 1.700, "A"),
    (9.920, 0.960, "B"),
    (10.570, 4.130, "A"),
    (14.490, 3.430, "B"),
    (18.050, 3.440, "A"),
    (18.150, 0.440, "B"),
    (21.780, 6.720, "B"),
    (27.850, 2.150, "A"),
];

#[test]
#[ignore = "качает модели и аудио"]
fn diarizes_pyannote_sample_into_two_voices() {
    // DIAR_E2E_DIR — готовый каталог (models/diarize + sample.wav) для запуска
    // без сети; иначе всё качается во временный каталог.
    let tmp = tempfile::tempdir().unwrap();
    let root = std::env::var_os("DIAR_E2E_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| tmp.path().to_path_buf());
    let wav = root.join("sample.wav");
    if !wav.exists() {
        uxo_core::models::download_to(SAMPLE, &wav, &|_| {}).unwrap();
    }

    let d = OnnxDiarizer::managed(&root, None, &|_| {}).unwrap();
    let windows = d.embed(&wav, &|_, _| {}).unwrap();
    assert!(windows.len() >= 4, "мало фрагментов речи: {}", windows.len());
    let labels = cluster_windows(&windows, None);
    assert_eq!(count_speakers(&labels), 2, "число голосов");

    // Точность: доля времени (где по эталону говорит ровно один), размеченного
    // верно при лучшем сопоставлении меток.
    let mut conf = std::collections::HashMap::<(&str, u32), usize>::new();
    let mut frames = 0usize;
    let mut t = 0.0;
    while t < 30.0 {
        let refs: Vec<&str> = RTTM
            .iter()
            .filter(|r| r.0 <= t && t < r.0 + r.1)
            .map(|r| r.2)
            .collect();
        if refs.len() == 1 {
            frames += 1;
            if let Some(i) = windows
                .iter()
                .position(|w| w.spans().iter().any(|&(a, b)| a <= t && t < b))
            {
                *conf.entry((refs[0], labels[i])).or_default() += 1;
            }
        }
        t += 0.01;
    }
    let direct = conf.get(&("A", 0)).copied().unwrap_or(0) + conf.get(&("B", 1)).copied().unwrap_or(0);
    let swapped = conf.get(&("A", 1)).copied().unwrap_or(0) + conf.get(&("B", 0)).copied().unwrap_or(0);
    let acc = direct.max(swapped) as f64 / frames as f64;
    assert!(acc > 0.9, "точность разметки {acc:.3}");

    // Явно заданное число голосов соблюдается.
    assert_eq!(count_speakers(&cluster_windows(&windows, Some(1))), 1);
    assert_eq!(count_speakers(&cluster_windows(&windows, Some(3))), 3);
}
