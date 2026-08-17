const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();

const PORT = process.env.PORT || 3000;

const DEEPGRAM_API_KEY =
    process.env.DEEPGRAM_API_KEY;

// =========================================================
// BASIC VALIDATION
// =========================================================

if (!DEEPGRAM_API_KEY) {
    throw new Error(
        "DEEPGRAM_API_KEY belum diisi."
    );
}

if (
    !process.env.FIREBASE_SERVICE_ACCOUNT_JSON
) {
    throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON belum diisi."
    );
}

// =========================================================
// FIREBASE ADMIN
// =========================================================

let firebaseServiceAccount;

try {

    firebaseServiceAccount =
        JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        );

} catch (error) {

    throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON bukan JSON yang valid."
    );
}

if (!admin.apps.length) {

    admin.initializeApp({
        credential:
            admin.credential.cert(
                firebaseServiceAccount
            )
    });
}

const firestore =
    admin.firestore();

const messaging =
    admin.messaging();

// =========================================================
// EXPRESS
// =========================================================

const app =
    express();

app.use(
    cors()
);

app.use(
    express.json({
        limit: "1mb"
    })
);

// =========================================================
// HEALTH CHECK
// =========================================================

app.get(
    "/",
    (req, res) => {

        res.json({
            ok: true,
            service:
                "CallText STT + FCM Server",
            status:
                "running"
        });
    }
);

// =========================================================
// SEND INCOMING CALL
// =========================================================

app.post(
    "/send-call",
    async (req, res) => {

        try {

            const {
                targetUid,
                callId,
                callerUid,
                callerName,
                callerId
            } = req.body;

            // ---------------------------------------------
            // VALIDATION
            // ---------------------------------------------

            if (
                !targetUid ||
                !callId ||
                !callerUid
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "targetUid, callId, dan callerUid wajib diisi."
                });
            }

            // ---------------------------------------------
            // JANGAN KIRIM KE DIRI SENDIRI
            // ---------------------------------------------

            if (
                targetUid === callerUid
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Tidak bisa mengirim panggilan ke diri sendiri."
                });
            }

            // ---------------------------------------------
            // CARI USER TUJUAN
            // users/{targetUid}
            // ---------------------------------------------

            const userDoc =
                await firestore
                    .collection("users")
                    .doc(targetUid)
                    .get();

            if (
                !userDoc.exists
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "User tujuan tidak ditemukan."
                });
            }

            const userData =
                userDoc.data() || {};

            const fcmToken =
                userData.fcmToken;

            if (
                !fcmToken ||
                typeof fcmToken !== "string"
            ) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "FCM token user tujuan belum tersedia."
                });
            }

            // ---------------------------------------------
            // DATA FCM
            // ---------------------------------------------

            const message = {

                token: fcmToken,

                data: {

                    type:
                        "incoming_call",

                    callId:
                        String(callId),

                    callerUid:
                        String(callerUid),

                    callerName:
                        String(
                            callerName ||
                            "Panggilan masuk"
                        ),

                    callerId:
                        String(
                            callerId ||
                            ""
                        )
                },

                /*
                 * PRIORITAS HIGH untuk incoming call.
                 */
                android: {

                    priority:
                        "high",

                    ttl:
                        30 * 1000
                }
            };

            // ---------------------------------------------
            // SEND
            // ---------------------------------------------

            const response =
                await messaging.send(
                    message
                );

            console.log(
                "📞 FCM CALL SENT:",
                {
                    targetUid,
                    callId,
                    messageId: response
                }
            );

            return res.json({

                ok:
                    true,

                sent:
                    true,

                messageId:
                    response
            });

        } catch (error) {

            console.error(
                "❌ SEND CALL ERROR:",
                error
            );

            /*
             * Token sudah tidak valid.
             *
             * Dalam kondisi tertentu FCM mengembalikan
             * error seperti registration-token-not-registered.
             *
             * Kita belum menghapus token otomatis supaya
             * tidak salah menghapus data.
             */
            return res.status(500).json({

                ok:
                    false,

                sent:
                    false,

                error:
                    error.message
            });
        }
    }
);

// =========================================================
// HTTP SERVER
// =========================================================

const server =
    http.createServer(
        app
    );

// =========================================================
// WEB SOCKET SERVER
// =========================================================

const wss =
    new WebSocket.Server({
        server,
        path: "/stt"
    });

// =========================================================
// STT CONNECTION
// =========================================================

