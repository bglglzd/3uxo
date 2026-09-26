Сюда сборка кладёт `libonnxruntime.dylib` (ONNX Runtime 1.23.2 под архитектуру
Mac) — CI скачивает её с GitHub-релизов Microsoft перед `tauri build`. Файл
бандлится в `Auris.app/Contents/Frameworks`. Сам dylib в git не хранится.
