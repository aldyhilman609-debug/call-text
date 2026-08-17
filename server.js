const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
require("dotenv").config();

const PORT = process.env.PORT || 3000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

if (!DEEPGRAM_API_KEY) {
    throw new Error(
        "DEEPGRAM_API_KEY belum diisi."
    );
}

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "CallText STT Server",
        status: "running"
    });
});

const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    path: "/stt"
});

wss.on("connection", (client) => {

    console.log("=================================");
    console.log("Android terhubung ke STT");
    console.log("=================================");

    let keepAliveTimer = null;

    let clientClosed = false;

    let deepgramOpened = false;

    let audioPackets = 0;
    let audioBytes = 0;

    let lastAudioLog =
        Date.now();

    let lastWaitingLog =
        Date.now();

    // =====================================================
    // DEEPGRAM URL
    // =====================================================

    const deepgramUrl =
        "wss://api.deepgram.com/v1/listen" +
        "?model=nova-2" +
        "&language=id" +
        "&encoding=linear16" +
        "&sample_rate=48000" +
        "&channels=1" +
        "&smart_format=true" +
        "&interim_results=true" +
        "&endpointing=500" +
        "&punctuate=true";

    // =====================================================
    // CONNECT DEEPGRAM
    // =====================================================

    console.log(
        "Menghubungkan ke Deepgram..."
    );

    const deepgram =
        new WebSocket(
            deepgramUrl,
            {
                headers: {
                    Authorization:
                        `Token ${DEEPGRAM_API_KEY}`
                }
            }
        );

    // =====================================================
    // DEEPGRAM OPEN
    // =====================================================

    deepgram.on("open", () => {

        deepgramOpened =
            true;

        console.log(
            "✅ Terhubung ke Deepgram"
        );

        if (
            client.readyState ===
            WebSocket.OPEN
        ) {

            client.send(
                JSON.stringify({
                    type: "ready"
                })
            );
        }

        // ================================================
        // KEEP ALIVE
        // ================================================

        keepAliveTimer =
            setInterval(() => {

                if (
                    deepgram.readyState ===
                    WebSocket.OPEN
                ) {

                    try {

                        deepgram.send(
                            JSON.stringify({
                                type: "KeepAlive"
                            })
                        );

                    } catch (error) {

                        console.error(
                            "KeepAlive error:",
                            error.message
                        );
                    }
                }

            }, 5000);
    });

    // =====================================================
    // DEEPGRAM MESSAGE
    // =====================================================

    deepgram.on(
        "message",
        (data) => {

            const raw =
                data.toString();

            console.log(
                "Response Deepgram:",
                raw
            );

            try {

                const message =
                    JSON.parse(raw);

                // =========================================
                // ERROR
                // =========================================

                if (
                    message.type ===
                    "Error"
                ) {

                    console.error(
                        "❌ Deepgram Error:",
                        raw
                    );

                    if (
                        client.readyState ===
                        WebSocket.OPEN
                    ) {

                        client.send(
                            JSON.stringify({
                                type: "error",
                                message:
                                    message.message ||
                                    "Deepgram error"
                            })
                        );
                    }

                    return;
                }

                // =========================================
                // RESULTS
                // =========================================

                if (
                    message.type ===
                    "Results"
                ) {

                    const transcript =
                        message
                            .channel
                            ?.alternatives?.[0]
                            ?.transcript || "";

                    const isFinal =
                        message.is_final === true;

                    const speechFinal =
                        message.speech_final === true;

                    if (
                        transcript.trim() !== ""
                    ) {

                        console.log(
                            "📝 Transcript:",
                            transcript
                        );

                        console.log(
                            "Final:",
                            isFinal,
                            "SpeechFinal:",
                            speechFinal
                        );

                        if (
                            client.readyState ===
                            WebSocket.OPEN
                        ) {

                            client.send(
                                JSON.stringify({

                                    type:
                                        "transcript",

                                    text:
                                        transcript,

                                    isFinal:
                                        isFinal,

                                    speechFinal:
                                        speechFinal
                                })
                            );

                            console.log(
                                "➡️ Transcript dikirim ke Android"
                            );
                        }
                    }
                }

            } catch (error) {

                console.error(
                    "❌ JSON Deepgram error:",
                    error.message
                );
            }
        }
    );

    // =====================================================
    // DEEPGRAM ERROR
    // =====================================================

    deepgram.on(
        "error",
        (error) => {

            deepgramOpened =
                false;

            console.error(
                "❌ DEEPGRAM ERROR:",
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
        }
    );

    // =====================================================
    // DEEPGRAM HANDSHAKE ERROR
    // =====================================================

    deepgram.on(
        "unexpected-response",
        (
            request,
            response
        ) => {

            deepgramOpened =
                false;

            console.error(
                "❌ DEEPGRAM HANDSHAKE ERROR:",
                response.statusCode
            );

            console.error(
                "Deepgram Headers:",
                response.headers
            );

            let responseBody =
                "";

            response.on(
                "data",
                (chunk) => {

                    responseBody +=
                        chunk.toString();
                }
            );

            response.on(
                "end",
                () => {

                    console.error(
                        "Deepgram Response:",
                        responseBody
                    );

                    if (
                        client.readyState ===
                        WebSocket.OPEN
                    ) {

                        client.send(
                            JSON.stringify({
                                type: "error",
                                message:
                                    `Deepgram HTTP ${response.statusCode}: ${responseBody}`
                            })
                        );
                    }
                }
            );
        }
    );

    // =====================================================
    // DEEPGRAM CLOSE
    // =====================================================

    deepgram.on(
        "close",
        (
            code,
            reason
        ) => {

            deepgramOpened =
                false;

            if (
                keepAliveTimer
            ) {

                clearInterval(
                    keepAliveTimer
                );

                keepAliveTimer =
                    null;
            }

            console.log(
                "🔴 Deepgram ditutup"
            );

            console.log(
                "Code:",
                code
            );

            console.log(
                "Reason:",
                reason.toString()
            );

            if (
                !clientClosed &&
                client.readyState ===
                WebSocket.OPEN
            ) {

                client.send(
                    JSON.stringify({
                        type: "error",
                        message:
                            `Deepgram closed (${code})`
                    })
                );
            }
        }
    );

    // =====================================================
    // ANDROID MESSAGE
    // =====================================================

    client.on(
        "message",
        (
            data,
            isBinary
        ) => {

            if (
                clientClosed
            ) {
                return;
            }

            // =================================================
            // TEXT MESSAGE
            // =================================================

            if (!isBinary) {

                const text =
                    data.toString();

                console.log(
                    "Pesan Android:",
                    text
                );

                try {

                    const message =
                        JSON.parse(text);

                    // -----------------------------------------
                    // FINISH
                    // -----------------------------------------

                    if (
                        message.type ===
                        "finish"
                    ) {

                        console.log(
                            "🛑 Finish dari Android"
                        );

                        if (
                            deepgram.readyState ===
                            WebSocket.OPEN
                        ) {

                            deepgram.close(
                                1000,
                                "Android finished"
                            );
                        }

                        return;
                    }

                    // -----------------------------------------
                    // KEEP ALIVE
                    // -----------------------------------------

                    if (
                        message.type ===
                        "KeepAlive"
                    ) {

                        if (
                            deepgram.readyState ===
                            WebSocket.OPEN
                        ) {

                            deepgram.send(
                                JSON.stringify({
                                    type:
                                        "KeepAlive"
                                })
                            );
                        }

                        return;
                    }

                } catch (error) {

                    console.log(
                        "Pesan Android bukan JSON"
                    );
                }

                return;
            }

            // =================================================
            // BINARY AUDIO
            // =================================================

            audioPackets++;
            audioBytes +=
                data.length;

            // -----------------------------------------------
            // DEEPGRAM BELUM OPEN
            // -----------------------------------------------

            if (
                deepgram.readyState !==
                WebSocket.OPEN
            ) {

                const now =
                    Date.now();

                /*
                 * Jangan spam log.
                 * Cukup satu kali tiap 5 detik.
                 */
                if (
                    now -
                        lastWaitingLog >=
                    5000
                ) {

                    console.warn(
                        "⚠️ Deepgram belum OPEN, " +
                        "audio belum dikirim."
                    );

                    lastWaitingLog =
                        now;
                }

                return;
            }

            // -----------------------------------------------
            // KIRIM AUDIO
            // -----------------------------------------------

            try {

                deepgram.send(
                    data
                );

                const now =
                    Date.now();

                /*
                 * Statistik hanya dicetak tiap 5 detik.
                 */
                if (
                    now -
                        lastAudioLog >=
                    5000
                ) {

                    console.log(
                        `🎙️ Audio OK: ` +
                        `${audioPackets} paket, ` +
                        `${audioBytes} bytes`
                    );

                    audioPackets =
                        0;

                    audioBytes =
                        0;

                    lastAudioLog =
                        now;
                }

            } catch (error) {

                console.error(
                    "❌ Gagal kirim audio:",
                    error.message
                );
            }
        }
    );

    // =====================================================
    // ANDROID CLOSE
    // =====================================================

    client.on(
        "close",
        (
            code,
            reason
        ) => {

            clientClosed =
                true;

            console.log(
                "🔴 Android terputus"
            );

            console.log(
                "Code:",
                code
            );

            console.log(
                "Reason:",
                reason.toString()
            );

            if (
                keepAliveTimer
            ) {

                clearInterval(
                    keepAliveTimer
                );

                keepAliveTimer =
                    null;
            }

            if (
                deepgram.readyState ===
                WebSocket.OPEN
            ) {

                try {

                    deepgram.close(
                        1000,
                        "Android disconnected"
                    );

                } catch (error) {

                    console.error(
                        "Close Deepgram error:",
                        error.message
                    );
                }
            }
        }
    );

    // =====================================================
    // ANDROID ERROR
    // =====================================================

    client.on(
        "error",
        (error) => {

            console.error(
                "❌ Android WebSocket error:",
                error.message
            );
        }
    );
});

// =========================================================
// SERVER START
// =========================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================="
        );

        console.log(
            `🚀 CallText STT server berjalan di port ${PORT}`
        );

        console.log(
            "================================="
        );
    }
);
