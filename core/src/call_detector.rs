//! Детект активного звонка по аудио-сессиям приложений.
//!
//! На Windows перечисляет аудио-сессии устройств ввода (микрофон) и вывода и
//! проверяет, есть ли АКТИВНАЯ сессия у одного из отслеживаемых процессов —
//! надёжный признак идущего звонка (приложение реально использует звук).
//! На прочих ОС — заглушка. Тяжёлого рантайма нет, фича-флаг не нужен.
//!
//! # СТАТУС: не проверено в рантайме на машине разработки
//! COM-код нельзя собрать/запустить без Windows. Компиляция проверяется через
//! CI (job check-app), реальная работа — вручную на Windows.

/// `true`, если у одного из процессов `processes` (имена `.exe`,
/// регистронезависимо) есть активная аудио-сессия.
pub fn any_active_call(processes: &[String]) -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_impl::any_active_call(processes).unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = processes;
        false
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::collections::HashSet;

    use windows::core::Interface;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, FALSE, MAX_PATH};
    use windows::Win32::Media::Audio::{
        eCapture, eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2,
        IAudioSessionEnumerator, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    pub fn any_active_call(processes: &[String]) -> windows::core::Result<bool> {
        if processes.is_empty() {
            return Ok(false);
        }
        let wanted: HashSet<String> = processes.iter().map(|p| p.to_lowercase()).collect();

        unsafe {
            // COM на этом потоке. S_FALSE (уже инициализирован) — это успех.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;

            for flow in [eCapture, eRender] {
                let device = match enumerator.GetDefaultAudioEndpoint(flow, eMultimedia) {
                    Ok(d) => d,
                    Err(_) => continue, // нет устройства этого типа
                };
                let mgr: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
                let sessions: IAudioSessionEnumerator = mgr.GetSessionEnumerator()?;
                let count = sessions.GetCount()?;
                for i in 0..count {
                    let ctrl = match sessions.GetSession(i) {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    if ctrl.GetState()? != AudioSessionStateActive {
                        continue;
                    }
                    let ctrl2: IAudioSessionControl2 = ctrl.cast()?;
                    let pid = ctrl2.GetProcessId()?;
                    if pid == 0 {
                        continue;
                    }
                    if let Some(name) = process_name(pid) {
                        if wanted.contains(&name.to_lowercase()) {
                            return Ok(true);
                        }
                    }
                }
            }
        }
        Ok(false)
    }

    /// Базовое имя exe процесса по PID (напр. "Telegram.exe").
    fn process_name(pid: u32) -> Option<String> {
        unsafe {
            let handle: HANDLE =
                OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid).ok()?;
            let mut buf = [0u16; MAX_PATH as usize];
            let mut len = buf.len() as u32;
            let res = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(handle);
            if res.is_err() || len == 0 {
                return None;
            }
            let full = String::from_utf16_lossy(&buf[..len as usize]);
            full.rsplit(['\\', '/']).next().map(|s| s.to_string())
        }
    }
}
