function errorHandler(err, req, res, next) {
  console.error('Backend Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    path: req.originalUrl,
    method: req.method,
    time: new Date().toISOString(),
  });

  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    success: false,
    message:
      process.env.NODE_ENV === 'production'
        ? statusCode === 500
          ? 'Something went wrong. Please try again later.'
          : err.message
        : err.message || 'Server error',
  });
}

module.exports = errorHandler;