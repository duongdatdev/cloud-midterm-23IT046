import express from 'express';
import { engine } from 'express-handlebars';
import session from 'express-session';
import helmet from 'helmet';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { connectDatabase } from './database.js';
import { AtlasSessionStore } from './atlas-session-store.js';
import { STUDENT, ValidationError, validateBook } from './rules.js';

const SESSION_TTL = 2 * 60 * 60 * 1000;
const COOKIE_NAME = 'books.sid';
const csrfToken = () => randomBytes(32).toString('hex');
const saveSession = (req) => new Promise((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()));
const regenerateSession = (req) => new Promise((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));

function constantTimeEqual(left, right) {
  const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value : '').digest();
  return timingSafeEqual(digest(left), digest(right));
}

async function start() {
  const config = loadConfig();
  const database = await connectDatabase(config);
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(helmet());
  app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: fileURLToPath(new URL('../views/layouts/', import.meta.url)),
    helpers: {
      money: (value) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value) || 0)
    }
  }));
  app.set('view engine', 'hbs');
  app.set('views', fileURLToPath(new URL('../views/', import.meta.url)));
  app.use('/static', express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.get('/health', async (_req, res) => {
    try {
      await database.checkHealth();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use(express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 10 }));
  app.use((_req, res, next) => {
    res.locals.student = STUDENT;
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(session({
    name: COOKIE_NAME,
    secret: config.sessionSecret,
    store: new AtlasSessionStore(database),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: SESSION_TTL }
  }));
  app.use((req, res, next) => {
    req.session.csrfToken ||= csrfToken();
    res.locals.csrfToken = req.session.csrfToken;
    res.locals.authenticated = req.session.authenticated === true;
    res.locals.loginAt = req.session.loginAt;
    if (req.method === 'POST' && !constantTimeEqual(req.body?._csrf, req.session.csrfToken)) {
      return res.status(403).render('error', { message: 'Phiên hoặc biểu mẫu đã hết hạn. Hãy tải lại trang rồi thử lại.' });
    }
    next();
  });

  async function renderHome(req, res, extra = {}, status = 200) {
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const rawPage = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
    const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1;
    const documents = await database.listBooks(search, page);
    const query = encodeURIComponent(search);
    const flash = req.session.flash;
    if (flash) delete req.session.flash;
    return res.status(status).render('home', {
      books: documents.slice(0, 20), search, page, flash,
      previousUrl: page > 1 ? `/?q=${query}&page=${page - 1}` : null,
      nextUrl: documents.length > 20 ? `/?q=${query}&page=${page + 1}` : null,
      ...extra
    });
  }

  app.get('/', async (req, res) => renderHome(req, res));
  app.get('/login', (req, res) => {
    if (req.session.authenticated) return res.redirect('/');
    res.render('login');
  });
  app.post('/login', async (req, res) => {
    const usernameMatches = constantTimeEqual(req.body.username, config.adminUsername);
    const passwordMatches = constantTimeEqual(req.body.password, config.adminPassword);
    if (!usernameMatches || !passwordMatches) {
      return res.status(401).render('login', { error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }
    await regenerateSession(req);
    req.session.authenticated = true;
    req.session.loginAt = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    req.session.csrfToken = csrfToken();
    await saveSession(req);
    res.redirect(303, '/');
  });
  app.post('/logout', async (req, res) => {
    await new Promise((resolve, reject) => req.session.destroy((err) => err ? reject(err) : resolve()));
    res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, secure: config.production, sameSite: 'lax' });
    res.redirect(303, '/login');
  });
  app.post('/books', async (req, res) => {
    if (!req.session.authenticated) return res.redirect(303, '/login');
    try {
      // Kiem tra prefix va tinh VAT o backend truoc khi luu vao Atlas.
      const book = validateBook(req.body);
      await database.insertBook(book);
      req.session.flash = `Đã thêm sách ${book.code}.`;
      await saveSession(req);
      return res.redirect(303, '/');
    } catch (err) {
      if (err instanceof ValidationError || err.code === 11000) {
        const form = Object.fromEntries(['code', 'title', 'author', 'price'].map((key) => [key,
          typeof req.body[key] === 'string' ? req.body[key].slice(0, 200) : ''
        ]));
        return renderHome(req, res, { form, error: err.code === 11000 ? 'Mã sách đã tồn tại. Hãy dùng mã khác.' : err.message }, 400);
      }
      throw err;
    }
  });
  app.use((_req, res) => res.status(404).render('error', { message: 'Không tìm thấy trang.' }));
  app.use((err, _req, res, _next) => {
    // Khong ghi URI, mat khau, request body hay noi dung session vao log.
    console.error('Request failed:', err.name, typeof err.code === 'number' ? err.code : '');
    if (res.headersSent) return _next(err);
    const badRequest = err.status === 400 || err.status === 413;
    res.status(badRequest ? err.status : 500).render('error', {
      message: badRequest ? 'Dữ liệu gửi lên không hợp lệ hoặc quá lớn.' : 'Không xử lý được yêu cầu. Vui lòng thử lại sau.'
    });
  });
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`Server listening on port ${config.port}`));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => { await database.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

start().catch((err) => {
  // Thong bao config do ung dung tao khong chua gia tri bi mat.
  const safe = err.name === 'Error' && !err.message.includes('mongodb://') && !err.message.includes('mongodb+srv://');
  console.error(safe ? err.message : 'Khoi dong that bai. Kiem tra Environment va Atlas.');
  process.exit(1);
});
