FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git curl python3 python3-venv python3-pip python3-dev \
    build-essential cmake pkg-config libsdl2-dev libglew-dev \
    libgl-dev libegl-dev libavcodec-dev libavformat-dev libavutil-dev libswscale-dev ffmpeg \
    xvfb xdotool libgl1-mesa-dri libegl-mesa0 mesa-utils
RUN python3 -m venv /venv \
 && /venv/bin/pip install --upgrade pip \
 && /venv/bin/pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cu132 \
 && /venv/bin/pip install "numpy>=1.26,<3" "Pillow>=10,<12" diffusers==0.39.0 transformers==5.17.0 accelerate==1.15.0 \
      safetensors==0.8.0 "einops>=0.8" "ftfy>=6" regex "sentencepiece>=0.2" "tqdm>=4.66" "imageio-ffmpeg>=0.5" \
      "aiohttp>=3.10,<4" "huggingface-hub>=0.26,<2" hf_xet "pytest>=8,<10"
ENV PATH=/venv/bin:$PATH
ENV HF_XET_HIGH_PERFORMANCE=1
WORKDIR /mg4
