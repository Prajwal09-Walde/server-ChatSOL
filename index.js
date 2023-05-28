import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import env from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';

const app = express()

env.config();

console.log(process.env);

app.use(cors())
app.use(bodyParser.json())

const configuration = new Configuration({
    organization: "org-hme4yzNP0BLm1eBbClWQLUiC",
    
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