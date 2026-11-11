FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools \
	&& rm -rf /var/lib/apt/lists/*

RUN mkdir -p /host/proc/net /host/sys/class/thermal /host/sys/class/hwmon /host/sys/class/block \
    && touch /host/proc/stat /host/proc/meminfo /host/proc/uptime /host/proc/loadavg /host/proc/diskstats /host/proc/net/dev

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
