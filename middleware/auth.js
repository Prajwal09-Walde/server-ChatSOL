import jwt from 'jsonwebtoken';

/**
 * verifyToken – extracts the Bearer token from Authorization header,
 * verifies it using the JWT_SECRET, and attaches the decoded payload
 * to req.user so downstream handlers can read id, email, name, role, etc.
 */
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Access Denied: No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // ✅ JWT verification success log (visible in server console)
    console.log(`✅ JWT verified for user: ${decoded.email} | role: ${decoded.role}`);

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired. Please log in again.' });
    }
    return res.status(400).json({ message: 'Invalid Token.' });
  }
};

/**
 * verifyAdmin – first verifies the token, then checks admin role.
 */
export const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ message: 'Access Denied. Admins only.' });
    }
  });
};
