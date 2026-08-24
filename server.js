import OpenAI from "openai";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.post("/chat", async (req, res) => {
    try {
        const userMessage = req.body.message;

        const response = await client.responses.create({
    model: "gpt-5.6-luna",
    input: userMessage
});
        res.json({
            reply: response.output_text
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Something went wrong."
        });
    }
});

app.listen(3000, () => {
    console.log("My AI server is running on http://localhost:3000");
});