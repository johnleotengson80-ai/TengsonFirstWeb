from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

# ============================================
# USER MODEL
# ============================================
class User(db.Model):
    __tablename__ = 'users'

    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role          = db.Column(db.Enum('customer','seller','driver','admin'), nullable=False)
    full_name     = db.Column(db.String(100))
    email         = db.Column(db.String(100), unique=True)
    phone         = db.Column(db.String(20))
    address       = db.Column(db.Text)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    products           = db.relationship('Product', foreign_keys='Product.seller_id', backref='seller', lazy=True)
    orders_as_customer = db.relationship('Order', foreign_keys='Order.customer_id', backref='customer', lazy=True)
    orders_as_seller   = db.relationship('Order', foreign_keys='Order.seller_id', backref='seller_user', lazy=True)
    orders_as_driver   = db.relationship('Order', foreign_keys='Order.driver_id', backref='driver', lazy=True)
    reviews            = db.relationship('Review', backref='reviewer', lazy=True)

    def to_dict(self):
        return {
            'id':         self.id,
            'username':   self.username,
            'role':       self.role,
            'full_name':  self.full_name,
            'email':      self.email,
            'phone':      self.phone,
            'address':    self.address,
            'created_at': self.created_at.isoformat()
        }


# ============================================
# PRODUCT MODEL
# ============================================
class Product(db.Model):
    __tablename__ = 'products'

    id           = db.Column(db.Integer, primary_key=True)
    seller_id    = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name         = db.Column(db.String(100), nullable=False)
    description  = db.Column(db.Text)
    category     = db.Column(db.String(50))
    price        = db.Column(db.Numeric(10,2), nullable=False)
    image_path   = db.Column(db.String(255))
    is_available = db.Column(db.Boolean, default=True)
    quantity     = db.Column(db.Integer, default=0)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)

    order_items = db.relationship('OrderItem', backref='product', lazy=True)
    reviews     = db.relationship('Review', backref='product', lazy=True)

    def to_dict(self):
        avg = 0
        if self.reviews:
            avg = round(sum(r.rating for r in self.reviews) / len(self.reviews), 1)
        return {
            'id':           self.id,
            'seller_id':    self.seller_id,
            'name':         self.name,
            'description':  self.description,
            'category':     self.category,
            'price':        float(self.price),
            'image_url':    f'/uploads/{self.image_path}' if self.image_path else None,
            'is_available': self.is_available,
            'quantity':     self.quantity,
            'created_at':   self.created_at.isoformat(),
            'avg_rating':   avg,
            'review_count': len(self.reviews)
        }


# ============================================
# ORDER MODEL
# New statuses added:
#   ready_for_pickup  — seller signals food is ready, admin can now assign driver
#   picked_up         — driver confirms they collected the order
#   customer_confirmed — customer confirms they received the order
# ============================================
class Order(db.Model):
    __tablename__ = 'orders'

    id               = db.Column(db.Integer, primary_key=True)
    customer_id      = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    seller_id        = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    driver_id        = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    payment_method   = db.Column(db.Enum('gcash','paymaya','cod','pickup'), nullable=False)

    # Full status lifecycle
    status = db.Column(
        db.Enum(
            'pending',            # order just placed
            'confirmed',          # seller confirmed
            'preparing',          # seller is cooking
            'ready_for_pickup',   # seller: food is done, admin can assign driver
            'picked_up',          # driver: picked up from seller
            'out_for_delivery',   # driver is on the way to customer
            'delivered',          # driver marked as delivered
            'customer_confirmed', # customer confirmed receipt
            'ready_to_collect',   # PICKUP only: food is ready for customer to collect
            'cancelled'
        ),
        default='pending'
    )

    subtotal         = db.Column(db.Numeric(10,2), nullable=False, default=0)
    rider_fee        = db.Column(db.Numeric(10,2), nullable=False, default=49)
    total_amount     = db.Column(db.Numeric(10,2), nullable=False)
    delivery_address = db.Column(db.Text)
    notes            = db.Column(db.Text)
    seller_note      = db.Column(db.Text)
    reference_no     = db.Column(db.String(50))
    est_delivery_min = db.Column(db.Integer, default=30)
    created_at       = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at       = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    items = db.relationship('OrderItem', backref='order', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id':               self.id,
            'customer_id':      self.customer_id,
            'seller_id':        self.seller_id,
            'driver_id':        self.driver_id,
            'payment_method':   self.payment_method,
            'status':           self.status,
            'subtotal':         float(self.subtotal),
            'rider_fee':        float(self.rider_fee),
            'total_amount':     float(self.total_amount),
            'delivery_address': self.delivery_address,
            'notes':            self.notes,
            'seller_note':      self.seller_note,
            'reference_no':     self.reference_no,
            'est_delivery_min': self.est_delivery_min,
            'items':            [item.to_dict() for item in self.items],
            'created_at':       self.created_at.isoformat(),
            'updated_at':       self.updated_at.isoformat() if self.updated_at else None,
            
            'customer_name':    (self.customer.full_name or self.customer.username) if self.customer else None,
            'customer_username': self.customer.username if self.customer else None,
            'customer_phone':   self.customer.phone if self.customer else None,
            'seller_name':      (self.seller_user.full_name or self.seller_user.username) if self.seller_user else None,
            'seller_phone':     self.seller_user.phone if self.seller_user else None,
            'driver_name':      (self.driver.full_name or self.driver.username) if self.driver else None,
            'driver_phone':     self.driver.phone if self.driver else None,
        }


# ============================================
# ORDER ITEM MODEL
# ============================================
class OrderItem(db.Model):
    __tablename__ = 'order_items'

    id             = db.Column(db.Integer, primary_key=True)
    order_id       = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False)
    product_id     = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    quantity       = db.Column(db.Integer, nullable=False, default=1)
    price_at_order = db.Column(db.Numeric(10,2), nullable=False)

    def to_dict(self):
        return {
            'id':             self.id,
            'order_id':       self.order_id,
            'product_id':     self.product_id,
            'product_name':   self.product.name if self.product else None,
            'quantity':       self.quantity,
            'price_at_order': float(self.price_at_order)
        }


# ============================================
# REVIEW MODEL
# ============================================
class Review(db.Model):
    __tablename__ = 'reviews'

    id         = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    order_id   = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False)
    rating     = db.Column(db.Integer, nullable=False)
    comment    = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id':         self.id,
            'product_id': self.product_id,
            'user_id':    self.user_id,
            'order_id':   self.order_id,
            'username':   self.reviewer.username if self.reviewer else 'Unknown',
            'rating':     self.rating,
            'comment':    self.comment,
            'created_at': self.created_at.isoformat()
        }
