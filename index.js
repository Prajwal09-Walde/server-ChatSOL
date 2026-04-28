import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import authRoutes from './routes/auth.js';
import { verifyToken } from './middleware/auth.js';
import Activity from './models/Activity.js';

dotenv.config();

const app = express();

const allowedOrigins = [
  'https://client-chat-sol-bi7a-lkxp46ubl-prajwal09waldes-projects.vercel.app',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(bodyParser.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/chatsol")
.then(() => console.log("Connected to MongoDB Atlas"))
.catch((err) => console.log("MongoDB connection error:", err));

// Configure Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Routes
app.use('/api/auth', authRoutes);

// dummy test
app.get("/", (req, res) => {
    res.send("Hello World! ChatSOL server is running.")
});

// Protected chat route
app.post("/", verifyToken, async (req, res) => {
    const { message } = req.body;

    try {
        // Log chat activity
        await Activity.create({ userId: req.user.id, action: 'AI Chat Request', details: 'User interacted with AI' });

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: message,
            config: {
                systemInstruction: `You are a helpful AI assistant. The current date is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
                tools: [{ googleSearch: {} }],
                maxOutputTokens: 2000,
                temperature: 0.5
            }
        });
        
        res.json({ message: response.text });

    } catch(e) {
        console.error("Gemini Error:", e);
        res.status(500).json({ error: e.message || "Failed to generate response" });
    }
});

// listening
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3080;
  app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
}

export default app;