import axios from "axios";
import { Redis } from "@upstash/redis";

// ========== KONFIGURASI REDIS ==========
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const WABLAS_BASE_URL = "https://tegal.wablas.com/api/v2";
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 menit

// ========== TEKS MENU UTAMA ==========
const MENU_LIST_TEXT =
  [
    "1. Tata Kelola & Manajemen Risiko",
    "2. Pengadaan Barang/Jasa",
    "3. Pengelolaan Keuangan & BMN",
    "4. Kinerja & Kepegawaian",
    "5. Chat dengan Tim Inspektorat",
  ].join("\n") + "\n\nBalas dengan *ANGKA* pilihan Anda (contoh: 1).";

// ========== REDIS HELPER ==========
export const getSession = async (phone) => {
  const key = `session:${phone}`;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;

    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        console.warn(
          `⚠️ Failed to parse session for ${phone}. Deleting corrupt key.`
        );
        await redis.del(key);
        return null;
      }
    }

    console.warn(`⚠️ Unexpected session format for ${phone}:`, raw);
    await redis.del(key);
    return null;
  } catch (err) {
    console.error("❌ Error getting session:", err);
    return null;
  }
};

export const setSession = async (phone, data) => {
  const key = `session:${phone}`;
  try {
    const jsonData = typeof data === "string" ? data : JSON.stringify(data);
    const expiry = Math.floor(SESSION_TIMEOUT / 1000);
    await redis.set(key, jsonData, { ex: expiry });
    console.log(`✅ Session set for ${phone} (expires in ${expiry}s):`, data);
  } catch (err) {
    console.error("❌ Failed to save session:", err);
  }
};

export const clearSession = async (phone) => {
  const key = `session:${phone}`;
  try {
    await redis.del(key);
    console.log(`🧹 Session cleared for ${phone}`);
  } catch (err) {
    console.error("❌ Failed to clear session:", err);
  }
};

