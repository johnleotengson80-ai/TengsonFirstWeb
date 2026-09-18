import os
import secrets
from datetime import timedelta
from pathlib import Path
from urllib.parse import quote_plus

from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import bcrypt

from models import db, User
from routes.auth import auth_bp
from routes.products import products_bp
from routes.orders import orders_bp
from routes.admin import admin_bp
from routes.driver import driver_bp
from routes.reviews import reviews_bp
from realtime import realtime_bp

load_dotenv()


def _database_uri():
    configured_uri = os.getenv('DATABASE_URL') or os.getenv('SQLALCHEMY_DATABASE_URI')
    if configured_uri:
        return configured_uri.replace('mysql://', 'mysql+pymysql://', 1)

    required = ('DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME')
    values = {key: os.getenv(key) for key in required}
    if all(values.values()):
        return (
            f"mysql+pymysql://{quote_plus(values['DB_USER'])}:"
            f"{quote_plus(values['DB_PASSWORD'])}@{values['DB_HOST']}:"
            f"{values['DB_PORT']}/{values['DB_NAME']}"
        )

    if os.getenv('VERCEL') or os.getenv('FLASK_ENV') == 'production':
        raise RuntimeError(
            'DATABASE_URL (or DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME) '
            'must be configured in production.'
        )
    return f"sqlite:///{Path(__file__).with_name('local.db')}"


def _jwt_secret():
    secret = os.getenv('JWT_SECRET_KEY')
    if secret:
        if len(secret) < 32:
            raise RuntimeError('JWT_SECRET_KEY must be at least 32 characters.')
        return secret
    if os.getenv('VERCEL') or os.getenv('FLASK_ENV') == 'production':
        raise RuntimeError('JWT_SECRET_KEY must be configured in production.')
    return secrets.token_urlsafe(48)


def _cors_origins():
    raw = os.getenv('CORS_ORIGINS', 'http://localhost:5000,http://127.0.0.1:5000')
    return [origin.strip() for origin in raw.split(',') if origin.strip()]


def _bootstrap_admin():
    username = (os.getenv('BOOTSTRAP_ADMIN_USERNAME') or '').strip()
    password = os.getenv('BOOTSTRAP_ADMIN_PASSWORD')
    if not username and not password:
        return
    if not username or not password:
        raise RuntimeError(
            'BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must be set together.'
        )
    password_bytes = password.encode('utf-8')
    if not password_bytes or len(password_bytes) > 72:
        raise RuntimeError('BOOTSTRAP_ADMIN_PASSWORD must be between 1 and 72 UTF-8 bytes.')

    if User.query.filter_by(username=username).first():
        return

    email = (os.getenv('BOOTSTRAP_ADMIN_EMAIL') or '').strip() or None
    if email and User.query.filter_by(email=email).first():
        raise RuntimeError('BOOTSTRAP_ADMIN_EMAIL is already used by another account.')

    admin = User(
        username=username,
        password_hash=bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode('utf-8'),
        role='admin',
        full_name=(os.getenv('BOOTSTRAP_ADMIN_FULL_NAME') or '').strip() or None,
        email=email,
    )
    db.session.add(admin)
    try:
        db.session.commit()
    except Exception as error:
        db.session.rollback()
        raise RuntimeError('Bootstrap admin creation failed.') from error


def create_app():
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = _database_uri()
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['JWT_SECRET_KEY'] = _jwt_secret()
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)

    upload_folder = os.getenv('UPLOAD_FOLDER')
    if not upload_folder:
        upload_folder = '/tmp/uploads' if os.getenv('VERCEL') else str(Path(__file__).with_name('uploads'))
    app.config['UPLOAD_FOLDER'] = upload_folder
    app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024
    os.makedirs(upload_folder, exist_ok=True)

    db.init_app(app)
    JWTManager(app)
    with app.app_context():
        db.create_all()
        _bootstrap_admin()

    CORS(
        app,
        origins=_cors_origins(),
        supports_credentials=True,
        allow_headers=['Content-Type', 'Authorization'],
        methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    )

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(products_bp, url_prefix='/api/products')
    app.register_blueprint(orders_bp, url_prefix='/api/orders')
    app.register_blueprint(admin_bp, url_prefix='/api/admin')
    app.register_blueprint(driver_bp, url_prefix='/api/driver')
    app.register_blueprint(reviews_bp, url_prefix='/api/reviews')
    app.register_blueprint(realtime_bp, url_prefix='/api/realtime')

    @app.route('/uploads/<filename>')
    def uploaded_file(filename):
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

    @app.route('/')
    def index():
        return {'message': 'Hi Te! API is running', 'status': 'ok'}

    @app.route('/api/')
    @app.route('/api')
    def api_index():
        return {'message': 'Hi Te! API is running', 'status': 'ok'}

    return app


if __name__ == '__main__':
    app = create_app()
    print('[SERVER] Running on http://localhost:5000')
    app.run(debug=os.getenv('FLASK_DEBUG', '').lower() == 'true', port=5000, threaded=True)
