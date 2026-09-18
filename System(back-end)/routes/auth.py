import bcrypt
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, get_jwt
from models import db, User
from realtime import broadcast

auth_bp = Blueprint('auth', __name__)


# ============================================
# POST /api/auth/register
# ============================================
@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()

    if not username:
        return jsonify({'error': '"username" is required'}), 400
    if not password:
        return jsonify({'error': '"password" is required'}), 400

    # SECURITY: ignore any role sent from frontend — always create customer
    role = 'customer'

    # Check if username already exists
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 409

    # Check if email already exists (if provided)
    email = (data.get('email') or '').strip() or None
    if email and User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 409

    # Hash password
    password_hash = bcrypt.hashpw(
        data['password'].encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')

    # Create new user
    new_user = User(
        username      = username,
        password_hash = password_hash,
        role          = role,
        full_name     = (data.get('full_name') or '').strip() or None,
        email         = email,
        phone         = (data.get('phone') or '').strip() or None,
        address       = (data.get('address') or '').strip() or None,
    )

    try:
        db.session.add(new_user)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Registration failed. Please try again.'}), 500

    broadcast('user_updated', {'user_id': new_user.id, 'role': new_user.role})
    # FIX: use new_user (not user) and correct JWT format
    token = create_access_token(
        identity=str(new_user.id),
        additional_claims={'role': new_user.role}
    )

    return jsonify({
        'message': 'Registration successful!',
        'token':   token,
        'user':    new_user.to_dict()
    }), 201


# ============================================
# POST /api/auth/login
# This is the Backend Login Algorithm. 
# It receives a username and password from the frontend, verifies them against the database, 
# and returns a "JWT Token" if successful.
# ============================================
@auth_bp.route('/login', methods=['POST'])
def login():
    # STEP 1: Get the data (username and password) sent by the frontend (app.js)
    data = request.get_json(silent=True)

    # STEP 2: Basic Validation. Check if they actually provided both fields.
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Username and password are required'}), 400

    # STEP 3: Database Lookup. Find the user in the database by their username.
    # The `.first()` command returns the first matching user, or None if they don't exist.
    user = User.query.filter_by(username=data['username']).first()

    if not user:
        # We don't say "Username not found" for security reasons (prevents hackers from guessing usernames).
        # We just say "Invalid username or password".
        return jsonify({'error': 'Invalid username or password'}), 401

    # STEP 4: Password Verification.
    # We DO NOT store raw passwords in the database (e.g., "password123"). We store a "hash" (scrambled text).
    # bcrypt.checkpw() takes the raw password they just typed, hashes it using the same algorithm,
    # and compares it to the hash saved in the database.
    try:
        password_matches = bcrypt.checkpw(
            data['password'].encode('utf-8'),
            user.password_hash.encode('utf-8')
        )
    except Exception:
        password_matches = False

    if not password_matches:
        return jsonify({'error': 'Invalid username or password'}), 401

    # STEP 5: Create the Access Token (JWT - JSON Web Token).
    # This token acts like a "Digital ID Card". It proves the user is logged in.
    # We embed their User ID and their Role (e.g., 'customer' or 'seller') inside this token.
    token = create_access_token(
        identity=str(user.id),
        additional_claims={'role': user.role}
    )

    # STEP 6: Send the success response back to the frontend.
    # We send the Token and the User's details (like their name and role) so the frontend knows who logged in.
    return jsonify({
        'message': 'Login successful!',
        'token':   token,
        'user':    user.to_dict()
    }), 200


# ============================================
# GET /api/auth/me
# ============================================
@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def me():
    identity = get_jwt_identity()
    claims   = get_jwt()
    user = User.query.get(int(identity))

    if not user:
        return jsonify({'error': 'User not found'}), 404

    return jsonify({'user': user.to_dict()}), 200


# ============================================
# PATCH /api/auth/me  — Edit profile
# ============================================
@auth_bp.route('/me', methods=['PATCH'])
@jwt_required()
def update_profile():
    identity = get_jwt_identity()
    user = User.query.get(int(identity))
    if not user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json(silent=True) or {}

    full_name = (data.get('full_name') or '').strip()
    email     = (data.get('email') or '').strip() or None
    phone     = (data.get('phone') or '').strip() or None
    address   = (data.get('address') or '').strip() or None

    if full_name:
        user.full_name = full_name
    if email:
        existing = User.query.filter(User.email == email, User.id != user.id).first()
        if existing:
            return jsonify({'error': 'Email already in use by another account'}), 409
        user.email = email
    if phone is not None:
        user.phone = phone
    if address is not None:
        user.address = address

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Could not update profile. Please try again.'}), 500

    broadcast('user_updated', {'user_id': user.id, 'role': user.role})
    return jsonify({'message': 'Profile updated!', 'user': user.to_dict()}), 200


# ============================================
# POST /api/auth/change-password
# ============================================
@auth_bp.route('/change-password', methods=['POST'])
@jwt_required()
def change_password():
    identity = get_jwt_identity()
    user = User.query.get(int(identity))
    if not user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json(silent=True) or {}
    old_password = (data.get('old_password') or '').strip()
    new_password = (data.get('new_password') or '').strip()

    if not old_password or not new_password:
        return jsonify({'error': 'old_password and new_password are required'}), 400
    if len(new_password) < 6:
        return jsonify({'error': 'New password must be at least 6 characters'}), 400

    if not bcrypt.checkpw(old_password.encode('utf-8'), user.password_hash.encode('utf-8')):
        return jsonify({'error': 'Current password is incorrect'}), 401

    user.password_hash = bcrypt.hashpw(
        new_password.encode('utf-8'), bcrypt.gensalt()
    ).decode('utf-8')

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Could not change password. Please try again.'}), 500

    return jsonify({'message': 'Password changed successfully!'}), 200
