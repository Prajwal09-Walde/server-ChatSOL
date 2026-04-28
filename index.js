import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import env from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';

const app = express()

env.config();

console.log(process.env);

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
app.use(bodyParser.json())

const configuration = new Configuration({
    organization: "org-hme4yzNP0BLm1eBbClWQLUiC",
    apiKey: process.env.API_KEY
})
// Configure OpenAIapi
const openai = new OpenAIApi(configuration);

// listening
app.listen("3080", ()=>console.log("listening on port 3080"))

// dummy test
app.get("/", (req, res) => {
    res.send("Hello World!")
})

//post route
app.post("/", async (req, res) => {
    const {message} = req.body

    try {
        const response = await openai.createCompletion({
            model: "text-davinci-003",
            prompt: `${message}`,
            max_tokens: 2000,
            temperature: .5
        })
        res.json({message: response.data.choices[0].text})

    } catch(e) {
        console.log(e)
        res.send(e).status(400)
    }
})