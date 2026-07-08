"""ProofPack Python SDK — Log digital product proof events for Stripe dispute defense."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional
from uuid import uuid4

import requests


class ProofEventType(str, Enum):
    USER_SIGNED_IN = "user.signed_in"
    USER_SIGNED_UP = "user.signed_up"
    TERMS_ACCEPTED = "terms.accepted"
    SUBSCRIPTION_STARTED = "subscription.started"
    SUBSCRIPTION_RENEWED = "subscription.renewed"
    CREDITS_PURCHASED = "credits.purchased"
    CREDITS_CONSUMED = "credits.consumed"
    OUTPUT_GENERATED = "output.generated"
    OUTPUT_DOWNLOADED = "output.downloaded"
    OUTPUT_EXPORTED = "output.exported"
    API_KEY_USED = "apikey.used"
    PAYMENT_COMPLETED = "payment.completed"
    INVOICE_VIEWED = "invoice.viewed"
    FEATURE_USED = "feature.used"


@dataclass
class ProofEventPayload:
    user_id: str
    event: str
    metadata: dict[str, Any] = field(default_factory=dict)
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    device_id: Optional[str] = None
    session_id: Optional[str] = None


@dataclass
class ProofEvent(ProofEventPayload):
    id: str = field(default_factory=lambda: str(uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "userId": self.user_id,
            "event": self.event,
            "metadata": self.metadata,
            "ipAddress": self.ip_address,
            "userAgent": self.user_agent,
            "deviceId": self.device_id,
            "sessionId": self.session_id,
            "timestamp": self.timestamp,
        }


class ProofPack:
    """ProofPack client for logging user proof events."""

    def __init__(
        self,
        api_key: str,
        endpoint: str = "https://api.proofpack.dev/v1/events",
        flush_interval_sec: float = 5.0,
        max_batch_size: int = 50,
        on_flush: Optional[Callable[[list[ProofEvent]], None]] = None,
        disabled: bool = False,
    ):
        self.api_key = api_key
        self.endpoint = endpoint
        self.flush_interval = flush_interval_sec
        self.max_batch_size = max_batch_size
        self.on_flush = on_flush
        self.disabled = disabled

        self._queue: list[ProofEvent] = []
        self._lock = threading.Lock()
        self._flushing = False
        self._timer: Optional[threading.Timer] = None
        self._start_timer()

    def track(self, payload: ProofEventPayload) -> ProofEvent:
        event = ProofEvent(
            id=str(uuid4()),
            timestamp=datetime.now(timezone.utc).isoformat(),
            user_id=payload.user_id,
            event=payload.event,
            metadata=payload.metadata,
            ip_address=payload.ip_address,
            user_agent=payload.user_agent,
            device_id=payload.device_id,
            session_id=payload.session_id,
        )

        if not self.disabled:
            with self._lock:
                self._queue.append(event)
                if len(self._queue) >= self.max_batch_size:
                    self.flush()

        return event

    def track_sync(self, payload: ProofEventPayload) -> ProofEvent:
        event = self.track(payload)
        self.flush()
        return event

    def flush(self) -> None:
        if self._flushing or self.disabled:
            return

        with self._lock:
            if not self._queue:
                return
            batch = self._queue[: self.max_batch_size]
            self._queue = self._queue[self.max_batch_size :]

        self._flushing = True
        try:
            resp = requests.post(
                self.endpoint,
                json={"events": [e.to_dict() for e in batch]},
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                    "X-ProofPack-SDK": "python/1.0.0",
                },
                timeout=10,
            )
            resp.raise_for_status()
            if self.on_flush:
                self.on_flush(batch)
        except Exception:
            with self._lock:
                self._queue = batch + self._queue
        finally:
            self._flushing = False

    def get_user_proofs(self, user_id: str) -> list[ProofEvent]:
        with self._lock:
            return [e for e in self._queue if e.user_id == user_id]

    def is_disabled(self) -> bool:
        return self.disabled

    def _start_timer(self) -> None:
        if self.flush_interval > 0:
            self._timer = threading.Timer(self.flush_interval, self._timer_callback)
            self._timer.daemon = True
            self._timer.start()

    def _timer_callback(self) -> None:
        self.flush()
        self._timer = threading.Timer(self.flush_interval, self._timer_callback)
        self._timer.daemon = True
        self._timer.start()

    def shutdown(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None
        self.flush()


_default_instance: Optional[ProofPack] = None


def init(
    api_key: str,
    endpoint: str = "https://api.proofpack.dev/v1/events",
    flush_interval_sec: float = 5.0,
    **kwargs: Any,
) -> ProofPack:
    global _default_instance
    _default_instance = ProofPack(api_key=api_key, endpoint=endpoint, flush_interval_sec=flush_interval_sec, **kwargs)
    return _default_instance


def get_instance() -> Optional[ProofPack]:
    return _default_instance


def track(payload: ProofEventPayload) -> Optional[ProofEvent]:
    if _default_instance:
        return _default_instance.track(payload)
    return None


def shutdown() -> None:
    global _default_instance
    if _default_instance:
        _default_instance.shutdown()
    _default_instance = None
