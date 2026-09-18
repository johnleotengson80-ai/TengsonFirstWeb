import uuid
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Order, OrderItem, Product
from realtime import broadcast

orders_bp = Blueprint('orders', __name__)

RIDER_FEE      = 49.00
VALID_PAYMENTS = {'gcash', 'paymaya', 'cod', 'pickup'}

# All valid statuses
VALID_STATUSES = {
    'pending', 'confirmed', 'preparing',
    'ready_for_pickup',   # seller done — admin can assign driver
    'picked_up',          # driver collected from seller
    'out_for_delivery',   # driver en route to customer
    'delivered',          # driver says delivered
    'customer_confirmed', # customer confirmed receipt
    'ready_to_collect',   # pickup orders: food is ready
    'cancelled'
}

# Which role is allowed to set which statuses
ROLE_STATUS_MAP = {
    'seller': {'confirmed', 'preparing', 'ready_for_pickup', 'ready_to_collect', 'cancelled'},
    'driver': {'picked_up', 'out_for_delivery', 'delivered'},
    'customer': {'customer_confirmed', 'cancelled'},
    'admin':  VALID_STATUSES,
}


def _get_identity():
    return {'id': int(get_jwt_identity()), 'role': get_jwt()['role']}


def _is_pickup(order):
    return order.payment_method == 'pickup'


