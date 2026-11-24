# Faturale no servidor: Django + gunicorn. O banco é o Postgres do Supabase (DATABASE_URL).
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DJANGO_DEBUG=0 FATURALE_MODO_DEMO=0 \
    FATURALE_ARQUIVOS=/data/arquivos

# Bibliotecas que o OCR (opencv/onnxruntime) usa
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Baixa os modelos do OCR agora, para a primeira leitura não demorar
RUN python -c "from rapidocr import RapidOCR; RapidOCR()" || true

COPY . .
RUN DJANGO_SECRET_KEY=so-para-montar-a-imagem-nao-usada-em-producao-0000 python manage.py collectstatic --noinput

EXPOSE 8000
# Aplica as migrações e sobe o servidor
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi --bind 0.0.0.0:8000 --workers 1 --threads 8 --timeout 180"]
