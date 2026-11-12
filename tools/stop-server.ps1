# Останавливает серверы GalaxyDemo, накопившиеся от повторных запусков.
# Трогает только node-процессы с точкой входа server.js, слушающие порты 3000–3010.

$ErrorActionPreference = 'SilentlyContinue'
$stopped = 0

$candidates = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server[.]js' }

foreach ($proc in $candidates) {
  $ports = @(Get-NetTCPConnection -OwningProcess $proc.ProcessId -State Listen |
    Select-Object -ExpandProperty LocalPort |
    Where-Object { $_ -ge 3000 -and $_ -le 3010 })
  if ($ports.Count -eq 0) { continue }

  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
    Write-Host ("  Остановлен сервер: PID {0}, порт {1}" -f $proc.ProcessId, ($ports -join ', ')) -ForegroundColor Yellow
    $stopped++
  } catch {
    Write-Host ("  Не удалось остановить PID {0}: {1}" -f $proc.ProcessId, $_.Exception.Message) -ForegroundColor Red
  }
}

if ($stopped -eq 0) {
  Write-Host '  Запущенных серверов GalaxyDemo не найдено.' -ForegroundColor DarkGray
} else {
  Write-Host ("  Готово: остановлено {0}." -f $stopped) -ForegroundColor Green
}
