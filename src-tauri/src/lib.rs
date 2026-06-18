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
                ("🔴 Auris — запись начата", "Идёт запись звонка")
            } else {
                ("✅ Auris — запись остановлена", "Запись сохранена")
            };
            let _ = app.notification().builder().title(title).body(body).show();
        }
        Err(e) => {
            let _ = app.emit("recording-error", e.to_string());
        }
    }
}

/// Регистрирует глобальную горячую клавишу по умолчанию (Ctrl+Shift+R) —
/// работает сразу при старте, до загрузки фронтенда. Фронтенд при загрузке
/// перерегистрирует сохранённое сочетание через `update_hotkey`.
fn setup_global_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyR);
    app.global_shortcut().register(shortcut)?;
    Ok(())
}

/// Меняет глобальную горячую клавишу старт/стоп записи. Снимает все прежние и
/// регистрирует новую из акселератора (напр. "Ctrl+Shift+R"). Пустая строка
/// или None — выключает хоткей. Обработчик (toggle_and_notify) общий для любого
/// зарегистрированного сочетания.
#[tauri::command]
fn update_hotkey(app: tauri::AppHandle, accelerator: Option<String>) -> Result<(), String> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if let Some(acc) = accelerator {
        let acc = acc.trim();
        if !acc.is_empty() {
            let shortcut = Shortcut::from_str(acc)
                .map_err(|e| format!("неверное сочетание «{acc}»: {e}"))?;
            gs.register(shortcut).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Создаёт значок в трее с меню: старт/стоп, открыть окно, выход.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::Manager;

    let toggle_i = MenuItem::with_id(app, "toggle", "Старт/Стоп записи", true, None::<&str>)?;
    let open_i = MenuItem::with_id(app, "open", "Открыть Auris", true, None::<&str>)?;
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

/// Фоновый монитор авто-записи: каждые ~2.5с проверяет аудио-сессии выбранных
/// приложений (`AppState.autorecord`) и стартует/стопит запись. Останавливает
/// только то, что начал сам (`auto_active`), не трогая ручную запись.
fn spawn_autorecord_monitor<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    use tauri::Manager;
    std::thread::spawn(move || {
        let mut auto_active = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(2500));
            let (enabled, processes, auto_stop) = {
                // Привязываем State к переменной: иначе временное значение из
                // app.state() дропается до использования гарда (E0716).
                let state = app.state::<AppState>();
                let cfg = state.autorecord.lock().unwrap();
                (cfg.enabled, cfg.processes.clone(), cfg.auto_stop)
            };
            if !enabled || processes.is_empty() {
                auto_active = false;
                continue;
            }
            let recording = {
                let state = app.state::<AppState>();
                let active = state.active.lock().unwrap();
                active.is_some()
            };
            // Ручная остановка извне — сбрасываем флаг авто-записи.
            if !recording {
                auto_active = false;
            }
            let call = uxo_core::call_detector::any_active_call(&processes);
            if call && !recording {
                toggle_and_notify(&app);
                auto_active = true;
            } else if !call && recording && auto_active && auto_stop {
                toggle_and_notify(&app);
                auto_active = false;
            }
        }
    });
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
                autorecord: std::sync::Arc::new(Mutex::new(
                    commands::AutoRecordCfg::default(),
                )),
            });

            setup_global_shortcut(app)?;
            setup_tray(app)?;
            spawn_autorecord_monitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::stop_recording,
            commands::import_recording,
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
            commands::literary_text,
            commands::get_literary,
            commands::brief_summary,
            commands::get_brief,
            commands::analyze,
            commands::get_analysis,
            commands::ask,
            commands::update_meeting_meta,
            commands::save_text_file,
            commands::export_audio,
            commands::get_backend_log,
            commands::set_autorecord,
            update_hotkey,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
