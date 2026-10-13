# 构建 SpecBase Helper（PROJECT.md §12-A8）
# 用法：powershell -ExecutionPolicy Bypass -File tools\build.ps1
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
        Write-Host '[build] 首次构建，安装开发依赖 ...' -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
    }

    node tools/build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'esbuild 打包失败' }

    $out = Join-Path $root 'dist\specbase-helper.user.js'
    if (-not (Test-Path $out)) { throw "产物未生成：$out" }

    Write-Host '[build] 完成。把 dist\specbase-helper.user.js 导入 Tampermonkey 即可。' -ForegroundColor Green
}
finally {
    Pop-Location
}
