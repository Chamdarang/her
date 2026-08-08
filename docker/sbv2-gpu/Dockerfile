FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG SBV2_REF=2.7.0

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/cache/huggingface

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        git \
        libsndfile1 \
        python3.10 \
        python3-pip \
        python3.10-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --upgrade pip setuptools wheel \
    && python3 -m pip install \
        --extra-index-url https://download.pytorch.org/whl/cu121 \
        torch==2.3.1+cu121 \
        torchaudio==2.3.1+cu121

RUN git clone --depth 1 --branch "${SBV2_REF}" \
      https://github.com/litagin02/Style-Bert-VITS2.git /opt/style-bert-vits2

WORKDIR /opt/style-bert-vits2

# API 추론에 필요한 구성만 설치한다. 학습/전사 패키지는 의도적으로 제외한다.
RUN python3 -m pip install \
        ".[torch]" \
        fastapi \
        GPUtil \
        "huggingface-hub<1" \
        psutil \
        PyYAML \
        scipy \
        "transformers==4.46.3" \
        "uvicorn[standard]"

RUN python3 initialize.py --only_infer --skip_default_models

COPY entrypoint.sh /usr/local/bin/sbv2-entrypoint
RUN chmod +x /usr/local/bin/sbv2-entrypoint

EXPOSE 5000
ENTRYPOINT ["/usr/local/bin/sbv2-entrypoint"]
