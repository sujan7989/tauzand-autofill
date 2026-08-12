"""
Pytest configuration and shared fixtures for Tauzand AutoFill AI tests.

KEY INSIGHT about this network:
- TCP connects to integrate.api.nvidia.com:443 successfully
- But the firewall drops HTTP POST data — requests hang indefinitely
- So we cannot rely on TCP probe to detect NIM availability
- Instead: set AI_REQUEST_TIMEOUT=4s so the FIRST NIM call fails in 4s,
  then _model_dead=True blocks all subsequent calls (instant fallback)
- This means only the first AI test per session takes 4s; all others are instant
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Short timeout: first NIM call fails in 4s, then _model_dead blocks rest instantly
os.environ.setdefault("AI_REQUEST_TIMEOUT", "4.0")


def pytest_runtest_setup(item):
    """Reset singleton before each test but preserve _model_dead across resets."""
    try:
        import app.services.nvidia_nim_client as nim_mod
        # If the previous test set _model_dead on the singleton, keep that state
        # by NOT resetting — just leave it. The 4s timeout on the first call
        # is acceptable; all subsequent calls skip instantly.
        pass  # Do NOT reset singleton — let _model_dead persist
    except Exception:
        pass
