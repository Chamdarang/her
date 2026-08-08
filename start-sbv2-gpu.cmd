@echo off
chcp 65001 >nul
pushd "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop이 실행 중이 아닙니다.
  echo Docker Desktop을 먼저 실행한 뒤 다시 눌러 주세요.
  pause
  popd
  exit /b 1
)

echo SBV2 GPU 서버를 시작합니다.
echo 처음 실행은 이미지와 모델을 다운로드하므로 오래 걸릴 수 있습니다.
docker compose -f docker-compose.sbv2-gpu.yml up -d --build
if errorlevel 1 (
  echo.
  echo 시작하지 못했습니다. 위 오류를 확인해 주세요.
  pause
  popd
  exit /b 1
)

echo.
echo 서버 준비 상태를 확인하려면 다음 파일을 실행하세요: logs-sbv2-gpu.cmd
echo 준비되면 HER에서 http://127.0.0.1:5000 을 사용합니다.
pause
popd
