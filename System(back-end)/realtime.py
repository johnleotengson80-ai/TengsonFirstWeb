import json
import queue
import time

from flask import Blueprint, Response, stream_with_context

realtime_bp = Blueprint('realtime', __name__)

_clients = set()


def broadcast(event_type, payload=None):
    message = {
        'type': event_type,
        'payload': payload or {},
        'ts': int(time.time() * 1000),
    }

    for client in list(_clients):
        try:
            client.put_nowait(message)
        except Exception:
            _clients.discard(client)


@realtime_bp.route('/events', methods=['GET'])
def events():
    client = queue.Queue()
    _clients.add(client)

    def stream():
        try:
            yield 'event: connected\ndata: {"status":"ok"}\n\n'
            while True:
                try:
                    message = client.get(timeout=20)
                    yield f"event: update\ndata: {json.dumps(message)}\n\n"
                except queue.Empty:
                    yield 'event: ping\ndata: {}\n\n'
        finally:
            _clients.discard(client)

    response = Response(stream_with_context(stream()), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    return response
