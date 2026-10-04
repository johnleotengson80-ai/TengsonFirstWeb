"""Vercel entrypoint for the Flask API."""

import sys
from pathlib import Path

from flask import Flask, jsonify
from sqlalchemy.exc import SQLAlchemyError

BACKEND_DIR = Path(__file__).resolve().parents[1] / 'System(back-end)'
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


app = Flask(__name__)

@app.route(
    '/', defaults={'path': ''},
    methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
)
@app.route(
    '/<path:path>',
    methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
)
def startup_error(path):
    return jsonify({'error': 'API startup is not initialized'}), 503


def _startup_failure(message, error_name, details):
    app.logger.error('API startup failed: %s', error_name)
    app.view_functions['startup_error'] = lambda path: (
        jsonify({'error': message, 'details': details}),
        503,
    )
    return app


try:
    from app import create_app  # noqa: E402

    app = create_app()
except RuntimeError as error:
    app = _startup_failure('API configuration is incomplete', type(error).__name__, str(error))
except SQLAlchemyError as error:
    details = (
        f'{type(error).__name__}: check DATABASE_URL, database connectivity, '
        'and schema migration privileges.'
    )
    app = _startup_failure('API database startup failed', type(error).__name__, details)
except Exception as error:
    details = (
        f'{type(error).__name__}: check function runtime dependencies and deployment logs.'
    )
    app = _startup_failure('API startup failed', type(error).__name__, details)
