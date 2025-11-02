import axios from "axios";
import { Redis } from "@upstash/redis";

// Inisialisasi Redis (di luar handler)
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Konfigurasi
const WABLAS_BASE_URL = "https://tegal.wablas.com/api/v2";
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 menit

// Konstanta untuk teks menu utama (agar tidak duplikat)
const MENU_LIST_TEXT =
  "1. Tata Kelola & Manajemen Risiko\n" +
  "2. Pengadaan Barang/Jasa\n" +
  "3. Pengelolaan Keuangan & BMN\n" +
  "4. Kinerja & Kepegawaian\n" +
  "5. Chat dengan Tim Inspektorat\n\n" +
  "Balas dengan *ANGKA* pilihan Anda (contoh: 1).";

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      message: "WA Bot Webhook is running",
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const data = req.body;

    // Log untuk debugging
    console.log("Received webhook:", JSON.stringify(data, null, 2));

    // Validasi payload
    if (!data || !data.phone) {
      console.error("Invalid payload - missing phone:", data);
      return res.status(200).send("OK");
    }

    // Extract data dari payload Wablas
    const from = data.phone;
    const rawMessage = data.message || "";
    const message = rawMessage.toLowerCase().trim();
    const messageType = data.messageType || "text";
    const isFromMe = data.isFromMe || false;
    const pushName = data.pushName || "";

    // Log untuk debugging
    console.log("=== INCOMING MESSAGE ===");
    console.log("From:", from);
    console.log("Message:", rawMessage);
    console.log("isFromMe:", isFromMe);
    console.log("messageType:", messageType);
    console.log("pushName:", pushName);

    // PENTING: Ignore pesan dari bot sendiri
    if (
      isFromMe === true ||
      isFromMe === "true" ||
      isFromMe === 1 ||
      isFromMe === "1"
    ) {
      console.log("✋ Ignoring message from bot itself");
      return res.status(200).send("OK");
    }

    // Ignore jika nomor pengirim sama dengan nomor bot
    const botNumber = process.env.WABLAS_PHONE_NUMBER;
    if (botNumber && from === botNumber) {
      console.log("✋ Ignoring message from bot's own number");
      return res.status(200).send("OK");
    }

    // Ignore pesan yang mengandung JSON (kemungkinan response status dari bot)
    if (rawMessage.includes('"status"') || rawMessage.includes('{"status"')) {
      console.log("✋ Ignoring JSON status message");
      return res.status(200).send("OK");
    }

    // Ignore pesan yang terlalu pendek
    if (rawMessage.length < 1) {
      console.log("✋ Ignoring empty message");
      return res.status(200).send("OK");
    }

    // Ignore pesan non-text
    if (messageType !== "text") {
      console.log(`Ignoring non-text message type: ${messageType}`);
      return res.status(200).send("OK");
    }

    // Environment variables
    const apiKey = process.env.WABLAS_API_KEY;
    const secretKey = process.env.WABLAS_SECRET_KEY;
    const spreadsheetWebhook = process.env.SPREADSHEET_WEBHOOK;

    if (!apiKey || !secretKey) {
      console.error("Missing API credentials");
      return res.status(200).send("OK");
    }

    const authHeader = `${apiKey}.${secretKey}`;

    // Fungsi helper untuk mengirim pesan
    const sendMessage = async (text) => {
      try {
        console.log(`Attempting to send message to ${from}...`);

        const payload = {
          data: [
            {
              phone: from,
              message: text,
            },
          ],
        };

        console.log("Payload:", JSON.stringify(payload));

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
        console.log("Message sent successfully:", response.data);
        return response.data;
      } catch (error) {
        console.error("Error sending message:");
        console.error("Status:", error.response?.status);
        console.error("Data:", JSON.stringify(error.response?.data));
        console.error("Message:", error.message);
      }
    };

    // Session management (VERSI REDIS)
    const getSession = async (phone) => {
      const key = `session:${phone}`;
      const sessionString = await redis.get(key);

      if (!sessionString) {
        return null;
      }

      try {
        return JSON.parse(sessionString);
      } catch (error) {
        console.error(
          `Failed to parse session for ${phone}. Data: "${sessionString}"`,
          error
        );
        await redis.del(key);
        return null;
      }
    };

    const setSession = async (phone, data) => {
      const key = `session:${phone}`;
      const value = JSON.stringify(data);
      // Konversi SESSION_TIMEOUT (milidetik) ke detik untuk Redis
      const expiryInSeconds = Math.floor(SESSION_TIMEOUT / 1000); // 1800 detik

      await redis.set(key, value, { ex: expiryInSeconds });
      console.log(
        `Session set for ${phone} (expires in ${expiryInSeconds}s):`,
        data
      );
    };

    const clearSession = async (phone) => {
      await redis.del(`session:${phone}`);
      console.log(`Session cleared for ${phone}`);
    };

    // ========== FLOW LOGIC ==========
    // STEP 1: Menu Utama
    if (
      [
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
      ].includes(message)
    ) {
      await clearSession(from); // Hapus session apa pun yang ada

      const welcomeMenuText =
        "*Selamat datang di Layanan Klinik Konsultasi*\n" +
        "*Inspektorat Lembaga Kebijakan Pengadaan Barang/Jasa Pemerintah.*\n\n" +
        "Silakan pilih layanan konsultasi sesuai kebutuhan Anda:\n\n" +
        MENU_LIST_TEXT;

      await sendMessage(welcomeMenuText); // Delay sebentar sebelum return

      await new Promise((resolve) => setTimeout(resolve, 500));
      return res.status(200).send("OK"); // Langsung hentikan eksekusi
    }

    // Ambil session saat ini
    let session = await getSession(from);
    console.log(`Current session for ${from}:`, session);

    // Definisi layanan
    const layananMap = {
      1: "Tata Kelola & Manajemen Risiko",
      2: "Pengadaan Barang/Jasa",
      3: "Pengelolaan Keuangan & BMN",
      4: "Kinerja & Kepegawaian",
    };

    let layananTerpilih = null;

    // Deteksi layanan berdasarkan keyword (jika tidak ada session)
    if (!session) {
      if (
        message === "1" ||
        message.includes("tata kelola") ||
        message.includes("risiko")
      ) {
        layananTerpilih = layananMap["1"];
      } else if (message === "2" || message.includes("pengadaan")) {
        layananTerpilih = layananMap["2"];
      } else if (
        message === "3" ||
        message.includes("keuangan") ||
        message.includes("bmn")
      ) {
        layananTerpilih = layananMap["3"];
      } else if (
        message === "4" ||
        message.includes("kinerja") ||
        message.includes("kepegawaian")
      ) {
        layananTerpilih = layananMap["4"];
      }
    }

    // STEP 2: Pilihan Layanan (1-4)
    if (layananTerpilih && !session) {
      await setSession(from, {
        step: "choose_method",
        layanan: layananTerpilih,
      });

      const metodeText =
        `Anda memilih:\n*${layananTerpilih}*\n\n` +
        "Terima kasih atas pilihan Anda terhadap jenis layanan konsultasi\n" +
        "Mohon konfirmasi metode pelaksanaan konsultasi:\n\n" +
        "1. Offline (Tatap Muka)\n" +
        "2. Online (Virtual)\n\n" +
        "Balas dengan *ANGKA* pilihan Anda (contoh: 1).";

      await sendMessage(metodeText);
      return res.status(200).send("OK");
      D;
    }

    // STEP 3: Chat langsung (opsi 5)
    if ((message === "5" || message.includes("chat")) && !session) {
      await sendMessage(
        "*Chat dengan Tim Inspektorat*\n\n" +
          "Silakan ketik pesan Anda, dan tim kami akan merespons secepat mungkin.\n\n" +
          "Ketik *MENU* untuk kembali ke menu utama."
      );
      await setSession(from, { step: "chat_mode" });
      return res.status(200).send("OK");
    }

    // STEP 4: Pilih metode (Online/Offline)
    if (["1", "2"].includes(message) && session?.step === "choose_method") {
      await setSession(from, {
        ...session,
        step: "fill_form",
        metode: message === "1" ? "Offline" : "Online", // Simpan teks, bukan ANGKA
      });

      // Sesuaikan pesan berdasarkan pilihan metode
      const formTitle =
        message === "1"
          ? "*Form Pendaftaran Konsultasi Offline*"
          : "*Form Pendaftaran Konsultasi Online*";

      await sendMessage(
        `${formTitle}\n\n` +
          "Dimohon kesediaannya untuk mengisi data diri di bawah ini sebagai bagian dari proses pendataan\n\n" +
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

    // STEP 5: Proses form submission
    if (session?.step === "fill_form") {
      // Parse data form
      const lines = rawMessage.split("\n").map((line) => line.trim());
      let nama = "",
        unit = "",
        jabatan = "",
        waktu = "";

      for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.startsWith("nama:")) {
          nama = line.substring(line.indexOf(":") + 1).trim();
        } else if (lower.startsWith("unit:")) {
          unit = line.substring(line.indexOf(":") + 1).trim();
        } else if (lower.startsWith("jabatan:")) {
          jabatan = line.substring(line.indexOf(":") + 1).trim();
        } else if (lower.startsWith("referensi hari/jam:")) {
          waktu = line.substring(line.indexOf(":") + 1).trim();
        }
      }

      // Validasi
      if (!nama || !unit || !jabatan || !waktu) {
        await sendMessage(
          "*Data tidak lengkap!*\n\n" +
            "Pastikan Anda mengisi semua field:\n" +
            "✓ Nama\n" +
            "✓ Unit\n" +
            "✓ Jabatan\n" +
            "✓ Referensi Hari/Jam\n\n" +
            "Silakan kirim ulang dengan format yang benar."
        );
        return res.status(200).send("OK");
      }

      // Kirim ke spreadsheet (jika ada webhook)
      if (spreadsheetWebhook) {
        try {
          await axios.post(
            spreadsheetWebhook,
            {
              timestamp: new Date().toISOString(),
              nomor: from,
              nama,
              unit,
              jabatan,
              waktu,
              layanan: session.layanan,
              metode: session.metode,
            },
            { timeout: 10000 }
          );
          console.log("Data sent to spreadsheet successfully");
        } catch (error) {
          console.error("Error sending to spreadsheet:", error.message);

          await sendMessage(
            "❌ *Pendaftaran Gagal!*\n\n" +
              "Maaf, terjadi kesalahan saat menyimpan pendaftaran Anda ke sistem kami.\n\n" +
              "Data Anda *belum* terkirim. Silakan kirim ulang format isian Anda sekali lagi."
          );

          return res.status(200).send("OK");
        }
      }

      // Konfirmasi
      await sendMessage(
        "✅ *Pendaftaran Berhasil!*\n\n" +
          `Nama: ${nama}\n` +
          `Unit: ${unit}\n` +
          `Jabatan: ${jabatan}\n` +
          `Referensi Hari/Jam: ${waktu}\n` +
          `Layanan: ${session.layanan}\n` +
          `Metode: ${session.metode}\n\n` +
          "Terima kasih telah menghubungi Klinik Konsultasi Inspektorat. " +
          "Permintaan Anda telah kami terima, dan tim kami akan segera menghubungi Anda untuk tindak lanjut.\n\n" +
          "Ketik *MENU* untuk layanan lainnya."
      );

      await clearSession(from);
      return res.status(200).send("OK");
    }

    // Mode chat
    if (session?.step === "chat_mode") {
      if (message === "menu") {
        await clearSession(from);

        const chatMenuText =
          "*Menu Utama*\n\n" +
          "Silakan pilih layanan konsultasi:\n\n" +
          MENU_LIST_TEXT;

        await sendMessage(chatMenuText);
        return res.status(200).send("OK");
      }

      console.log(`Chat message from ${from}: ${rawMessage}`);
      return res.status(200).send("OK");
    }

    // Default: tidak dikenali
    console.log(`Perintah tidak dikenali dari ${from}: "${rawMessage}"`);

    // Hanya kirim pesan 'tidak paham' jika TIDAK sedang dalam mode chat
    if (session?.step != "chat_mode") {
      await sendMessage(
        "Maaf, saya tidak memahami perintah tersebut.\n" +
          "*Silahkan kirim pesan sesuai dengan yang diperintahkan.*\n\n" +
          "Ketik *MENU* untuk melihat pilihan layanan."
      );
    }
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Error in webhook handler:", error);
    return res.status(200).send("OK"); // Tetap return OK
  }
}