// ========== HANDLER UTAMA ==========
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");

  // Endpoint tes
  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "WA Bot Webhook is running",
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const data = req.body;
    console.log("Received webhook:", JSON.stringify(data, null, 2));

    // Validasi payload
    if (!data?.phone) {
      console.error("Invalid payload - missing phone:", data);
      return res.status(200).send("OK");
    }

    // Extract info
    const from = data.phone;
    const rawMessage = data.message || "";
    const message = rawMessage.toLowerCase().trim();
    const messageType = data.messageType || "text";
    const isFromMe = data.isFromMe || false;
    const pushName = data.pushName || "";

    console.log("=== INCOMING MESSAGE ===");
    console.log({ from, rawMessage, isFromMe, messageType, pushName });

    // ========== FILTERING PESAN ==========
    if (["true", true, "1", 1].includes(isFromMe)) {
      console.log("✋ Ignoring message from bot itself");
      return res.status(200).send("OK");
    }

    if (from === process.env.WABLAS_PHONE_NUMBER) {
      console.log("✋ Ignoring message from bot's own number");
      return res.status(200).send("OK");
    }

    if (rawMessage.includes('"status"') || rawMessage.includes('{"status"')) {
      console.log("✋ Ignoring JSON status message");
      return res.status(200).send("OK");
    }

    if (rawMessage.length < 1 || messageType !== "text") {
      console.log(`✋ Ignoring invalid/non-text message (${messageType})`);
      return res.status(200).send("OK");
    }

    // Cek kredensial Wablas
    const apiKey = process.env.WABLAS_API_KEY;
    const secretKey = process.env.WABLAS_SECRET_KEY;
    const spreadsheetWebhook = process.env.SPREADSHEET_WEBHOOK;

    if (!apiKey || !secretKey) {
      console.error("Missing API credentials");
      return res.status(200).send("OK");
    }

    const authHeader = `${apiKey}.${secretKey}`;

    // ========== HELPER KIRIM PESAN ==========
    const sendMessage = async (text) => {
      try {
        // Tambahkan watermark di setiap pesan keluar
        const messageWithWatermark = `${text}\n\n—\n_Coded by Damantine_`;

        const payload = {
          data: [{ phone: from, message: messageWithWatermark }],
        };
        console.log(`📤 Sending message to ${from}...`);
        const response = await axios.post(
          `${WABLAS_BASE_URL}/send-message`,
          payload,
          {
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          }
        );
        console.log("✅ Message sent:", response.data);
      } catch (error) {
        console.error("❌ Error sending message:", error.message);
      }
    };

    // ========== FLOW LOGIC ==========

    // STEP 1: Menu utama (greeting)
    const greetings = [
      "hai",
      "halo",
      "hallo",
      "selamat pagi",
      "pagi",
      "selamat siang",
      "siang",
      "selamat sore",
      "sore",
      "selamat malam",
      "malam",
      "menu",
      "mulai",
      "start",
      "batal",
    ];

    if (greetings.includes(message)) {
      await clearSession(from);
      const welcomeText =
        "*Selamat datang di Layanan Klinik Konsultasi*\n" +
        "*Inspektorat Lembaga Kebijakan Pengadaan Barang/Jasa Pemerintah.*\n\n" +
        "Silakan pilih layanan konsultasi sesuai kebutuhan Anda:\n\n" +
        MENU_LIST_TEXT;

      await sendMessage(welcomeText);
      await new Promise((r) => setTimeout(r, 500));
      return res.status(200).send("OK");
    }

    // Ambil session
    let session = await getSession(from);
    console.log(`Current session for ${from}:`, session);

    // STEP 4: Pilih metode (Offline/Online)
    if (["1", "2"].includes(message) && session?.step === "choose_method") {
      await setSession(from, {
        ...session,
        step: "fill_form",
        metode: message === "1" ? "Offline" : "Online",
      });

      const formTitle =
        message === "1"
          ? "*Form Pendaftaran Konsultasi Offline*"
          : "*Form Pendaftaran Konsultasi Online*";

      await sendMessage(
        `${formTitle}\n\n` +
          "Dimohon kesediaannya untuk mengisi data diri berikut:\n\n" +
          "*Format pengisian:*\n" +
          "Nama: [Nama lengkap Anda]\n" +
          "Unit: [Unit organisasi]\n" +
          "Jabatan: [Jabatan Anda]\n" +
          "Referensi Hari/Jam: [Hari/Tanggal dan Jam]\n\n" +
          "*Contoh:*\n" +
          "Nama: Budi Santoso\n" +
          "Unit: Inspektorat\n" +
          "Jabatan: Auditor Ahli Pertama\n" +
          "Referensi Hari/Jam: Senin, 4 Nov 2025 - 10:00 WIB"
      );
      return res.status(200).send("OK");
    }

    // STEP 5: Isi form
    // STEP 5: Isi form
    if (session?.step === "fill_form") {
      try {
        // Bersihin dan siapin teks dari user
        const cleanText = rawMessage.replace(/\r/g, "").trim();

        // Gunakan regex biar lebih fleksibel (bisa handle spasi acak & format rapi)
        const regex =
          /Nama\s*:\s*(.+)\n\s*Unit\s*:\s*(.+)\n\s*Jabatan\s*:\s*(.+)\n\s*Referensi\s*Hari\/Jam\s*:\s*(.+)/i;
        const match = cleanText.match(regex);

        if (!match) {
          await sendMessage(
            "❌ *Pendaftaran Gagal!*\n\n" +
              "Terjadi kesalahan saat menyimpan data Anda. Silakan kirim ulang format isian Anda.\n\n" +
              "— Coded by Damantine"
          );
          return res.status(200).send("OK");
        }

        // Ambil hasil parsing dari regex
        const [, nama, unit, jabatan, waktu] = match.map((x) => x.trim());
        console.log("✅ Parsed form data:", { nama, unit, jabatan, waktu });

        // Kirim ke spreadsheet webhook
        if (spreadsheetWebhook) {
          try {
            const payload = {
              timestamp: new Date().toISOString(),
              nomor: from,
              nama,
              unit,
              jabatan,
              waktu,
              layanan: session.layanan,
              metode: session.metode,
            };

            await axios.post(spreadsheetWebhook, payload, { timeout: 10000 });
            console.log("✅ Data sent to spreadsheet");
          } catch (error) {
            console.error("❌ Error sending to spreadsheet:", error.message);
            await sendMessage(
              "❌ *Pendaftaran Gagal!*\n\n" +
                "Terjadi kesalahan saat menyimpan data Anda. Silakan kirim ulang format isian Anda.\n\n" +
                "— Coded by Damantine"
            );
            return res.status(200).send("OK");
          }
        }

        // Kirim balasan sukses
        await sendMessage(
          "✅ *Pendaftaran Berhasil!*\n\n" +
            `Nama: ${nama}\n` +
            `Unit: ${unit}\n` +
            `Jabatan: ${jabatan}\n` +
            `Referensi Hari/Jam: ${waktu}\n` +
            `Layanan: ${session.layanan}\n` +
            `Metode: ${session.metode}\n\n` +
            "Terima kasih telah menghubungi Klinik Konsultasi Inspektorat.\n\n" +
            "Ketik *MENU* untuk layanan lainnya.\n\n" +
            "— Coded by Damantine"
        );

        await clearSession(from);
        return res.status(200).send("OK");
      } catch (error) {
        console.error("🔥 Error parsing form:", error);
        await sendMessage(
          "❌ *Pendaftaran Gagal!*\n\n" +
            "Terjadi kesalahan sistem saat memproses data Anda. Silakan kirim ulang format isian Anda.\n\n" +
            "— Coded by Damantine"
        );
        return res.status(200).send("OK");
      }
    }

    // MODE CHAT
    if (session?.step === "chat_mode") {
      if (message === "menu") {
        await clearSession(from);
        await sendMessage(
          `*Menu Utama*\n\nSilakan pilih layanan:\n\n${MENU_LIST_TEXT}`
        );
        return res.status(200).send("OK");
      }

      console.log(`💬 Chat from ${from}: ${rawMessage}`);
      return res.status(200).send("OK");
    }

    // STEP 2: Pilih layanan (1–4)
    const layananMap = {
      1: "Tata Kelola & Manajemen Risiko",
      2: "Pengadaan Barang/Jasa",
      3: "Pengelolaan Keuangan & BMN",
      4: "Kinerja & Kepegawaian",
    };

    let layananTerpilih = null;
    if (
      !session ||
      !["choose_method", "fill_form", "chat_mode"].includes(session?.step)
    ) {
      if (["1", "2", "3", "4"].includes(message))
        layananTerpilih = layananMap[message];
    }

    if (layananTerpilih && !session) {
      await setSession(from, {
        step: "choose_method",
        layanan: layananTerpilih,
      });
      await sendMessage(
        `Anda memilih:\n*${layananTerpilih}*\n\n` +
          "Terima kasih atas pilihan Anda terhadap jenis layanan konsultasi.\n" +
          "Mohon konfirmasi metode pelaksanaan konsultasi:\n\n" +
          "1. Offline (Tatap Muka)\n2. Online (Virtual)\n\n" +
          "Balas dengan *ANGKA* pilihan Anda (contoh: 1)."
      );
      return res.status(200).send("OK");
    }

    // STEP 3: Chat langsung (opsi 5)
    if ((message === "5" || message.includes("chat")) && !session) {
      await setSession(from, { step: "chat_mode" });
      await sendMessage(
        "*Chat dengan Tim Inspektorat*\n\n" +
          "Silakan ketik pesan Anda, dan tim kami akan merespons secepat mungkin.\n\n" +
          "Ketik *MENU* untuk kembali ke menu utama."
      );
      return res.status(200).send("OK");
    }

    // Default: tidak dikenali
    console.log(`❓ Unknown command from ${from}: "${rawMessage}"`);
    if (session?.step !== "chat_mode") {
      await sendMessage(
        "Maaf, saya tidak memahami perintah tersebut.\n" +
          "Ketik *MENU* untuk melihat pilihan layanan."
      );
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("🔥 Error in webhook handler:", error);
    return res.status(200).send("OK");
  }
}
