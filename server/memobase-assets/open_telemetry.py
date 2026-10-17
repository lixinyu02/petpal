# PetPal privacy adapter for Memobase 0.0.42 (Apache-2.0).
# Keep the public metric names while disabling metrics/exporter/listeners.
from enum import Enum

class CounterMetricName(Enum):
    REQUEST = "requests_total"
    HEALTHCHECK = "healthcheck_total"
    LLM_INVOCATIONS = "llm_invocations_total"
    LLM_TOKENS_INPUT = "llm_input_tokens_total"
    LLM_TOKENS_OUTPUT = "llm_output_tokens_total"
    EMBEDDING_TOKENS = "embedding_tokens_total"

class HistogramMetricName(Enum):
    LLM_LATENCY_MS = "llm_latency"
    EMBEDDING_LATENCY_MS = "embedding_latency"
    REQUEST_LATENCY_MS = "request_latency"

class GaugeMetricName(Enum):
    INPUT_TOKEN_COUNT = "input_token_count_per_call"
    OUTPUT_TOKEN_COUNT = "output_token_count_per_call"

class TelemetryManager:
    def setup_telemetry(self, *args, **kwargs):
        pass
    def setup_metrics(self, *args, **kwargs):
        pass
    def increment_counter_metric(self, *args, **kwargs):
        pass
    def record_histogram_metric(self, *args, **kwargs):
        pass
    def set_gauge_metric(self, *args, **kwargs):
        pass

telemetry_manager = TelemetryManager()
