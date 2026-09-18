"""Vercel entrypoint for the Flask API."""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / 'System(back-end)'
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import create_app  # noqa: E402

app = create_app()
