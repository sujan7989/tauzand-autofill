"""
NVIDIA NIM Client for Mistral AI Integration.

Uses the `requests` library for HTTP transport (instead of httpx/AsyncOpenAI).
On Windows, httpx's anyio async backend has TLS read-timeout issues with the
NVIDIA NIM endpoint. `requests` uses WinHTTP under the hood and works correctly.

All public methods keep async signatures so callers (ai_answer_service,
ai_field_mapping_service) do not need to change.  The actual HTTP work is done
synchronously inside a thread-pool executor so it doesn't block the event loop
when one happens to be running.
"""
import os
import json
import logging
import hashlib
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime, timedelta
import requests

logger = logging.getLogger(__name__)

# Thread pool for running blocking `requests` calls from async contexts
_executor = ThreadPoolExecutor(max_workers=4)


@dataclass
class AIResponse:
    """Structured AI response."""
    success: bool
    content: Optional[str] = None
    error: Optional[str] = None
    tokens_used: int = 0
    model: str = ""
    cached: bool = False
    latency_ms: int = 0


@dataclass
class TokenUsage:
    """Token usage tracking."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0


class NVIDIANIMClient:
    """
    NVIDIA NIM Client — synchronous HTTP via `requests`, async-compatible wrapper.
    Handles caching, rate limiting, retry with exponential backoff, cost tracking.
    """

    def __init__(self):
        self.api_key  = os.getenv("NVIDIA_NIM_API_KEY", "")
        self.base_url = os.getenv("NVIDIA_NIM_BASE_URL",
                                   "https://integrate.api.nvidia.com/v1")
        self.model     = os.getenv("NVIDIA_NIM_MODEL",
                                   "mistralai/mistral-medium-3.5-128b")
        self.max_tokens   = int(os.getenv("AI_MAX_TOKENS",   "4096"))
        self.temperature  = float(os.getenv("AI_TEMPERATURE", "0.1"))
        self.top_p        = float(os.getenv("AI_TOP_P",       "0.9"))
        self.timeout      = float(os.getenv("AI_REQUEST_TIMEOUT", "60.0"))

        if not self.api_key or self.api_key == "your_nvidia_nim_api_key_here":
            raise ValueError("NVIDIA_NIM_API_KEY not configured in environment")

        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type":  "application/json",
            "Accept":        "application/json",
        })

        # Rate limiting
        self._request_timestamps: List[datetime] = []
        self.max_requests_per_minute = 60

        # Token / cost tracking
        self.total_tokens_used = 0
        self.total_cost_usd    = 0.0

        # In-memory cache
        self._cache: Dict[str, Dict] = {}
        self.cache_ttl = int(os.getenv("AI_CACHE_TTL", "3600"))

        # Dead-model flag: set on HTTP 410/404 so future calls skip instantly
        self._model_dead        = False
        self._model_dead_reason = ""

    # ── Cache helpers ──────────────────────────────────────────────────────────
    def _cache_key(self, prompt: str, system: str = "") -> str:
        return hashlib.sha256(f"{system}||{prompt}".encode()).hexdigest()[:32]

    def _from_cache(self, key: str) -> Optional[AIResponse]:
        entry = self._cache.get(key)
        if entry and datetime.now() < entry["expires_at"]:
            return AIResponse(success=True, content=entry["content"],
                              model=self.model, cached=True, latency_ms=1)
        if entry:
            del self._cache[key]
        return None

    def _to_cache(self, key: str, content: str) -> None:
        self._cache[key] = {
            "content":    content,
            "expires_at": datetime.now() + timedelta(seconds=self.cache_ttl),
        }

    # ── Cost helper ────────────────────────────────────────────────────────────
    def _cost(self, prompt_tok: int, comp_tok: int) -> float:
        return (prompt_tok / 1000) * 0.0003 + (comp_tok / 1000) * 0.0006

    # ── Synchronous HTTP call (runs in thread-pool) ────────────────────────────
    def _sync_chat(self, messages: List[Dict], max_tokens: int,
                   temperature: float, top_p: float) -> AIResponse:
        """Blocking HTTP POST to NIM /v1/chat/completions."""
        url = f"{self.base_url.rstrip('/')}/chat/completions"
        payload = {
            "model":       self.model,
            "messages":    messages,
            "max_tokens":  max_tokens,
            "temperature": temperature,
            "top_p":       top_p,
            "stream":      False,
        }
        start = datetime.now()
        try:
            resp = self._session.post(url, json=payload, timeout=self.timeout)
        except requests.exceptions.Timeout:
            latency = int((datetime.now() - start).total_seconds() * 1000)
            return AIResponse(success=False, error="Request timed out",
                              model=self.model, latency_ms=latency)
        except requests.exceptions.RequestException as e:
            latency = int((datetime.now() - start).total_seconds() * 1000)
            return AIResponse(success=False, error=str(e),
                              model=self.model, latency_ms=latency)

        latency = int((datetime.now() - start).total_seconds() * 1000)

        # Permanent errors — mark model dead for 404/410
        if resp.status_code in (404, 410):
            self._model_dead        = True
            self._model_dead_reason = resp.text[:200]
            logger.error("[NIM] Model permanently unavailable (HTTP %s) — "
                         "update NVIDIA_NIM_MODEL in .env", resp.status_code)
            return AIResponse(success=False,
                              error=f"HTTP {resp.status_code}: {resp.text[:200]}",
                              model=self.model, latency_ms=latency)

        if not resp.ok:
            return AIResponse(success=False,
                              error=f"HTTP {resp.status_code}: {resp.text[:300]}",
                              model=self.model, latency_ms=latency)

        try:
            body    = resp.json()
            content = body["choices"][0]["message"]["content"]
            usage   = body.get("usage", {})
            p_tok   = usage.get("prompt_tokens",     0)
            c_tok   = usage.get("completion_tokens", 0)
            tokens  = usage.get("total_tokens", p_tok + c_tok)
        except Exception as e:
            return AIResponse(success=False, error=f"Parse error: {e}",
                              model=self.model, latency_ms=latency)

        cost = self._cost(p_tok, c_tok)
        self.total_tokens_used += tokens
        self.total_cost_usd    += cost
        logger.info("[NIM] OK — tokens=%d cost=$%.6f latency=%dms", tokens, cost, latency)
        return AIResponse(success=True, content=content, tokens_used=tokens,
                          model=self.model, latency_ms=latency)

    # ── Public async interface ─────────────────────────────────────────────────
    async def chat_completion(
        self,
        messages:     List[Dict[str, str]],
        max_tokens:   Optional[int]   = None,
        temperature:  Optional[float] = None,
        top_p:        Optional[float] = None,
        use_cache:    bool            = True,
        max_retries:  int             = 3,
    ) -> AIResponse:
        """Async chat completion — HTTP is done in a thread pool via `requests`."""

        if self._model_dead:
            return AIResponse(success=False,
                              error=f"Model unavailable: {self._model_dead_reason}",
                              model=self.model, latency_ms=0)

        # Cache
        prompt_text = "\n".join(m["content"] for m in messages)
        sys_text    = next((m["content"] for m in messages if m["role"] == "system"), "")
        key = self._cache_key(prompt_text, sys_text)
        if use_cache:
            hit = self._from_cache(key)
            if hit:
                logger.info("[NIM] Cache hit key=%s...", key[:8])
                return hit

        # Rate limit
        now = datetime.now()
        cutoff = now - timedelta(minutes=1)
        self._request_timestamps = [t for t in self._request_timestamps if t > cutoff]
        if len(self._request_timestamps) >= self.max_requests_per_minute:
            wait = 60 - (now - self._request_timestamps[0]).total_seconds()
            if wait > 0:
                await asyncio.sleep(wait)
        self._request_timestamps.append(datetime.now())

        # Retry loop — max 1 attempt when timeout is short (template fallback is fast)
        retryable = {429, 500, 502, 503, 504}
        mt  = max_tokens  or self.max_tokens
        tmp = temperature or self.temperature
        tp  = top_p       or self.top_p
        last: Optional[AIResponse] = None

        loop = asyncio.get_event_loop()

        for attempt in range(1):  # Single attempt — fail fast to template fallback
            logger.info("[NIM] Attempt %d/%d model=%s", attempt + 1, max_retries, self.model)

            # Run blocking requests call in thread pool
            result: AIResponse = await loop.run_in_executor(
                _executor, lambda: self._sync_chat(messages, mt, tmp, tp)
            )

            if result.success:
                if use_cache and result.content:
                    self._to_cache(key, result.content)
                return result

            last = result

            # Decide whether to retry
            is_perm = self._model_dead or any(
                s in (result.error or "") for s in ("HTTP 400", "HTTP 401",
                "HTTP 403", "HTTP 404", "HTTP 410", "HTTP 422")
            )
            if is_perm:
                break

            is_retryable_status = any(
                f"HTTP {s}" in (result.error or "") for s in retryable
            ) or "timed out" in (result.error or "").lower()

            if not is_retryable_status or attempt >= max_retries - 1:
                break

            backoff = 2 ** attempt
            logger.info("[NIM] Retrying in %ds...", backoff)
            await asyncio.sleep(backoff)

        return last or AIResponse(success=False, error="Max retries exceeded",
                                  model=self.model)

    async def structured_completion(
        self,
        system_prompt: str,
        user_prompt:   str,
        schema:        Dict[str, Any],
        max_tokens:    Optional[int] = None,
    ) -> AIResponse:
        """Async structured completion with JSON schema validation."""
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user",
             "content": (f"{user_prompt}\n\n"
                         f"Respond with valid JSON matching this schema:\n"
                         f"{json.dumps(schema, indent=2)}")},
        ]
        resp = await self.chat_completion(messages, max_tokens=max_tokens)
        if resp.success and resp.content:
            try:
                parsed = json.loads(resp.content)
                return AIResponse(success=True, content=json.dumps(parsed),
                                  tokens_used=resp.tokens_used, model=resp.model,
                                  cached=resp.cached, latency_ms=resp.latency_ms)
            except json.JSONDecodeError as e:
                return AIResponse(success=False,
                                  error=f"Invalid JSON response: {e}",
                                  model=self.model)
        return resp

    # ── Stats / admin ──────────────────────────────────────────────────────────
    def get_usage_stats(self) -> Dict[str, Any]:
        return {
            "total_tokens_used": self.total_tokens_used,
            "total_cost_usd":    round(self.total_cost_usd, 6),
            "cache_size":        len(self._cache),
            "model":             self.model,
        }

    def clear_cache(self) -> None:
        self._cache.clear()


# ── Singleton ──────────────────────────────────────────────────────────────────
_nim_client: Optional[NVIDIANIMClient] = None


def get_nim_client() -> NVIDIANIMClient:
    global _nim_client
    if _nim_client is None:
        _nim_client = NVIDIANIMClient()
    return _nim_client
