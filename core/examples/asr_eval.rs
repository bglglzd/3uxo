//! Отладочный стенд Parakeet: расшифровывает файлы и печатает реплики.
//! `cargo run --release -p uxo-core --features parakeet --example asr_eval -- <data_dir> <audio>...`

use std::path::Path;

use uxo_core::parakeet::ParakeetTranscriber;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data_dir = Path::new(&args[1]);
    let t0 = std::time::Instant::now();
    let asr = ParakeetTranscriber::managed(data_dir, &|f| eprint!("\rdownload {:.0}%", f * 100.0))
        .expect("model");
    println!("загрузка модели: {:.1} c", t0.elapsed().as_secs_f32());
    for src in &args[2..] {
        let tmp = std::env::temp_dir().join("asr_eval_16k.wav");
        uxo_core::decode::decode_to_wav_16k_mono(Path::new(src), &tmp).expect("decode");
        let t = std::time::Instant::now();
        let segs = asr.transcribe_windowed(&tmp, 30, &|_, _| {}).expect("asr");
        println!("== {src} ({:.1} c)", t.elapsed().as_secs_f32());
        for s in segs {
            println!("  [{:6.2}-{:6.2}] {}", s.start_secs, s.end_secs, s.text);
        }
    }
}
