"""Read-only Linux host metrics for the Orbit NAS dashboard.

The collector reads procfs/sysfs counters. It does not invoke shell commands,
write to the media catalog, or require privileged container mode.
"""
from __future__ import annotations

import math
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SAMPLE_INTERVAL_SECONDS = max(5, int(os.getenv("SYSTEM_METRICS_INTERVAL", "15")))
RETENTION_HOURS = 24
MAX_SAMPLES = int(RETENTION_HOURS * 3600 / SAMPLE_INTERVAL_SECONDS)


def _number(value: str, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class MetricsCollector:
    def __init__(self, proc_root: str | Path | None = None, sys_root: str | Path | None = None) -> None:
        preferred_proc = Path(proc_root or os.getenv("ORBIT_HOST_PROC", "/host/proc"))
        preferred_sys = Path(sys_root or os.getenv("ORBIT_HOST_SYS", "/host/sys"))
        self.proc = preferred_proc if (preferred_proc / "stat").is_file() else Path("/proc")
        self.sys = preferred_sys if preferred_sys.exists() else Path("/sys")
        self.samples: deque[dict[str, Any]] = deque(maxlen=MAX_SAMPLES)
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.previous_cpu: tuple[int, int] | None = None
        self.previous_network: dict[str, tuple[int, int]] = {}
        self.previous_disks: dict[str, tuple[int, int]] = {}
        self.previous_time: float | None = None

    def _read_cpu(self) -> tuple[float | None, int]:
        try:
            lines = (self.proc / "stat").read_text().splitlines()
            cpu_line = next(line for line in lines if line.startswith("cpu "))
            values = [int(value) for value in cpu_line.split()[1:]]
            total = sum(values)
            idle = values[3] + (values[4] if len(values) > 4 else 0)
            cores = sum(1 for line in lines if line.startswith("cpu") and line[3:4].isdigit())
            percent = None
            if self.previous_cpu:
                delta_total = total - self.previous_cpu[0]
                delta_idle = idle - self.previous_cpu[1]
                if delta_total > 0:
                    percent = round(max(0.0, min(100.0, (delta_total - delta_idle) / delta_total * 100)), 2)
            self.previous_cpu = (total, idle)
            return percent, max(1, cores)
        except (OSError, StopIteration, ValueError):
            return None, max(1, os.cpu_count() or 1)

    def _read_memory(self) -> tuple[int, int, int]:
        try:
            values: dict[str, int] = {}
            for line in (self.proc / "meminfo").read_text().splitlines():
                key, _, raw = line.partition(":")
                if key in {"MemTotal", "MemAvailable", "MemFree", "Buffers", "Cached"}:
                    values[key] = int(raw.strip().split()[0]) * 1024
            total = values.get("MemTotal", 0)
            available = values.get("MemAvailable", values.get("MemFree", 0) + values.get("Buffers", 0) + values.get("Cached", 0))
            available = min(total, max(0, available))
            return total, max(0, total - available), available
        except (OSError, ValueError, IndexError):
            return 0, 0, 0

    def _read_network(self) -> tuple[dict[str, tuple[int, int]], list[str]]:
        counters: dict[str, tuple[int, int]] = {}
        try:
            lines = (self.proc / "net" / "dev").read_text().splitlines()[2:]
            for line in lines:
                name, separator, raw = line.partition(":")
                if not separator:
                    continue
                interface = name.strip()
                if interface == "lo" or interface.startswith(("docker", "br-", "veth", "virbr", "tunl")):
                    continue
                fields = raw.split()
                if len(fields) >= 9:
                    counters[interface] = (int(fields[0]), int(fields[8]))
        except (OSError, ValueError, IndexError):
            pass
        return counters, sorted(counters)

    def _read_disks(self) -> tuple[dict[str, tuple[int, int]], list[str]]:
        counters: dict[str, tuple[int, int]] = {}
        try:
            lines = (self.proc / "diskstats").read_text().splitlines()
            for line in lines:
                fields = line.split()
                if len(fields) < 10:
                    continue
                name = fields[2]
                if name.startswith(("loop", "ram", "zram", "dm-", "md", "sr", "fd")):
                    continue
                if (self.sys / "class" / "block" / name / "partition").exists():
                    continue
                # Linux diskstats sector counters use 512-byte sectors.
                counters[name] = (int(fields[5]) * 512, int(fields[9]) * 512)
        except (OSError, ValueError, IndexError):
            pass
        return counters, sorted(counters)

    def _temperature(self) -> float | None:
        candidates: list[tuple[int, float]] = []
        thermal_root = self.sys / "class" / "thermal"
        try:
            for zone in thermal_root.glob("thermal_zone*"):
                zone_type = (zone / "type").read_text().strip().lower()
                if not any(word in zone_type for word in ("cpu", "package", "x86_pkg")):
                    continue
                raw = _number((zone / "temp").read_text().strip(), -1)
                if raw >= 0:
                    candidates.append((0, raw / 1000 if raw > 1000 else raw))
        except OSError:
            pass
        hwmon_root = self.sys / "class" / "hwmon"
        try:
            for hwmon in hwmon_root.glob("hwmon*"):
                for input_file in hwmon.glob("temp*_input"):
                    raw = _number(input_file.read_text().strip(), -1)
                    if raw < 0:
                        continue
                    label_file = input_file.with_name(input_file.name.replace("_input", "_label"))
                    label = label_file.read_text().strip().lower() if label_file.exists() else ""
                    priority = 0 if any(word in label for word in ("package", "cpu", "tctl", "tdie")) else 2
                    candidates.append((priority, raw / 1000 if raw > 1000 else raw))
        except OSError:
            pass
        if not candidates:
            return None
        return round(sorted(candidates, key=lambda item: item[0])[0][1], 1)

    def sample(self) -> dict[str, Any]:
        now_mono = time.monotonic()
        elapsed = max(0.001, now_mono - self.previous_time) if self.previous_time is not None else SAMPLE_INTERVAL_SECONDS
        self.previous_time = now_mono

        cpu_percent, cores = self._read_cpu()
        memory_total, memory_used, memory_available = self._read_memory()
        network, interfaces = self._read_network()
        disks, disk_devices = self._read_disks()

        rx_rate = sum(max(0, value[0] - self.previous_network.get(name, value)[0]) for name, value in network.items()) / elapsed
        tx_rate = sum(max(0, value[1] - self.previous_network.get(name, value)[1]) for name, value in network.items()) / elapsed
        read_rate = sum(max(0, value[0] - self.previous_disks.get(name, value)[0]) for name, value in disks.items()) / elapsed
        write_rate = sum(max(0, value[1] - self.previous_disks.get(name, value)[1]) for name, value in disks.items()) / elapsed
        self.previous_network = network
        self.previous_disks = disks

        try:
            uptime_seconds = _number((self.proc / "uptime").read_text().split()[0])
        except (OSError, IndexError):
            uptime_seconds = 0.0
        try:
            loads = [_number(value) for value in (self.proc / "loadavg").read_text().split()[:3]]
            load_1m, load_5m, load_15m = (loads + [0.0, 0.0, 0.0])[:3]
        except (OSError, ValueError):
            load_1m = load_5m = load_15m = 0.0

        timestamp = datetime.now(timezone.utc).isoformat()
        memory_percent = round(memory_used / memory_total * 100, 2) if memory_total else None
        return {
            "timestamp": timestamp,
            "epoch": time.time(),
            "cpu_percent": cpu_percent,
            "cpu_cores": cores,
            "memory_total_bytes": memory_total,
            "memory_used_bytes": memory_used,
            "memory_available_bytes": memory_available,
            "memory_percent": memory_percent,
            "uptime_seconds": round(uptime_seconds, 1),
            "load_1m": round(load_1m, 2),
            "load_5m": round(load_5m, 2),
            "load_15m": round(load_15m, 2),
            "network_rx_bytes_per_sec": round(rx_rate, 1),
            "network_tx_bytes_per_sec": round(tx_rate, 1),
            "network_interfaces": interfaces,
            "disk_read_bytes_per_sec": round(read_rate, 1),
            "disk_write_bytes_per_sec": round(write_rate, 1),
            "disk_devices": disk_devices,
            "cpu_temperature_c": self._temperature(),
        }

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.stop_event.clear()
        with self.lock:
            self.samples.append(self.sample())
        self.thread = threading.Thread(target=self._run, name="orbit-system-metrics", daemon=True)
        self.thread.start()

    def _run(self) -> None:
        while not self.stop_event.wait(SAMPLE_INTERVAL_SECONDS):
            try:
                sample = self.sample()
                with self.lock:
                    self.samples.append(sample)
            except Exception:
                # Monitoring must never take down the media API.
                continue

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)

    def snapshot(self, range_hours: int = 6, max_points: int = 180) -> dict[str, Any]:
        cutoff = time.time() - max(1, min(24, range_hours)) * 3600
        with self.lock:
            history = [point for point in self.samples if point["epoch"] >= cutoff]
        if len(history) > max_points:
            stride = math.ceil((len(history) - 1) / (max_points - 1))
            history = history[::stride]
            if self.samples and history and history[-1] is not self.samples[-1]:
                with self.lock:
                    latest = self.samples[-1] if self.samples else None
                if latest and history[-1]["epoch"] != latest["epoch"]:
                    history.append(latest)
        current = history[-1] if history else None
        return {
            "sample_interval_seconds": SAMPLE_INTERVAL_SECONDS,
            "retention_hours": RETENTION_HOURS,
            "range_hours": range_hours,
            "history_count": len(history),
            "current": current,
            "history": history,
        }


system_metrics = MetricsCollector()
