// Lab 3: REST API with query parameters, validation and consistent responses.
const express = require('express');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const app = express();
app.use(express.json()); // read JSON request bodies

const dbPath = path.join(__dirname, 'books.db');
const PORT = process.env.PORT || 3000;
let db = null;

// Open the database first; start the server only if that works.
const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}/`);
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();


const sendError = (res, status, message) => res.status(status).json({ message });

const isValidId = (value) => /^[1-9]\d*$/.test(value);


const SORTABLE_COLUMNS = ['id', 'title', 'author', 'price', 'pages'];


const toNumber = (value) => {
  if (value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};


const validateBook = (body) => {
  const { title, author, price, pages } = body || {};
  if (typeof title !== 'string' || title.trim() === '') {
    return 'title is required and must be a non-empty string';
  }
  if (typeof author !== 'string' || author.trim() === '') {
    return 'author is required and must be a non-empty string';
  }
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    return 'price is required and must be a non-negative number';
  }
  if (pages !== undefined && pages !== null) {
    if (!Number.isInteger(pages) || pages <= 0) {
      return 'pages must be a positive integer when provided';
    }
  }
  return null;
};


app.get('/books/', async (req, res) => {
  const {
    search_q = '',
    order_by = 'id',
    order = 'ASC',
  } = req.query;


  if (!SORTABLE_COLUMNS.includes(order_by)) {
    return sendError(res, 400, `order_by must be one of: ${SORTABLE_COLUMNS.join(', ')}`);
  }
  const direction = String(order).toUpperCase();
  if (direction !== 'ASC' && direction !== 'DESC') {
    return sendError(res, 400, 'order must be ASC or DESC');
  }


  const limit = req.query.limit === undefined ? 10 : toNumber(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return sendError(res, 400, 'limit must be a whole number between 1 and 100');
  }
  const offset = req.query.offset === undefined ? 0 : toNumber(req.query.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    return sendError(res, 400, 'offset must be a whole number of 0 or more');
  }


  const minPrice = toNumber(req.query.min_price);
  const maxPrice = toNumber(req.query.max_price);
  if (req.query.min_price !== undefined && (minPrice === null || minPrice < 0)) {
    return sendError(res, 400, 'min_price must be a non-negative number');
  }
  if (req.query.max_price !== undefined && (maxPrice === null || maxPrice < 0)) {
    return sendError(res, 400, 'max_price must be a non-negative number');
  }
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    return sendError(res, 400, 'min_price cannot be greater than max_price');
  }


  const conditions = [];
  const params = [];

  if (String(search_q).trim() !== '') {
    conditions.push('title LIKE ?');
    params.push(`%${search_q}%`);
  }
  if (minPrice !== null && maxPrice !== null) {
    conditions.push('price BETWEEN ? AND ?');
    params.push(minPrice, maxPrice);
  } else if (minPrice !== null) {
    conditions.push('price >= ?');
    params.push(minPrice);
  } else if (maxPrice !== null) {
    conditions.push('price <= ?');
    params.push(maxPrice);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `SELECT * FROM book ${where} ORDER BY ${order_by} ${direction} LIMIT ? OFFSET ?;`;

  try {
    const books = await db.all(sql, [...params, limit, offset]);
    res.status(200).json(books);
  } catch (error) {
    sendError(res, 500, 'Internal Server Error');
  }
});


app.get('/books/:bookId/', async (req, res) => {
  const { bookId } = req.params;
  if (!isValidId(bookId)) {
    return sendError(res, 400, 'bookId must be a positive whole number');
  }
  try {
    const book = await db.get('SELECT * FROM book WHERE id = ?;', [bookId]);
    if (!book) {
      return sendError(res, 404, 'Book Not Found');
    }
    res.status(200).json(book);
  } catch (error) {
    sendError(res, 500, 'Internal Server Error');
  }
});


app.post('/books/', async (req, res) => {
  const problem = validateBook(req.body);
  if (problem) {
    return sendError(res, 400, problem);
  }
  const { title, author, price, pages = null } = req.body;
  try {
    const result = await db.run(
      'INSERT INTO book (title, author, price, pages) VALUES (?, ?, ?, ?);',
      [title.trim(), author.trim(), price, pages]
    );
    res.status(201).json({ message: 'Book Added Successfully', bookId: result.lastID });
  } catch (error) {
    sendError(res, 500, 'Internal Server Error');
  }
});


app.put('/books/:bookId/', async (req, res) => {
  const { bookId } = req.params;
  if (!isValidId(bookId)) {
    return sendError(res, 400, 'bookId must be a positive whole number');
  }
  const problem = validateBook(req.body);
  if (problem) {
    return sendError(res, 400, problem);
  }
  const { title, author, price, pages = null } = req.body;
  try {
    const result = await db.run(
      'UPDATE book SET title = ?, author = ?, price = ?, pages = ? WHERE id = ?;',
      [title.trim(), author.trim(), price, pages, bookId]
    );
    if (result.changes === 0) {
      return sendError(res, 404, 'Book Not Found');
    }
    res.status(200).json({ message: 'Book Updated Successfully' });
  } catch (error) {
    sendError(res, 500, 'Internal Server Error');
  }
});


app.delete('/books/:bookId/', async (req, res) => {
  const { bookId } = req.params;
  if (!isValidId(bookId)) {
    return sendError(res, 400, 'bookId must be a positive whole number');
  }
  try {
    const result = await db.run('DELETE FROM book WHERE id = ?;', [bookId]);
    if (result.changes === 0) {
      return sendError(res, 404, 'Book Not Found');
    }
    res.status(200).json({ message: 'Book Deleted Successfully' });
  } catch (error) {
    sendError(res, 500, 'Internal Server Error');
  }
});


app.use((req, res) => {
  sendError(res, 404, 'Route Not Found');
});


app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'Invalid JSON body');
  }
  sendError(res, 500, 'Internal Server Error');
});
