# Builds OnxyMc Texture Pack Showcase on Windows 10/11.
# Prerequisites (one time):
#   1. Node.js 20+            https://nodejs.org
#   2. Rust (MSVC toolchain)  https://rustup.rs
#   3. Visual Studio Build Tools with "Desktop development with C++"
#   (WebView2 is already part of Windows 10/11.)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

npm ci
node scripts/make-test-packs.mjs test-packs
npm test

npx tauri build

New-Item -ItemType Directory -Force dist-windows | Out-Null
Copy-Item src-tauri/target/release/bundle/nsis/*.exe dist-windows/
Copy-Item src-tauri/target/release/bundle/msi/*.msi dist-windows/
Copy-Item src-tauri/target/release/onxymc-showcase.exe "dist-windows/OnxyMc Texture Pack Showcase (portable).exe"
Write-Host "`nDone. Installers and the portable .exe are in .\dist-windows"
