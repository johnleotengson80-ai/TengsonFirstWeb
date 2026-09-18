from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, User, Order, Product, OrderItem
from sqlalchemy import func, extract
from datetime import datetime, timedelta
from realtime import broadcast

admin_bp = Blueprint('admin', __name__)


def get_identity():
    return {'id': int(get_jwt_identity()), 'role': get_jwt()['role']}


def require_admin(identity):
    if identity['role'] != 'admin':
        return jsonify({'error': 'Admin only'}), 403
    return None


# ── GET /api/admin/stats ──────────────────────────────────────────────
@admin_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_stats():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    revenue = db.session.query(
        func.sum(Order.total_amount)
    ).filter(Order.status.in_(['delivered','customer_confirmed'])).scalar()

    return jsonify({'stats': {
        'total_users':    User.query.count(),
        'total_orders':   Order.query.count(),
        'total_products': Product.query.count(),
        'pending_orders': Order.query.filter_by(status='pending').count(),
        'delivered_orders': Order.query.filter(
            Order.status.in_(['delivered','customer_confirmed'])
        ).count(),
        'total_revenue':  float(revenue or 0),
        # Orders waiting for driver assignment
        'needs_driver': Order.query.filter_by(status='ready_for_pickup').filter(
            Order.driver_id == None
        ).count(),
    }}), 200


# ── GET /api/admin/analytics/monthly ─────────────────────────────────
@admin_bp.route('/analytics/monthly', methods=['GET'])
@jwt_required()
def monthly_analytics():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    year = request.args.get('year', datetime.now().year, type=int)
    rows = db.session.query(
        extract('month', Order.created_at).label('month'),
        func.count(Order.id).label('order_count'),
        func.sum(Order.total_amount).label('revenue'),
    ).filter(
        extract('year', Order.created_at) == year,
        Order.status.in_(['delivered','customer_confirmed'])
    ).group_by(extract('month', Order.created_at)).order_by(extract('month', Order.created_at)).all()

    month_names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    monthly_data = {int(r.month): r for r in rows}
    result = []
    for i in range(1, 13):
        row = monthly_data.get(i)
        result.append({
            'month':       month_names[i-1],
            'month_num':   i,
            'order_count': int(row.order_count) if row else 0,
            'revenue':     float(row.revenue) if row else 0,
        })

    return jsonify({
        'year':        year,
        'months':      result,
        'year_total':  sum(m['revenue'] for m in result),
        'year_orders': sum(m['order_count'] for m in result),
    }), 200


# ── GET /api/admin/analytics/top-products ────────────────────────────
@admin_bp.route('/analytics/top-products', methods=['GET'])
@jwt_required()
def top_products():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    rows = db.session.query(
        Product.name,
        func.sum(OrderItem.quantity).label('total_sold'),
        func.sum(OrderItem.quantity * OrderItem.price_at_order).label('total_revenue')
    ).join(OrderItem, OrderItem.product_id == Product.id
    ).join(Order, Order.id == OrderItem.order_id
    ).filter(Order.status.in_(['delivered','customer_confirmed'])
    ).group_by(Product.id, Product.name
    ).order_by(func.sum(OrderItem.quantity).desc()
    ).limit(5).all()

    return jsonify({'top_products': [
        {'name': r.name, 'total_sold': int(r.total_sold), 'total_revenue': float(r.total_revenue)}
        for r in rows
    ]}), 200


# ── GET /api/admin/analytics/order-status ────────────────────────────
@admin_bp.route('/analytics/order-status', methods=['GET'])
@jwt_required()
def order_status_breakdown():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    rows = db.session.query(
        Order.status, func.count(Order.id).label('count')
    ).group_by(Order.status).all()

    return jsonify({'breakdown': [
        {'status': r.status, 'count': int(r.count)} for r in rows
    ]}), 200


# ── GET /api/admin/analytics/recent ──────────────────────────────────
@admin_bp.route('/analytics/recent', methods=['GET'])
@jwt_required()
def recent_analytics():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    seven_days_ago = datetime.now() - timedelta(days=6)
    rows = db.session.query(
        func.date(Order.created_at).label('date'),
        func.count(Order.id).label('order_count'),
        func.sum(Order.total_amount).label('revenue'),
    ).filter(
        Order.created_at >= seven_days_ago,
        Order.status.in_(['delivered','customer_confirmed'])
    ).group_by(func.date(Order.created_at)).order_by(func.date(Order.created_at)).all()

    return jsonify({'recent': [
        {'date': str(r.date), 'order_count': int(r.order_count), 'revenue': float(r.revenue or 0)}
        for r in rows
    ]}), 200