wss.on(
    "connection",
    (client) => {

        console.log(
            "================================="
        );

        console.log(
            "Android terhubung ke STT"
        );

        console.log(
            "================================="
        );

        let keepAliveTimer =
            null;

        let clientClosed =
            false;

        let audioPackets =
            0;

        let audioBytes =
            0;

        let lastAudioLog =
            Date.now();

        let lastWaitingLog =
            Date.now();

        // =================================================
        // DEEPGRAM URL
        // =================================================

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

        // =================================================
        // CONNECT DEEPGRAM
        // =================================================

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

        // =================================================
        // DEEPGRAM OPEN
        // =================================================

        deepgram.on(
            "open",
            () => {

                console.log(
                    "✅ Terhubung ke Deepgram"
                );

                if (
                    client.readyState ===
                    WebSocket.OPEN
                ) {

                    client.send(
                        JSON.stringify({
                            type:
                                "ready"
                        })
                    );
                }

                // -----------------------------------------
                // KEEP ALIVE
                // -----------------------------------------

                keepAliveTimer =
                    setInterval(
                        () => {

                            if (
                                deepgram.readyState ===
                                WebSocket.OPEN
                            ) {

                                try {

                                    deepgram.send(
                                        JSON.stringify({
                                            type:
                                                "KeepAlive"
                                        })
                                    );

                                } catch (
                                    error
                                ) {

                                    console.error(
                                        "KeepAlive error:",
                                        error.message
                                    );
                                }
                            }

                        },
                        5000
                    );
            }
        );

        // =================================================
        // DEEPGRAM MESSAGE
        // =================================================

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
                        JSON.parse(
                            raw
                        );

                    // -------------------------------------
                    // ERROR
                    // -------------------------------------

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

                                    type:
                                        "error",

                                    message:
                                        message.message ||
                                        "Deepgram error"
                                })
                            );
                        }

                        return;
                    }

                    // -------------------------------------
                    // RESULTS
                    // -------------------------------------

                    if (
                        message.type ===
                        "Results"
                    ) {

                        const transcript =
                            message
                                .channel
                                ?.alternatives?.[0]
                                ?.transcript ||
                            "";

                        const isFinal =
                            message.is_final === true;

                        const speechFinal =
                            message.speech_final === true;

                        if (
                            transcript.trim()
                        ) {

                            console.log(
                                "📝 Transcript:",
                                transcript
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

                } catch (
                    error
                ) {

                    console.error(
                        "❌ JSON Deepgram error:",
                        error.message
                    );
                }
            }
        );

        // =================================================
        // DEEPGRAM ERROR
        // =================================================

        deepgram.on(
            "error",
            (error) => {

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

                            type:
                                "error",

                            message:
                                error.message
                        })
                    );
                }
            }
        );

        // =================================================
        // DEEPGRAM HANDSHAKE
        // =================================================

        deepgram.on(
            "unexpected-response",
            (
                request,
                response
            ) => {

                console.error(
                    "❌ DEEPGRAM HANDSHAKE ERROR:",
                    response.statusCode
                );

                let body =
                    "";

                response.on(
                    "data",
                    (chunk) => {

                        body +=
                            chunk.toString();
                    }
                );

                response.on(
                    "end",
                    () => {

                        console.error(
                            "Deepgram Response:",
                            body
                        );
                    }
                );
            }
        );

        // =================================================
        // DEEPGRAM CLOSE
        // =================================================

        deepgram.on(
            "close",
            (
                code,
                reason
            ) => {

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
            }
        );

        // =================================================
        // ANDROID MESSAGE
        // =================================================

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

                // -----------------------------------------
                // TEXT MESSAGE
                // -----------------------------------------

                if (
                    !isBinary
                ) {

                    const text =
                        data.toString();

                    try {

                        const message =
                            JSON.parse(
                                text
                            );

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

                    } catch (
                        error
                    ) {

                        console.log(
                            "Pesan Android bukan JSON."
                        );
                    }

                    return;
                }

                // -----------------------------------------
                // BINARY PCM AUDIO
                // -----------------------------------------

                audioPackets++;
                audioBytes +=
                    data.length;

                if (
                    deepgram.readyState !==
                    WebSocket.OPEN
                ) {

                    const now =
                        Date.now();

                    /*
                     * Tidak spam log.
                     */
                    if (
                        now -
                            lastWaitingLog >=
                        5000
                    ) {

                        console.warn(
                            "⚠️ Deepgram belum OPEN, audio belum dikirim."
                        );

                        lastWaitingLog =
                            now;
                    }

                    return;
                }

                try {

                    deepgram.send(
                        data
                    );

                    const now =
                        Date.now();

                    if (
                        now -
                            lastAudioLog >=
                        5000
                    ) {

                        console.log(
                            `🎙️ Audio OK: ${audioPackets} paket, ${audioBytes} bytes`
                        );

                        audioPackets =
                            0;

                        audioBytes =
                            0;

                        lastAudioLog =
                            now;
                    }

                } catch (
                    error
                ) {

                    console.error(
                        "❌ Gagal kirim audio:",
                        error.message
                    );
                }
            }
        );

        // =================================================
        // ANDROID CLOSE
        // =================================================

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

                    } catch (
                        error
                    ) {

                        console.error(
                            "Deepgram close error:",
                            error.message
                        );
                    }
                }
            }
        );

        // =================================================
        // ANDROID ERROR
        // =================================================

        client.on(
            "error",
            (error) => {

                console.error(
                    "❌ Android WebSocket error:",
                    error.message
                );
            }
        );
    }
);

// =========================================================
// START SERVER
// =========================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================="
        );

        console.log(
            `🚀 CallText server berjalan di port ${PORT}`
        );

        console.log(
            "STT: /stt"
        );

        console.log(
            "FCM: /send-call"
        );

        console.log(
            "================================="
        );
    }
);
