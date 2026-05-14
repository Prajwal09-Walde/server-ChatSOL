import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import User from '../models/User.js';
import Activity from '../models/Activity.js';
import { verifyAdmin, verifyToken } from '../middleware/auth.js';

const router = express.Router();

// ──────────────────────────────────────────────────────────
// Helper: build JWT payload with all login-relevant fields
// ──────────────────────────────────────────────────────────
const buildPayload = (user) => ({
  id:    user._id,
  name:  user.name,
  email: user.email,
  role:  user.role,
  iss:   'chatsol-server',   // issuer
  aud:   'chatsol-client',   // audience
});

const signToken = (user) =>
  jwt.sign(buildPayload(user), process.env.JWT_SECRET, { expiresIn: '1h' });

// ──────────────────────────────────────────────────────────
// POST /signup
// ──────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));
    user = await new User({ name, email, password: hashedPassword }).save();

    await Activity.create({ userId: user._id, action: 'User Signup', details: `${email} signed up` });

    const token = signToken(user);
    console.log('🔑 JWT issued on signup for:', email);

    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// POST /login
// ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    await Activity.create({ userId: user._id, action: 'User Login', details: `${email} logged in` });

    const token = signToken(user);
    console.log('🔑 JWT issued on login for:', email);

    // Decode immediately and log the full payload for transparency
    const decoded = jwt.decode(token);
    console.log('📦 JWT Payload:', JSON.stringify(decoded, null, 2));

    res.status(200).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// GET /verify-token  ← Test route: confirms JWT is working
// Protected by verifyToken middleware.
// Returns the full decoded payload + human-readable timestamps.
// ──────────────────────────────────────────────────────────
router.get('/verify-token', verifyToken, (req, res) => {
  const { iat, exp, ...payloadFields } = req.user;
  res.status(200).json({
    status:    '✅ JWT is valid and working',
    payload:   payloadFields,
    issuedAt:  new Date(iat * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
    timeLeft:  `${Math.round((exp - Date.now() / 1000) / 60)} minutes remaining`,
  });
});

// ──────────────────────────────────────────────────────────
// POST /forgot-password
// ──────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const resetToken = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || 'https://client-chat-sol-bi7a-lkxp46ubl-prajwal09waldes-projects.vercel.app';
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.ethereal.email',
      port: process.env.SMTP_PORT || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    try {
      const info = await transporter.sendMail({
        from: '"ChatSOL Support" <noreply@chatsol.com>',
        to: user.email,
        subject: 'Password Reset Request',
        text: `You requested a password reset. Reset link:\n\n${resetUrl}`,
      });
      console.log('📧 Reset email sent:', info.messageId);
      console.log('🔗 Preview URL:', nodemailer.getTestMessageUrl(info));
      res.status(200).json({ message: 'Email sent' });
    } catch (emailErr) {
      console.error(emailErr);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      return res.status(500).json({ message: 'Email could not be sent' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// POST /reset-password/:token
// ──────────────────────────────────────────────────────────
router.post('/reset-password/:token', async (req, res) => {
  try {
    const resetPasswordToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

    user.password = await bcrypt.hash(req.body.password, await bcrypt.genSalt(10));
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// PUT /update-settings  (JWT protected)
// ──────────────────────────────────────────────────────────
router.put('/update-settings', verifyToken, async (req, res) => {
  try {
    const { name, password } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name) user.name = name;
    if (password) user.password = await bcrypt.hash(password, await bcrypt.genSalt(10));

    await user.save();

    res.status(200).json({
      message: 'Settings updated successfully',
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// GET /activities  (Admin only — JWT + role check)
// ──────────────────────────────────────────────────────────
router.get('/activities', verifyAdmin, async (req, res) => {
  try {
    const activities = await Activity.find()
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 });
    res.status(200).json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
