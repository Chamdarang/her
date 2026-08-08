#!/usr/bin/env bash
set -euo pipefail

cd /opt/style-bert-vits2

mkdir -p /models /cache/huggingface
rm -rf /opt/style-bert-vits2/model_assets
ln -s /models /opt/style-bert-vits2/model_assets

if ! find /models -type f -name '*.safetensors' -print -quit | grep -q .; then
  echo "[SBV2] 모델이 없어 공식 기본 모델을 처음 한 번 다운로드합니다."
  python3 initialize.py --only_infer --assets_root /models
else
  python3 initialize.py --only_infer --skip_default_models --assets_root /models
fi

python3 - <<'PY'
import torch
if not torch.cuda.is_available():
    raise SystemExit("[SBV2] NVIDIA GPU를 컨테이너에서 찾지 못했습니다.")
print(f"[SBV2] GPU: {torch.cuda.get_device_name(0)}")
PY

exec python3 server_fastapi.py --dir /models
