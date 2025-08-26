import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";
import schedule from "node-schedule";
import twilio from "twilio";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// ===== Load ENV =====
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// Twilio client
const client = twilio(TWILIO_SID, TWILIO_AUTH);

// ===== Database (simple JSON) =====
const dbPath = "./data/db.json";
function loadDB() {
  return JSON.parse(fs.readFileSync(dbPath));
}
function saveDB(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

// ===== Kirim pesan WA =====
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${PAGE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("SendMessage Error:", err.response?.data || err.message);
  }
}

// ===== Webhook Verifikasi =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ===== Webhook Pesan Masuk =====
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object) {
    const msg =
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (msg) {
      const from = msg.from; // nomor pengirim
      const text = msg.text?.body?.toLowerCase() || "";

      console.log("Pesan masuk:", text);

      if (text.startsWith("catat pemasukan")) {
        const jumlah = parseInt(text.split(" ")[2]);
        const db = loadDB();
        db.pemasukan.push({ jumlah, tanggal: new Date() });
        saveDB(db);
        sendMessage(from, `✅ Pemasukan ${jumlah} dicatat.`);
      } else if (text.startsWith("catat pengeluaran")) {
        const jumlah = parseInt(text.split(" ")[2]);
        const db = loadDB();
        db.pengeluaran.push({ jumlah, tanggal: new Date() });
        saveDB(db);
        sendMessage(from, `✅ Pengeluaran ${jumlah} dicatat.`);
      } else if (text === "laporan") {
        const db = loadDB();
        const totalMasuk = db.pemasukan.reduce((a, b) => a + b.jumlah, 0);
        const totalKeluar = db.pengeluaran.reduce((a, b) => a + b.jumlah, 0);
        sendMessage(
          from,
          `📊 Laporan Keuangan:\nPemasukan: ${totalMasuk}\nPengeluaran: ${totalKeluar}\nSaldo: ${
            totalMasuk - totalKeluar
          }`
        );
      } else if (text.startsWith("ingatkan")) {
        // Format: ingatkan 17:30 ada meeting
        const parts = text.split(" ");
        const waktu = parts[1];
        const pesan = parts.slice(2).join(" ");

        const [jam, menit] = waktu.split(":").map((n) => parseInt(n));
        const date = new Date();
        date.setHours(jam, menit, 0);

        schedule.scheduleJob(date, () => {
          sendMessage(from, `⏰ Pengingat: ${pesan}`);
          // Auto telpon via Twilio
          client.calls
            .create({
              url: "http://demo.twilio.com/docs/voice.xml",
              to: `+${from}`,
              from: TWILIO_PHONE,
            })
            .then(() => console.log("Telpon terkirim!"))
            .catch(console.error);
        });

        sendMessage(from, `✅ Pengingat diset jam ${waktu} untuk: ${pesan}`);
      } else {
        sendMessage(
          from,
          "👋 Hai! Perintah yang bisa dipakai:\n\n" +
            "- catat pemasukan <jumlah>\n" +
            "- catat pengeluaran <jumlah>\n" +
            "- laporan\n" +
            "- ingatkan <HH:MM> <pesan>"
        );
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// ===== Run Server =====
app.listen(PORT, () => console.log(`Bot jalan di port ${PORT}`));
