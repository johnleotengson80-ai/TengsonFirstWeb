from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Order
from realtime import broadcast

driver_bp = Blueprint('driver', __name__)

def get_identity():
    user_id = int(get_jwt_identity())
    role    = get_jwt()['role']
    return {'id': user_id, 'role': role}


# ============================================
# GET /api/driver/deliveries
# ============================================
@driver_bp.route('/deliveries', methods=['GET'])
@jwt_required()
def my_deliveries():
    identity = get_identity()

    if identity['role'] != 'driver':
        return jsonify({'error': 'Only drivers can access this'}), 403

    orders = Order.query.filter_by(driver_id=identity['id'])\
                        .order_by(Order.created_at.desc()).all()

    return jsonify({'deliveries': [o.to_dict() for o in orders]}), 200


# ============================================
# PATCH /api/driver/deliveries/<id>/delivered
# ============================================
@driver_bp.route('/deliveries/<int:order_id>/delivered', methods=['PATCH'])
@jwt_required()
def mark_delivered(order_id):
    identity = get_identity()

    if identity['role'] != 'driver':
        return jsonify({'error': 'Only drivers can mark deliveries'}), 403

    order = Order.query.get(order_id)
    if not order:
        return jsonify({'error': 'Order not found'}), 404

    if order.driver_id != identity['id']:
        return jsonify({'error': 'This delivery is not assigned to you'}), 403

    order.status = 'delivered'
    db.session.commit()

    broadcast('order_updated', {'order_id': order.id, 'status': order.status})
    return jsonify({
        'message': f'Order #{order_id} marked as delivered!',
        'order':   order.to_dict()
    }), 200
