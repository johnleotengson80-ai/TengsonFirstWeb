import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

import bcrypt
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateTable

BACKEND_DIR = Path(__file__).resolve().parents[1] / 'System(back-end)'
sys.path.insert(0, str(BACKEND_DIR))

from models import Product, User, db


class ProductCreateApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix='product-create-test-')
        self.previous_env = {
            key: os.environ.get(key)
            for key in ('DATABASE_URL', 'JWT_SECRET_KEY', 'UPLOAD_FOLDER', 'VERCEL')
        }
        os.environ['DATABASE_URL'] = f"sqlite:///{Path(self.temp_dir.name, 'test.sqlite').as_posix()}"
        os.environ['JWT_SECRET_KEY'] = 'test-secret-long-enough-for-jwt-signing'
        os.environ['UPLOAD_FOLDER'] = str(Path(self.temp_dir.name, 'uploads'))
        os.environ['VERCEL'] = '1'

        from app import create_app

        self.app = create_app()
        self.app.config['TESTING'] = True
        with self.app.app_context():
            seller = User(
                username='test-seller',
                password_hash=bcrypt.hashpw(b'test-password', bcrypt.gensalt()).decode(),
                role='seller',
            )
            db.session.add(seller)
            db.session.commit()

        self.client = self.app.test_client()
        login = self.client.post(
            '/api/auth/login',
            json={'username': 'test-seller', 'password': 'test-password'},
        )
        self.assertEqual(login.status_code, 200, login.get_data(as_text=True))
        self.headers = {'Authorization': f"Bearer {login.get_json()['token']}"}

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.engine.dispose()
        for key, value in self.previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.temp_dir.cleanup()

    def test_screenshot_payload_saves_with_blank_category_and_phone_image(self):
        image = b'x' * (280 * 1024)
        response = self.client.post(
            '/api/products/',
            headers=self.headers,
            data={
                'name': 'Phone Photo Meal',
                'price': '129.50',
                'quantity': '15',
                'description': 'Screenshot form description',
                'image': (io.BytesIO(image), 'optimized.jpg', 'image/jpeg'),
            },
            content_type='multipart/form-data',
        )

        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        product = response.get_json()['product']
        self.assertEqual(product['category'], None)
        self.assertEqual(product['name'], 'Phone Photo Meal')
        self.assertTrue(product['image_url'].startswith('data:image/jpeg;base64,'))
        self.assertGreater(len(product['image_url'].encode()), 65_535)

    def test_invalid_payloads_return_actionable_json_errors(self):
        missing_name = self.client.post(
            '/api/products/',
            headers=self.headers,
            data={'price': '10', 'quantity': '1'},
            content_type='multipart/form-data',
        )
        self.assertEqual(missing_name.status_code, 400)
        self.assertEqual(missing_name.get_json()['error'], 'Food name is required')

        bad_price = self.client.post(
            '/api/products/',
            headers=self.headers,
            data={'name': 'Bad price', 'price': '0', 'quantity': '1'},
            content_type='multipart/form-data',
        )
        self.assertEqual(bad_price.status_code, 400)
        self.assertIn('valid price', bad_price.get_json()['error'])

        bad_image = self.client.post(
            '/api/products/',
            headers=self.headers,
            data={
                'name': 'Unsupported image',
                'price': '10',
                'quantity': '1',
                'image': (io.BytesIO(b'not-supported'), 'photo.heic', 'image/heic'),
            },
            content_type='multipart/form-data',
        )
        self.assertEqual(bad_image.status_code, 400)
        self.assertIn('PNG, JPG', bad_image.get_json()['error'])

        oversized_image = self.client.post(
            '/api/products/',
            headers=self.headers,
            data={
                'name': 'Oversized image',
                'price': '10',
                'quantity': '1',
                'image': (
                    io.BytesIO(b'x' * (300 * 1024 + 1)),
                    'photo.jpg',
                    'image/jpeg',
                ),
            },
            content_type='multipart/form-data',
        )
        self.assertEqual(oversized_image.status_code, 400)
        self.assertIn('300 KB', oversized_image.get_json()['error'])

        request_too_large = self.client.post(
            '/api/products/',
            headers=self.headers,
            data={'name': 'Request too large'},
            content_type='multipart/form-data',
            environ_overrides={'CONTENT_LENGTH': str(5 * 1024 * 1024 + 1)},
        )
        self.assertEqual(request_too_large.status_code, 413)
        self.assertIn('under 5 MB', request_too_large.get_json()['error'])

    def test_mysql_product_image_column_uses_longtext(self):
        mysql_ddl = str(
            CreateTable(Product.__table__).compile(dialect=mysql.dialect())
        ).upper()
        self.assertIn('IMAGE_DATA LONGTEXT', mysql_ddl)


if __name__ == '__main__':
    unittest.main()
