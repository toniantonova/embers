# ─────────────────────────────────────────────────────────────────────────────
# Rate Limiter — shared slowapi instance
# ─────────────────────────────────────────────────────────────────────────────
# Extracted to its own module to avoid circular imports between main.py
# (which imports route modules) and route modules (which need the limiter).
# ─────────────────────────────────────────────────────────────────────────────


from slowapi import Limiter
from slowapi.util import get_remote_address

# Key function: rate-limit by client IP.
# Cloud Run sets X-Forwarded-For automatically; get_remote_address reads it.
limiter = Limiter(key_func=get_remote_address)
