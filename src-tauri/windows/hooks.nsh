; Хуки NSIS-установщика Memiro AI.
;
; До 0.10 приложение называлось Auris. Установщик Tauri привязывает папку,
; ярлыки и запись «Программы и компоненты» к productName, поэтому установка
; Memiro AI встала бы рядом со старым Auris. После установки тихо удаляем
; старую программу Auris (файлы, ярлыки, запись в реестре). Данные пользователя
; (%APPDATA%\com.3uxo.app — встречи, настройки, модели) НЕ трогаются: тихий
; деинсталлятор Tauri удаляет данные только по галочке, а идентификатор
; приложения не менялся.

!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  Push $R1
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Auris" "InstallLocation"
  ${If} $R0 != ""
    ; InstallLocation записан в кавычках.
    StrCpy $R1 $R0 1
    ${If} $R1 == '"'
      StrCpy $R0 $R0 -1 1
    ${EndIf}
    ${If} $R0 != $INSTDIR
    ${AndIf} ${FileExists} "$R0\uninstall.exe"
      ; _?= — ждать завершения деинсталлятора (без копии во временную папку).
      ExecWait '"$R0\uninstall.exe" /S _?=$R0'
      Delete "$R0\uninstall.exe"
      RMDir "$R0"
    ${EndIf}
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Auris"
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend
