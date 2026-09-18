import os
import uuid
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Product
from realtime import broadcast

products_bp  = Blueprint('products', __name__)
ALLOWED_EXT  = {'png', 'jpg', 'jpeg', 'gif', 'webp'}


# ── Helpers ───────────────────────────────────────────────────────────
def _get_identity():
    return {'id': int(get_jwt_identity()), 'role': get_jwt()['role']}


def _allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXT


def _safe_int(value, default: int = 0) -> int:
    """Parse int safely — returns default on empty string, None, or non-numeric."""
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return default


def _safe_float(value) -> float | None:
    """Parse float safely — returns None on failure."""
    try:
        v = float(str(value).strip())
        return v if v > 0 else None
    except (ValueError, TypeError):
        return None


def _save_image(file) -> str | None:
    """Saves uploaded image, returns filename or None on bad file."""
    if not file or not file.filename:
        return None
    if not _allowed_file(file.filename):
        return None
    ext      = file.filename.rsplit('.', 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    file.save(os.path.join(current_app.config['UPLOAD_FOLDER'], filename))
    return filename


def _delete_image(image_path: str):
    """Deletes image file from disk if it exists."""
    if image_path:
        full_path = os.path.join(current_app.config['UPLOAD_FOLDER'], image_path)
        if os.path.exists(full_path):
            try:
                os.remove(full_path)
            except OSError:
                pass  # non-critical, log in production


# ── GET /api/products/driver-availability ────────────────────────────
@products_bp.route('/driver-availability', methods=['GET'])
def driver_availability():
    """Public endpoint — customer checks if any driver is free before ordering."""
    from models import Order, User
    drivers      = User.query.filter_by(role='driver').all()
    busy_ids     = {
        o.driver_id
        for o in Order.query.filter_by(status='out_for_delivery').all()
        if o.driver_id
    }
    available    = [d for d in drivers if d.id not in busy_ids]
    busy_drivers = [d for d in drivers if d.id in busy_ids]

    return jsonify({
        'has_available_driver': len(available) > 0,
        'available_count':      len(available),
        'busy_count':           len(busy_drivers),
        'est_wait_minutes':     30 if busy_drivers and not available else None,
        'total_drivers':        len(drivers)
    }), 200


# ── GET /api/products/ ────────────────────────────────────────────────
@products_bp.route('/', methods=['GET'])
def get_all_products():
    """Public — returns all available products for customers."""
    products = Product.query.filter_by(is_available=True).all()
    return jsonify({'products': [p.to_dict() for p in products]}), 200


# ── GET /api/products/mine ────────────────────────────────────────────
@products_bp.route('/mine', methods=['GET'])
@jwt_required()
def get_my_products():
    """Seller-only — returns all products owned by the logged-in seller."""
    identity = _get_identity()
    if identity['role'] != 'seller':
        return jsonify({'error': 'Seller access required'}), 403

    products = Product.query.filter_by(seller_id=identity['id']).all()
    return jsonify({'products': [p.to_dict() for p in products]}), 200


# ── POST /api/products/ ───────────────────────────────────────────────
@products_bp.route('/', methods=['POST'])
@jwt_required()
def add_product():
    """Seller-only — add a new product with stock quantity."""
    identity = _get_identity()
    if identity['role'] != 'seller':
        return jsonify({'error': 'Seller access required'}), 403

    name        = (request.form.get('name') or '').strip()
    description = (request.form.get('description') or '').strip() or None
    category    = (request.form.get('category') or '').strip() or None
    price       = _safe_float(request.form.get('price'))
    quantity    = _safe_int(request.form.get('quantity'), default=0)

    # Input validation
    if not name:
        return jsonify({'error': 'Food name is required'}), 400
    if len(name) > 100:
        return jsonify({'error': 'Food name must be under 100 characters'}), 400
    if price is None:
        return jsonify({'error': 'A valid price greater than 0 is required'}), 400
    if quantity < 0:
        return jsonify({'error': 'Quantity cannot be negative'}), 400

    # Image handling
    image_filename = None
    if 'image' in request.files:
        file           = request.files['image']
        image_filename = _save_image(file)
        if file.filename and image_filename is None:
            return jsonify({'error': 'Invalid image format. Use PNG, JPG, JPEG, GIF, or WEBP'}), 400

    new_product = Product(
        seller_id    = identity['id'],
        name         = name,
        description  = description,
        category     = category,
        price        = price,
        image_path   = image_filename,
        quantity     = quantity,
        is_available = quantity > 0,
    )

    try:
        db.session.add(new_product)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Could not save product. Please try again.'}), 500

    broadcast('product_updated', {'product_id': new_product.id, 'seller_id': identity['id']})
    return jsonify({
        'message': f'"{name}" added to your menu!',
        'product': new_product.to_dict()
    }), 201


# ── PUT /api/products/<id> ────────────────────────────────────────────
@products_bp.route('/<int:product_id>', methods=['PUT'])
@jwt_required()
def update_product(product_id):
    """Seller-only — update product. Only provided fields are changed."""
    identity = _get_identity()
    product  = Product.query.get(product_id)

    if not product:
        return jsonify({'error': 'Product not found'}), 404
    if product.seller_id != identity['id']:
        return jsonify({'error': 'You can only edit your own products'}), 403

    # Update only provided fields
    name = (request.form.get('name') or '').strip()
    if name:
        if len(name) > 100:
            return jsonify({'error': 'Name must be under 100 characters'}), 400
        product.name = name

    desc = request.form.get('description')
    if desc is not None:
        product.description = desc.strip() or None

    cat = request.form.get('category')
    if cat is not None:
        product.category = cat.strip() or None

    price = _safe_float(request.form.get('price'))
    if price is not None:
        product.price = price
    elif request.form.get('price') is not None and request.form.get('price').strip() != '':
        return jsonify({'error': 'Invalid price value'}), 400

    qty_raw = request.form.get('quantity')
    if qty_raw is not None and qty_raw.strip() != '':
        quantity = _safe_int(qty_raw, default=-1)
        if quantity < 0:
            return jsonify({'error': 'Quantity cannot be negative'}), 400
        product.quantity     = quantity
        product.is_available = quantity > 0

    # Handle new image
    if 'image' in request.files:
        file     = request.files['image']
        new_name = _save_image(file)
        if file.filename and new_name is None:
            return jsonify({'error': 'Invalid image format'}), 400
        if new_name:
            _delete_image(product.image_path)
            product.image_path = new_name

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Update failed. Please try again.'}), 500

    broadcast('product_updated', {'product_id': product.id, 'seller_id': identity['id']})
    return jsonify({
        'message': f'"{product.name}" updated successfully!',
        'product': product.to_dict()
    }), 200


# ── DELETE /api/products/<id> ─────────────────────────────────────────
@products_bp.route('/<int:product_id>', methods=['DELETE'])
@jwt_required()
def delete_product(product_id):
    """Seller-only — delete a product and its image file."""
    identity = _get_identity()
    product  = Product.query.get(product_id)

    if not product:
        return jsonify({'error': 'Product not found'}), 404
    if product.seller_id != identity['id']:
        return jsonify({'error': 'You can only delete your own products'}), 403

    name = product.name
    _delete_image(product.image_path)

    try:
        db.session.delete(product)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Could not delete product. Please try again.'}), 500

    broadcast('product_updated', {'product_id': product_id, 'seller_id': identity['id'], 'deleted': True})
    return jsonify({'message': f'"{name}" has been deleted.'}), 200


# ── GET /api/products/my-sales ────────────────────────────────────────
@products_bp.route('/my-sales', methods=['GET'])
@jwt_required()
def my_sales():
    """Seller-only — returns their own sales summary and top items."""
    identity = _get_identity()
    if identity['role'] != 'seller':
        return jsonify({'error': 'Seller access required'}), 403

    from models import Order, OrderItem
    from sqlalchemy import func

    # Total revenue and order count for this seller
    rows = db.session.query(
        func.count(Order.id).label('order_count'),
        func.sum(Order.total_amount).label('revenue')
    ).filter(
        Order.seller_id == identity['id'],
        Order.status.in_(['delivered', 'customer_confirmed'])
    ).first()

    # Top selling products
    top = db.session.query(
        Product.name,
        func.sum(OrderItem.quantity).label('total_sold'),
        func.sum(OrderItem.quantity * OrderItem.price_at_order).label('total_revenue')
    ).join(OrderItem, OrderItem.product_id == Product.id
    ).join(Order, Order.id == OrderItem.order_id
    ).filter(
        Product.seller_id == identity['id'],
        Order.status.in_(['delivered', 'customer_confirmed'])
    ).group_by(Product.id, Product.name
    ).order_by(func.sum(OrderItem.quantity).desc()
    ).limit(5).all()

    # Recent orders
    recent = Order.query.filter_by(seller_id=identity['id'])\
        .order_by(Order.created_at.desc()).limit(10).all()

    return jsonify({
        'summary': {
            'total_orders':  int(rows.order_count or 0),
            'total_revenue': float(rows.revenue or 0),
        },
        'top_products': [
            {'name': r.name, 'total_sold': int(r.total_sold), 'total_revenue': float(r.total_revenue)}
            for r in top
        ],
        'recent_orders': [o.to_dict() for o in recent]
    }), 200


# ── POST /api/products/bulk-restock ──────────────────────────────────
@products_bp.route('/bulk-restock', methods=['POST'])
@jwt_required()
def bulk_restock():
    """Seller-only — add quantity to all their products at once."""
    identity = _get_identity()
    if identity['role'] != 'seller':
        return jsonify({'error': 'Seller access required'}), 403

    data = request.get_json(silent=True) or {}
    amount = data.get('amount', 0)
    try:
        amount = int(amount)
        if amount < 1 or amount > 999:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({'error': 'Amount must be a number between 1 and 999'}), 400

    products = Product.query.filter_by(seller_id=identity['id']).all()
    if not products:
        return jsonify({'error': 'You have no products to restock'}), 404

    for p in products:
        p.quantity += amount
        p.is_available = True

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Restock failed. Please try again.'}), 500

    broadcast('product_updated', {'seller_id': identity['id'], 'bulk_restock': True})
    return jsonify({
        'message': f'All {len(products)} products restocked by +{amount}!',
        'updated': len(products)
    }), 200
