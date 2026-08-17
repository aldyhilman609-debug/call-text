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
    let deepgramClosed = false;

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

    const deepgram =
        new WebSocket(deepgramUrl, {
            headers: {
                Authorization:
                    `Token ${DEEPGRAM_API_KEY}`
            }
        });

    // =====================================================
    // DEEPGRAM CONNECTED
    // =====================================================

    deepgram.on("open", () => {

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

        /*
         * KeepAlive dikirim sebagai TEXT frame.
         * Berguna menjaga stream tetap aktif saat
         * tidak ada audio sesaat.
         */
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

                        console.log(
                            "🔄 Deepgram KeepAlive"
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

    deepgram.on("message", (data) => {

        const raw =
            data.toString();

        console.log(
            "Response Deepgram:",
            raw
        );

        try {

            const message =
                JSON.parse(raw);

            // ---------------------------------------------
            // DEEPGRAM ERROR
            // ---------------------------------------------

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

            // ---------------------------------------------
            // TRANSCRIPT
            // ---------------------------------------------

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
                        "   is_final:",
                        isFinal
                    );

                    console.log(
                        "   speech_final:",
                        speechFinal
                    );

                    if (
                        client.readyState ===
                        WebSocket.OPEN
                    ) {

                        const payload =
                            JSON.stringify({

                                type:
                                    "transcript",

                                text:
                                    transcript,

                                isFinal:
                                    isFinal,

                                speechFinal:
                                    speechFinal
                            });

                        client.send(
                            payload
                        );

                        console.log(
                            "➡️ Transcript dikirim ke Android"
                        );
                    }
                }
            }

        } catch (error) {

            console.error(
                "❌ Error parsing Deepgram:",
                error.message
            );
        }
    });

    // =====================================================
    // DEEPGRAM ERROR
    // =====================================================

    deepgram.on("error", (error) => {

        console.error(
            "❌ Deepgram WebSocket error:",
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

    // =====================================================
    // DEEPGRAM CLOSE
    // =====================================================

    deepgram.on("close", (
        code,
        reason
    ) => {

        deepgramClosed =
            true;

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
            "🔴 Koneksi Deepgram ditutup"
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
                        "Koneksi Deepgram ditutup"
                })
            );
        }
    });

    // =====================================================
    // ANDROID MESSAGE
    // =====================================================

    client.on(
        "message",
        (data, isBinary) => {

            if (clientClosed) {
                return;
            }

            /*
             * Android mengirim:
             * - binary = PCM audio
             * - text = command seperti finish
             */

            if (!isBinary) {

                const text =
                    data.toString();

                console.log(
                    "Pesan text dari Android:",
                    text
                );

                try {

                    const message =
                        JSON.parse(
                            text
                        );

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

                            /*
                             * Close normal agar Deepgram
                             * mengeluarkan final result terakhir.
                             */
                            deepgram.close(
                                1000,
                                "Android finished"
                            );
                        }

                        return;
                    }

                    // -----------------------------------------
                    // KEEP ALIVE REQUEST
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
                        "Pesan text bukan JSON."
                    );
                }

                return;
            }

            // =================================================
            // BINARY AUDIO
            // =================================================

            console.log(
                `🎙️ Audio masuk dari Android: ${data.length} bytes`
            );

            if (
                deepgram.readyState ===
                WebSocket.OPEN
            ) {

                try {

                    deepgram.send(
                        data
                    );

                    console.log(
                        "➡️ Audio diteruskan ke Deepgram"
                    );

                } catch (error) {

                    console.error(
                        "❌ Gagal kirim audio ke Deepgram:",
                        error.message
                    );
                }

            } else {

                console.warn(
                    "⚠️ Deepgram belum OPEN, audio tidak dikirim."
                );
            }
        }
    );

    // =====================================================
    // ANDROID CLOSE
    // =====================================================

    client.on("close", (
        code,
        reason
    ) => {

        clientClosed =
            true;

        console.log(
            "🔴 Android terputus dari STT"
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
                    "Error menutup Deepgram:",
                    error.message
                );
            }
        }
    });

    // =====================================================
    // ANDROID ERROR
    // =====================================================

    client.on("error", (error) => {

        console.error(
            "❌ Android WebSocket error:",
            error.message
        );
    });
});

// =========================================================
// SERVER
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
