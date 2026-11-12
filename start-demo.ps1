$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    if (!(Test-Path -LiteralPath '.env' -PathType Leaf)) {
        function New-DemoSecret {
            param([int]$Bytes)
            $buffer = New-Object byte[] $Bytes
            $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try { $generator.GetBytes($buffer) }
            finally { $generator.Dispose() }
            return ([BitConverter]::ToString($buffer)).Replace('-', '').ToLowerInvariant()
        }

        @(
            'WEB_PORT=5174'
            'SUPERADMIN_USERNAME=demo-admin'
            "SUPERADMIN_PASSWORD=$(New-DemoSecret 12)"
            "JWT_SECRET=$(New-DemoSecret 32)"
            "REFRESH_TOKEN_SECRET=$(New-DemoSecret 32)"
            "SECRET_KEY=$(New-DemoSecret 32)"
        ) | Set-Content -LiteralPath '.env' -Encoding Ascii
    }

    docker compose up -d --build --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $configuration = docker compose config --format json | ConvertFrom-Json
    $port = $configuration.services.web.ports[0].published
    Write-Host "Web     http://localhost:$port/"
    Write-Host "Admin   http://localhost:$port/admin"
    Write-Host "Swagger http://localhost:$port/docs"
    Write-Host "Thong tin dang nhap nam trong file .env."
} finally {
    Pop-Location
}
