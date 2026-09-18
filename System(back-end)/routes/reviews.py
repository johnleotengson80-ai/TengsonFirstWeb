
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, Review, Product, Order, OrderItem

reviews_bp = Blueprint('reviews', __name__)


def _get_identity():
    return {'id': int(get_jwt_identity()), 'role': get_jwt()['role']}


# ── POST /api/reviews/ ────────────────────────────────────────────────
# Customer submits a rating and comment for a product
@reviews_bp.route('/', methods=['POST'])
@jwt_required()
def submit_review():
    identity = _get_identity()

    # Only customers can review
    if identity['role'] != 'customer':
        return jsonify({'error': 'Only customers can submit reviews'}), 403

    data       = request.get_json(silent=True)
    product_id = data.get('product_id')
    order_id   = data.get('order_id')
    rating     = data.get('rating')
    comment    = (data.get('comment') or '').strip()

    # Validate required fields
    if not product_id or not order_id or not rating:
        return jsonify({'error': 'product_id, order_id, and rating are required'}), 400

    # Validate rating is 1-5
    try:
        rating = int(rating)
        if rating < 1 or rating > 5:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({'error': 'Rating must be a number between 1 and 5'}), 400

    # Validate comment length
    if len(comment) > 500:
        return jsonify({'error': 'Comment must be under 500 characters'}), 400

    # Check product exists
    product = Product.query.get(product_id)
    if not product:
        return jsonify({'error': 'Product not found'}), 404

    # Check order exists and belongs to this customer
    order = Order.query.get(order_id)
    if not order or order.customer_id != identity['id']:
        return jsonify({'error': 'Order not found'}), 404

    # Check order is delivered or customer_confirmed — can't review before delivery
    if order.status not in ('delivered', 'customer_confirmed'):
        return jsonify({'error': 'You can only review products from delivered orders'}), 400

    # Check product was actually in this order
    order_item = OrderItem.query.filter_by(
        order_id=order_id, product_id=product_id
    ).first()
    if not order_item:
        return jsonify({'error': 'This product was not part of that order'}), 400

    # Check if customer already reviewed this product for this order
    existing = Review.query.filter_by(
        user_id=identity['id'],
        product_id=product_id,
        order_id=order_id
    ).first()
    if existing:
        return jsonify({'error': 'You have already reviewed this product for this order'}), 409

    # Save the review
    review = Review(
        product_id = product_id,
        user_id    = identity['id'],
        order_id   = order_id,
        rating     = rating,
        comment    = comment or None
    )

    try:
        db.session.add(review)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Could not save review. Please try again.'}), 500

    return jsonify({
        'message': 'Review submitted! Thank you for your feedback 🌟',
        'review':  review.to_dict()
    }), 201


# ── GET /api/reviews/<product_id> ─────────────────────────────────────
# Anyone can see reviews for a product
@reviews_bp.route('/<int:product_id>', methods=['GET'])
def get_reviews(product_id):
    product = Product.query.get(product_id)
    if not product:
        return jsonify({'error': 'Product not found'}), 404

    reviews = (Review.query
               .filter_by(product_id=product_id)
               .order_by(Review.created_at.desc())
               .all())

    avg = 0
    if reviews:
        avg = round(sum(r.rating for r in reviews) / len(reviews), 1)

    return jsonify({
        'product_id':   product_id,
        'product_name': product.name,
        'avg_rating':   avg,
        'total':        len(reviews),
        'reviews':      [r.to_dict() for r in reviews]
    }), 200


# ── GET /api/reviews/my-reviews ───────────────────────────────────────
# Customer sees which products they have already reviewed
@reviews_bp.route('/my-reviews', methods=['GET'])
@jwt_required()
def my_reviews():
    identity = _get_identity()
    reviews  = Review.query.filter_by(user_id=identity['id']).all()
    # Return a set of (product_id, order_id) so frontend knows which are already reviewed
    return jsonify({
        'reviewed': [
            {'product_id': r.product_id, 'order_id': r.order_id}
            for r in reviews
        ]
    }), 200