# ── GET /api/admin/users ──────────────────────────────────────────────
@admin_bp.route('/users', methods=['GET'])
@jwt_required()
def get_all_users():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err
    role_filter = request.args.get('role')
    query = User.query
    if role_filter:
        query = query.filter_by(role=role_filter)
    return jsonify({'users': [u.to_dict() for u in query.all()]}), 200


# ── DELETE /api/admin/users/<id> ──────────────────────────────────────
@admin_bp.route('/users/<int:user_id>', methods=['DELETE'])
@jwt_required()
def delete_user(user_id):
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.id == identity['id']:
        return jsonify({'error': 'You cannot delete your own account'}), 400

    username = user.username
    try:
        customer_order_ids = [o.id for o in Order.query.filter_by(customer_id=user_id).all()]
        seller_order_ids   = [o.id for o in Order.query.filter_by(seller_id=user_id).all()]
        all_order_ids      = list(set(customer_order_ids + seller_order_ids))
        if all_order_ids:
            OrderItem.query.filter(OrderItem.order_id.in_(all_order_ids)).delete(synchronize_session=False)
        Order.query.filter_by(driver_id=user_id).update({'driver_id': None}, synchronize_session=False)
        Order.query.filter_by(customer_id=user_id).delete(synchronize_session=False)
        Order.query.filter_by(seller_id=user_id).delete(synchronize_session=False)
        Product.query.filter_by(seller_id=user_id).delete(synchronize_session=False)
        db.session.delete(user)
        db.session.commit()
        broadcast('admin_updated', {'entity': 'user', 'user_id': user_id})
        return jsonify({'message': f'User "{username}" deleted.'}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[DELETE USER ERROR] {e}")
        return jsonify({'error': f'Could not delete: {str(e)}'}), 500


# ── POST /api/admin/users ─────────────────────────────────────────────
@admin_bp.route('/users', methods=['POST'])
@jwt_required()
def create_user():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    role     = (data.get('role') or 'customer').strip()

    if not username:
        return jsonify({'error': '"username" is required'}), 400
    if not password:
        return jsonify({'error': '"password" is required'}), 400
    if role not in ['admin', 'seller', 'driver', 'customer']:
        return jsonify({'error': 'Invalid role'}), 400

    # Check if username already exists
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 409

    # Check if email already exists (if provided)
    email = (data.get('email') or '').strip() or None
    if email and User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 409

    import bcrypt
    # Hash password
    password_hash = bcrypt.hashpw(
        password.encode('utf-8'),
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
        return jsonify({'error': f'Failed to create user: {str(e)}'}), 500

    broadcast('user_updated', {'user_id': new_user.id, 'role': new_user.role})
    return jsonify({
        'message': f'User "{username}" created successfully as {role.upper()}!',
        'user':    new_user.to_dict()
    }), 201


# ── PATCH /api/admin/users/<int:user_id> ──────────────────────────────────
@admin_bp.route('/users/<int:user_id>', methods=['PATCH'])
@jwt_required()
def update_user(user_id):
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json(silent=True) or {}
    
    username = (data.get('username') or '').strip()
    role     = (data.get('role') or '').strip()
    
    if username:
        # Check uniqueness if username changed
        if username != user.username:
            if User.query.filter_by(username=username).first():
                return jsonify({'error': 'Username already taken'}), 409
            user.username = username
            
    if role:
        if role not in ['admin', 'seller', 'driver', 'customer']:
            return jsonify({'error': 'Invalid role'}), 400
        user.role = role

    email = (data.get('email') or '').strip() or None
    if email and email != user.email:
        if User.query.filter_by(email=email).first():
            return jsonify({'error': 'Email already registered'}), 409
        user.email = email
    elif 'email' in data:
        user.email = email

    if 'full_name' in data:
        user.full_name = (data.get('full_name') or '').strip() or None
    if 'phone' in data:
        user.phone = (data.get('phone') or '').strip() or None
    if 'address' in data:
        user.address = (data.get('address') or '').strip() or None

    password = (data.get('password') or '').strip()
    if password:
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        import bcrypt
        user.password_hash = bcrypt.hashpw(
            password.encode('utf-8'),
            bcrypt.gensalt()
        ).decode('utf-8')

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Failed to update user: {str(e)}'}), 500

    broadcast('admin_updated', {'entity': 'user', 'user_id': user.id})
    return jsonify({
        'message': f'User "{user.username}" updated successfully!',
        'user':    user.to_dict()
    }), 200


# ── GET /api/admin/orders ─────────────────────────────────────────────
@admin_bp.route('/orders', methods=['GET'])
@jwt_required()
def get_all_orders():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err
    orders = Order.query.order_by(Order.created_at.desc()).all()
    return jsonify({'orders': [o.to_dict() for o in orders]}), 200




# ── GET /api/admin/analytics/daily ───────────────────────────────────
# Returns hourly breakdown for a specific date
@admin_bp.route('/analytics/daily', methods=['GET'])
@jwt_required()
def daily_analytics():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    try:
        target_date = datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

    rows = db.session.query(
        extract('hour', Order.created_at).label('hour'),
        func.count(Order.id).label('order_count'),
        func.sum(Order.total_amount).label('revenue'),
    ).filter(
        func.date(Order.created_at) == target_date.date(),
        Order.status.in_(['delivered', 'customer_confirmed'])
    ).group_by(
        extract('hour', Order.created_at)
    ).order_by(
        extract('hour', Order.created_at)
    ).all()

    # Build full 24-hour array
    hourly_map = {int(r.hour): r for r in rows}
    hours = []
    for h in range(24):
        row = hourly_map.get(h)
        hours.append({
            'hour':        h,
            'order_count': int(row.order_count) if row else 0,
            'revenue':     float(row.revenue)   if row else 0,
        })

    total_revenue = sum(h['revenue']     for h in hours)
    total_orders  = sum(h['order_count'] for h in hours)

    return jsonify({
        'date':          date_str,
        'hours':         hours,
        'total_revenue': total_revenue,
        'total_orders':  total_orders,
    }), 200


# ── GET /api/admin/analytics/weekly ──────────────────────────────────
# Returns daily breakdown for a specific week (format: YYYY-Www)
@admin_bp.route('/analytics/weekly', methods=['GET'])
@jwt_required()
def weekly_analytics():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    week_str = request.args.get('week', '')
    try:
        # Parse YYYY-Www format
        year, week = week_str.split('-W')
        year = int(year)
        week = int(week)
        # Get Monday of that week
        from datetime import date
        import datetime as dt
        week_start = dt.datetime.strptime(f'{year}-W{week:02d}-1', '%Y-W%W-%w')
    except Exception:
        # Default to current week
        today      = datetime.now()
        week_start = today - timedelta(days=today.weekday())

    week_end = week_start + timedelta(days=6)

    rows = db.session.query(
        func.date(Order.created_at).label('date'),
        func.count(Order.id).label('order_count'),
        func.sum(Order.total_amount).label('revenue'),
    ).filter(
        Order.created_at >= week_start,
        Order.created_at <= week_end + timedelta(days=1),
        Order.status.in_(['delivered', 'customer_confirmed'])
    ).group_by(
        func.date(Order.created_at)
    ).order_by(
        func.date(Order.created_at)
    ).all()

    day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    date_map  = {str(r.date): r for r in rows}

    days = []
    for i in range(7):
        d        = week_start + timedelta(days=i)
        date_key = d.strftime('%Y-%m-%d')
        row      = date_map.get(date_key)
        days.append({
            'date':        date_key,
            'day_name':    day_names[i],
            'order_count': int(row.order_count) if row else 0,
            'revenue':     float(row.revenue)   if row else 0,
        })

    return jsonify({
        'week':          week_str,
        'week_start':    week_start.strftime('%Y-%m-%d'),
        'week_end':      week_end.strftime('%Y-%m-%d'),
        'days':          days,
        'total_revenue': sum(d['revenue']     for d in days),
        'total_orders':  sum(d['order_count'] for d in days),
    }), 200


# ── GET /api/admin/analytics/monthly-detail ──────────────────────────
# Returns daily breakdown for a specific month
@admin_bp.route('/analytics/monthly-detail', methods=['GET'])
@jwt_required()
def monthly_detail_analytics():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    year  = request.args.get('year',  datetime.now().year,  type=int)
    month = request.args.get('month', datetime.now().month, type=int)

    if not (1 <= month <= 12):
        return jsonify({'error': 'Month must be 1-12'}), 400

    import calendar
    days_in_month = calendar.monthrange(year, month)[1]

    rows = db.session.query(
        extract('day', Order.created_at).label('day'),
        func.count(Order.id).label('order_count'),
        func.sum(Order.total_amount).label('revenue'),
    ).filter(
        extract('year',  Order.created_at) == year,
        extract('month', Order.created_at) == month,
        Order.status.in_(['delivered', 'customer_confirmed'])
    ).group_by(
        extract('day', Order.created_at)
    ).order_by(
        extract('day', Order.created_at)
    ).all()

    day_map = {int(r.day): r for r in rows}
    days    = []
    for d in range(1, days_in_month + 1):
        row = day_map.get(d)
        days.append({
            'day':         d,
            'order_count': int(row.order_count) if row else 0,
            'revenue':     float(row.revenue)   if row else 0,
        })

    return jsonify({
        'year':          year,
        'month':         month,
        'days':          days,
        'total_revenue': sum(d['revenue']     for d in days),
        'total_orders':  sum(d['order_count'] for d in days),
    }), 200


# ── GET /api/admin/analytics/yearly ──────────────────────────────────
# Returns monthly breakdown for a specific year
@admin_bp.route('/analytics/yearly', methods=['GET'])
@jwt_required()
def yearly_analytics():
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    year = request.args.get('year', datetime.now().year, type=int)

    rows = db.session.query(
        extract('month', Order.created_at).label('month'),
        func.count(Order.id).label('order_count'),
        func.sum(Order.total_amount).label('revenue'),
    ).filter(
        extract('year', Order.created_at) == year,
        Order.status.in_(['delivered', 'customer_confirmed'])
    ).group_by(
        extract('month', Order.created_at)
    ).order_by(
        extract('month', Order.created_at)
    ).all()

    month_names = ['Jan','Feb','Mar','Apr','May','Jun',
                   'Jul','Aug','Sep','Oct','Nov','Dec']
    month_map   = {int(r.month): r for r in rows}
    months      = []
    for i in range(1, 13):
        row = month_map.get(i)
        months.append({
            'month':       month_names[i-1],
            'month_num':   i,
            'order_count': int(row.order_count) if row else 0,
            'revenue':     float(row.revenue)   if row else 0,
        })

    return jsonify({
        'year':        year,
        'months':      months,
        'year_total':  sum(m['revenue']     for m in months),
        'year_orders': sum(m['order_count'] for m in months),
    }), 200


# ── POST /api/admin/orders/<id>/assign-driver ─────────────────────────
# Admin can ONLY assign when status is 'ready_for_pickup'
@admin_bp.route('/orders/<int:order_id>/assign-driver', methods=['POST'])
@jwt_required()
def assign_driver(order_id):
    identity = get_identity()
    err = require_admin(identity)
    if err: return err

    data      = request.get_json(silent=True)
    driver_id = data.get('driver_id')
    est_min   = data.get('est_delivery_min', 30)

    order = Order.query.get(order_id)
    if not order:
        return jsonify({'error': 'Order not found'}), 404

    # ── KEY RULE: can only assign after seller marks ready_for_pickup ──
    if order.status != 'ready_for_pickup':
        return jsonify({
            'error': f'Cannot assign driver yet. Order status is "{order.status}". '
                     f'Wait for the seller to mark the food as ready.'
        }), 400

    driver = User.query.get(driver_id)
    if not driver or driver.role != 'driver':
        return jsonify({'error': 'Invalid driver'}), 400

    # Check driver is not already on a delivery
    active = Order.query.filter(
        Order.driver_id == driver_id,
        Order.status.in_(['picked_up', 'out_for_delivery'])
    ).first()
    if active:
        return jsonify({'error': f'Driver "{driver.username}" is already busy on Order #{active.id}'}), 409

    try:
        order.driver_id        = driver_id
        order.est_delivery_min = int(est_min)
        # Status stays as ready_for_pickup — driver will change it to picked_up
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Assignment failed: {str(e)}'}), 500

    broadcast('driver_assigned', {'order_id': order.id, 'driver_id': driver_id})
    return jsonify({
        'message': f'Driver "{driver.username}" assigned to Order #{order_id}. '
                   f'Waiting for driver to confirm pickup.',
        'order': order.to_dict()
    }), 200