# ── POST /api/orders/ ─────────────────────────────────────────────────
@orders_bp.route('/', methods=['POST'])
@jwt_required()
def place_order():
    identity = _get_identity()
    if identity['role'] != 'customer':
        return jsonify({'error': 'Only customers can place orders'}), 403

    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    items          = data.get('items') or []
    payment_method = (data.get('payment_method') or '').strip().lower()

    if not items:
        return jsonify({'error': 'Order must contain at least one item'}), 400
    if payment_method not in VALID_PAYMENTS:
        return jsonify({'error': f'Payment method must be one of: {", ".join(sorted(VALID_PAYMENTS))}'}), 400

    subtotal         = 0.0
    order_items_data = []
    seller_id        = None

    for item in items:
        try:
            product_id = int(item.get('product_id'))
            quantity   = int(item.get('quantity', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid product_id or quantity'}), 400

        if quantity < 1:
            return jsonify({'error': 'Quantity must be at least 1'}), 400

        product = Product.query.get(product_id)
        if not product:
            return jsonify({'error': f'Product #{product_id} not found'}), 404
        if not product.is_available or product.quantity <= 0:
            return jsonify({'error': f'"{product.name}" is currently unavailable'}), 400
        if product.quantity < quantity:
            return jsonify({'error': f'Only {product.quantity} left for "{product.name}"'}), 400

        if seller_id is None:
            seller_id = product.seller_id
        elif seller_id != product.seller_id:
            return jsonify({'error': 'All items must be from the same seller'}), 400

        subtotal += float(product.price) * quantity
        order_items_data.append({
            'product':  product,
            'quantity': quantity,
            'price':    float(product.price),
        })

    is_pickup    = payment_method == 'pickup'
    rider_fee    = 0.0 if is_pickup else RIDER_FEE
    total_amount = subtotal + rider_fee
    ref_no       = f"QB-{uuid.uuid4().hex[:8].upper()}" if payment_method in ('gcash','paymaya') else None

    try:
        new_order = Order(
            customer_id      = identity['id'],
            seller_id        = seller_id,
            payment_method   = payment_method,
            subtotal         = subtotal,
            rider_fee        = rider_fee,
            total_amount     = total_amount,
            delivery_address = (data.get('delivery_address') or '').strip(),
            notes            = (data.get('notes') or '').strip(),
            reference_no     = ref_no,
            est_delivery_min = 30,
        )
        db.session.add(new_order)
        db.session.flush()

        for item_data in order_items_data:
            db.session.add(OrderItem(
                order_id       = new_order.id,
                product_id     = item_data['product'].id,
                quantity       = item_data['quantity'],
                price_at_order = item_data['price'],
            ))
            item_data['product'].quantity -= item_data['quantity']
            if item_data['product'].quantity <= 0:
                item_data['product'].quantity     = 0
                item_data['product'].is_available = False

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Could not place order. Please try again.'}), 500

    broadcast('order_created', {'order_id': new_order.id})
    return jsonify({'message': 'Order placed successfully!', 'order': new_order.to_dict()}), 201


# ── GET /api/orders/my-orders ─────────────────────────────────────────
@orders_bp.route('/my-orders', methods=['GET'])
@jwt_required()
def my_orders():
    identity = _get_identity()
    if identity['role'] != 'customer':
        return jsonify({'error': 'Customer access required'}), 403
    orders = (Order.query
              .filter_by(customer_id=identity['id'])
              .order_by(Order.created_at.desc())
              .all())
    return jsonify({'orders': [o.to_dict() for o in orders]}), 200


# ── GET /api/orders/incoming ──────────────────────────────────────────
@orders_bp.route('/incoming', methods=['GET'])
@jwt_required()
def incoming_orders():
    identity = _get_identity()
    if identity['role'] != 'seller':
        return jsonify({'error': 'Seller access required'}), 403
    orders = (Order.query
              .filter_by(seller_id=identity['id'])
              .order_by(Order.created_at.desc())
              .all())
    return jsonify({'orders': [o.to_dict() for o in orders]}), 200


# ── PATCH /api/orders/<id>/status ────────────────────────────────────
@orders_bp.route('/<int:order_id>/status', methods=['PATCH'])
@jwt_required()
def update_order(order_id):
    identity = _get_identity()
    role     = identity['role']

    if role not in ROLE_STATUS_MAP:
        return jsonify({'error': 'Not authorised to update orders'}), 403

    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    order = Order.query.get(order_id)
    if not order:
        return jsonify({'error': f'Order #{order_id} not found'}), 404

    # Ownership checks
    if role == 'seller' and order.seller_id != identity['id']:
        return jsonify({'error': 'You can only update your own orders'}), 403
    if role == 'driver' and order.driver_id != identity['id']:
        return jsonify({'error': 'This delivery is not assigned to you'}), 403
    if role == 'customer' and order.customer_id != identity['id']:
        return jsonify({'error': 'This is not your order'}), 403

    new_status   = data.get('status')
    est_time_raw = data.get('est_delivery_min')
    seller_note  = data.get('seller_note')

    if new_status is None and est_time_raw is None and seller_note is None:
        return jsonify({'error': 'Provide at least "status", "est_delivery_min", or "seller_note"'}), 400

    changed = False

    # ── Status update ──────────────────────────────────────────────
    if new_status is not None:
        new_status = str(new_status).strip().lower()

        if new_status not in VALID_STATUSES:
            return jsonify({'error': f'Invalid status: {new_status}'}), 400

        allowed = ROLE_STATUS_MAP[role]
        if new_status not in allowed:
            return jsonify({'error': f'Your role cannot set status to "{new_status}"'}), 403

        if order.status == new_status:
            return jsonify({'error': f'Order is already "{new_status}"'}), 409

        if order.status in ('customer_confirmed', 'cancelled') and role != 'admin':
            return jsonify({'error': 'Cannot update a completed or cancelled order'}), 400

        # ── Customer cancel: only allowed while pending ────────────
        if new_status == 'cancelled' and role == 'customer':
            if order.status != 'pending':
                return jsonify({'error': 'You can only cancel orders that are still pending'}), 400

        # ── Business rule checks ───────────────────────────────────

        # Seller can only mark ready_for_pickup if it's a delivery order
        if new_status == 'ready_for_pickup' and _is_pickup(order):
            return jsonify({'error': 'Use "ready_to_collect" for pickup orders instead'}), 400

        # Seller can only mark ready_to_collect if it's a pickup order
        if new_status == 'ready_to_collect' and not _is_pickup(order):
            return jsonify({'error': 'Use "ready_for_pickup" for delivery orders instead'}), 400

        # Admin can only assign driver after seller marks ready_for_pickup
        if new_status == 'picked_up' and order.status != 'ready_for_pickup':
            return jsonify({'error': 'Order is not ready for pickup yet'}), 400

        # Customer can only confirm after delivered
        if new_status == 'customer_confirmed' and order.status not in ('delivered', 'ready_to_collect'):
            return jsonify({'error': 'You can only confirm after the order is delivered or ready to collect'}), 400

        # Restore stock on cancellation
        if new_status == 'cancelled' and order.status != 'cancelled':
            for item in order.items:
                product = Product.query.get(item.product_id)
                if product:
                    product.quantity    += item.quantity
                    product.is_available = True

        order.status = new_status
        changed = True

    # ── seller_note update ─────────────────────────────────────────
    if seller_note is not None:
        if role not in ('seller', 'admin'):
            return jsonify({'error': 'Only sellers can add a note to orders'}), 403
        order.seller_note = seller_note.strip() or None
        changed = True

    # ── est_delivery_min update ────────────────────────────────────
    if est_time_raw is not None:
        try:
            est_min = int(str(est_time_raw).strip())
            if est_min < 1 or est_min > 300:
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({'error': 'est_delivery_min must be 1–300'}), 400
        order.est_delivery_min = est_min
        changed = True

    if not changed:
        return jsonify({'error': 'No valid fields to update'}), 400

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Update failed. Please try again.'}), 500

    broadcast('order_updated', {'order_id': order.id, 'status': order.status})
    return jsonify({'message': 'Order updated.', 'order': order.to_dict()}), 200
