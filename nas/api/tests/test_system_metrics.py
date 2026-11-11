import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.system_metrics import MetricsCollector


class SystemMetricsTests(unittest.TestCase):
    def test_psutil_fallback_collects_host_metrics_without_procfs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "proc").mkdir()
            (root / "sys").mkdir()
            with patch.object(MetricsCollector, "_has_cpu_counters", return_value=False):
                collector = MetricsCollector(proc_root=root / "proc", sys_root=root / "sys")

        self.assertTrue(collector.use_psutil)
        sample = collector.sample()

        self.assertGreaterEqual(sample["cpu_percent"], 0)
        self.assertGreaterEqual(sample["cpu_cores"], 1)
        self.assertGreater(sample["memory_total_bytes"], 0)
        self.assertGreaterEqual(sample["memory_used_bytes"], 0)
        self.assertIsNotNone(sample["memory_percent"])
        self.assertGreater(sample["uptime_seconds"], 0)
        for key in (
            "load_1m",
            "load_5m",
            "load_15m",
            "network_rx_bytes_per_sec",
            "network_tx_bytes_per_sec",
            "disk_read_bytes_per_sec",
            "disk_write_bytes_per_sec",
        ):
            self.assertGreaterEqual(sample[key], 0)


if __name__ == "__main__":
    unittest.main()
