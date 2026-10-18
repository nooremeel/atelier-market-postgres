require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const csrf = require('csurf');
const flash = require('connect-flash');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const errorController = require('./controllers/errorController');

const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { sequelize } = require('./db');
const { User, SellerProfile } = require('./db/models');

const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

const app = express();

// Trust reverse proxy (Vercel, Nginx, etc.) for secure cookie detection and client IP
app.set('trust proxy', 1);

// DB connection check middleware ensuring DB is ready before request processing
let dbConnected = false;
app.use(async (req, res, next) => {
    if (isTest || dbConnected) {
        return next();
    }
    try {
        await sequelize.authenticate();
        dbConnected = true;
        next();
    } catch (err) {
        console.error('[DB Connection Middleware Error]:', err);
        return res.status(500).json({
            message: 'Database connection failed',
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
        });
    }
});

// Network-backed session store in production / outside tests;
// Express-session falls back to MemoryStore during tests
let store;
if (!isTest) {
    const sessionDbUrl =
        process.env.DATABASE_URL_UNPOOLED ||
        process.env.DATABASE_URL ||
        process.env.POSTGRES_URL_NON_POOLING ||
        process.env.POSTGRES_URL ||
        'postgres://atelier:atelier@localhost:5432/atelier';
    const isCloudDb =
        sessionDbUrl.includes('neon.tech') ||
        sessionDbUrl.includes('aws.') ||
        process.env.NODE_ENV === 'production';

    store = new pgSession({
        conObject: {
            connectionString: sessionDbUrl,
            ssl: isCloudDb ? { rejectUnauthorized: false } : undefined,
        },
        tableName: 'session',
        createTableIfMissing: false,
    });
    store.on('error', (err) => {
        console.error('[Session Store Error]:', err.message);
    });
}
const csrfProtection = csrf();

const os = require('os');
const uploadDir = process.env.VERCEL ? os.tmpdir() : 'images';

const fileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, new Date().toISOString().replace(/:/g, '-') + '-' + file.originalname);
    }
});
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpg' || file.mimetype === 'image/jpeg' || file.mimetype === 'image/webp') {
        cb(null, true);
    } else {
        cb(null, false);
    }
};

app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(compression());

if (process.env.VERCEL) {
    app.use(morgan('combined'));
} else {
    try {
        const accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });
        app.use(morgan('combined', { stream: accessLogStream }));
    } catch {
        app.use(morgan('combined'));
    }
}

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(multer({ storage: fileStorage, fileFilter: fileFilter }).single('image'));


app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));

const sessionSecret = process.env.SESSION_SECRET || (isTest ? 'atelier-market-test-session-secret-32b' : crypto.randomBytes(32).toString('hex'));

app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
        httpOnly: true,
        secure: 'auto',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
}));


app.use(async (req, res, next) => {
    if (!req.session?.user?._id) {
        return next();
    }
    try {
        const user = await User.findByPk(req.session.user._id, {
            include: [{ model: SellerProfile, as: 'sellerProfile' }],
        });
        if (!user) {
            return next();
        }
        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
});
// CSRF Protection: Exempt payment webhooks and browser callbacks
app.use((req, res, next) => {
    if (
        req.path === '/api/paymob/webhook' || req.originalUrl?.startsWith('/api/paymob/webhook') ||
        req.path === '/api/paymob/callback' || req.originalUrl?.startsWith('/api/paymob/callback')
    ) {
        return next();
    }
    csrfProtection(req, res, next);
});
app.use(flash());

app.use('/api', require('./routes/api'));

const SPA_DIR = path.join(__dirname, 'public', 'app');
app.use(express.static(SPA_DIR));
app.get(/^\/(?!api(?:\/|$)|images(?:\/|$)).*/, (req, res) => {
    const indexFile = path.join(SPA_DIR, 'index.html');
    if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
    res.status(503).json({ message: 'SPA build not found. Run: cd client && npm run build' });
});


app.use(errorController.get404);
app.use((error, req, res, next) => {
    if (error.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ message: 'Invalid CSRF token', code: 'EBADCSRFTOKEN' });
    }
    const status = error.status || error.httpStatusCode || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ message: status >= 500 ? 'Internal server error' : (error.message || 'Request failed') });
});

if (require.main === module) {
    sequelize.authenticate()
        .then(() => {
            const port = process.env.PORT || 3001;
            app.listen(port, () => console.log(`Server listening on port ${port}`));
        })
        .catch(err => console.error('[Bootstrap Error]:', err));
}

module.exports = app;