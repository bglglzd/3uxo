mod commands;

use std::sync::Mutex;

use commands::AppState;
use uxo_core::recorder::Recorder;
use uxo_core::storage::Repo;

/// Выбирает рекордер: настоящий WASAPI на Windows, иначе — мок (тишина).
fn build_recorder() -> Box<dyn Recorder> {
    #[cfg(target_os = "windows")]
    {
        Box::new(uxo_core::wasapi_recorder::WasapiRecorder::new())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Box::new(uxo_core::recorder::MockRecorder::new(5))
    }
}

/// Переключает запись и сообщает фронтенду событием `recording-changed`.
/// Используется горячей клавишей и пунктом трея.
fn toggle_and_notify<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::{Emitter, Manager};
    let state = app.state::<AppState>();
    match commands::toggle_recording_state(&state) {
        Ok(now_recording) => {
            let _ = app.emit("recording-changed", now_recording);
            use tauri_plugin_notification::NotificationExt;
            let (title, body) = if now_recording {
                ("🔴 3uxo — запись начата", "Идёт запись звонка")
            } else {
                ("✅ 3uxo — запись остановлена", "Запись сохранена")
            };
            let _ = app.notification().builder().title(title).body(body).show();
        }
        Err(e) => {
            let _ = app.emit("recording-error", e.to_string());
        }
    }
}

/// Регистрирует глобальную горячую клавишу Ctrl+Shift+R (старт/стоп записи).
fn setup_global_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyR);
    app.global_shortcut().register(shortcut)?;
    Ok(())
}

/// Создаёт значок в трее с меню: старт/стоп, открыть окно, выход.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::Manager;

    let toggle_i = MenuItem::with_id(app, "toggle", "Старт/Стоп записи", true, None::<&str>)?;
    let open_i = MenuItem::with_id(app, "open", "Открыть 3uxo", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle_i, &open_i, &quit_i])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "toggle" => toggle_and_notify(app),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_and_notify(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            use tauri::Manager;
            let data_root = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_root).expect("cannot create data dir");
            // Panic-hook пишет в файл лога — переживает нативный краш.
            let log_path = data_root.join("3uxo.log");
            std::panic::set_hook(Box::new(move |info| {
                use std::io::Write;
                let line = format!(
                    "[panic] {}\n  location: {:?}\n",
                    info,
                    info.location()
                );
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    let _ = f.write_all(line.as_bytes());
                }
            }));

            let db_path = data_root.join("3uxo.db");
            let repo = Repo::open(&db_path).expect("cannot open db");

            app.manage(AppState {
                data_root,
                repo: Mutex::new(repo),
                recorder: build_recorder(),
                active: Mutex::new(None),
            });

            setup_global_shortcut(app)?;
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::stop_recording,
            commands::list_meetings,
            commands::get_meeting,
            commands::delete_meeting,
            commands::track_path,
            commands::is_recording,
            commands::transcribe,
            commands::get_transcript,
            commands::suggest_metadata,
            commands::summarize,
            commands::get_summary,
            commands::ask,
            commands::update_meeting_meta,
            commands::save_text_file,
            commands::get_backend_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
