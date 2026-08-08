@echo off
chcp 65001 >nul
pushd "%~dp0"
docker compose -f docker-compose.sbv2-gpu.yml down
popd
