const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
require("dotenv").config();

const PORT = process.env.PORT || 3000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

if (!DEEPGRAM_API_KEY) {
    throw new Error(
        "DEEPGRAM_API_KEY belum diisi di file .env"
    );
}

const app = express();

app.use(cors());

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "CallText STT Server"
    });
});

const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    path: "/stt"
});

wss.on("connection", (client) => {

    console.log("Android terhubung ke STT");

    const deepgramUrl =
        "wss://api.deepgram.com/v1/listen" +
        "?model=nova-2" +
        "&language=id" +
        "&encoding=linear16" +
        "&sample_rate=48000" +
        "&channels=1" +
        "&smart_format=true" +
        "&interim_results=true" +
        "&endpointing=500";

    const deepgram =
        new WebSocket(deepgramUrl, {
            headers: {
                Authorization:
                    `Token ${DEEPGRAM_API_KEY}`
            }
        });

    deepgram.on("open", () => {

        console.log(
            "✅ Terhubung ke Deepgram"
        );

        if (
            client.readyState === WebSocket.OPEN
        ) {
            client.send(
                JSON.stringify({
                    type: "ready"
                })
            );
        }
    });

    deepgram.on("message", (data) => {

console.log(
    "Response Deepgram:",
    data.toString()
);
        try {

            const message =
                JSON.parse(
                    data.toString()
                );

            if (
                message.type === "Results"
            ) {

                const transcript =
                    message.channel
                        ?.alternatives?.[0]
                        ?.transcript || "";

                if (
                    transcript.trim() !== "" &&
                    client.readyState ===
                        WebSocket.OPEN
                ) {

                    client.send(
                        JSON.stringify({
                            type: "transcript",
                            text: transcript,
                            isFinal:
                                message.is_final === true,
                            speechFinal:
                                message.speech_final === true
                        })
                    );
                }
            }

        } catch (error) {

            console.error(
                "Error membaca Deepgram:",
                error.message
            );
        }
    });

    deepgram.on("error", (error) => {

        console.error(
            "❌ Deepgram error:",
            error.message
        );

        if (
            client.readyState ===
            WebSocket.OPEN
        ) {

            client.send(
                JSON.stringify({
                    type: "error",
                    message:
                        error.message
                })
            );
        }
    });

    deepgram.on("close", () => {

        console.log(
            "Koneksi Deepgram ditutup"
        );

        if (
            client.readyState ===
            WebSocket.OPEN
        ) {
            client.close();
        }
    });

client.on("message", (data, isBinary) => {

    if (!isBinary) {
        console.log("Pesan non-binary dari Android:", data.toString());
        return;
    }

    console.log(
        `Audio masuk dari Android: ${data.length} bytes`
    );

    if (
        deepgram.readyState === WebSocket.OPEN
    ) {

        deepgram.send(data);

    } else {

        console.log(
            "Deepgram belum OPEN, audio tidak dikirim."
        );
    }
});

    client.on("close", () => {

        console.log(
            "Android terputus dari STT"
        );

        if (
            deepgram.readyState ===
            WebSocket.OPEN
        ) {

            deepgram.close();
        }
    });
});

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 CallText STT server berjalan di port ${PORT}`
        );
    }
);